import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  type Agent,
  type ClientMessage,
  type RealtimeEvent,
  type ServerMessage,
  type StreamCursor,
  type UnsequencedEvent,
} from "@pulsedesk/contracts";
import type { Logger, Metrics } from "@pulsedesk/observability";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { SessionStore } from "../events/session-store.ts";
import { trackLiveness } from "./heartbeat.ts";
import type { EventLog } from "./replay-buffer.ts";
import type { PresenceChange, SessionRooms } from "./session-room.ts";

const REPLAY_CHUNK = 500;
const MAX_INVALID_MESSAGES = 20;

/**
 * Close codes the gateway uses (4000–4999 is the application range). Clients reconnect
 * on any close; the code is for logs and diagnostics.
 */
export const CLOSE_SLOW_CONSUMER = 4008;
/** How long a slow consumer gets to complete the close handshake before it's destroyed. */
const SLOW_CONSUMER_GRACE_MS = 2_000;

interface Connection {
  id: string;
  socket: WebSocket;
  /** Only live connections receive broadcasts; handshaking ones get replay first. */
  live: boolean;
  agent: Agent | null;
  invalidMessages: number;
  connectedAt: number;
}

export interface ConnectionManagerDeps {
  log: EventLog;
  store: SessionStore;
  rooms: SessionRooms;
  heartbeatIntervalMs: number;
  /**
   * Backpressure limit: a live socket with more than this many bytes queued (sent by us,
   * not yet flushed to the network) is disconnected instead of being buffered forever.
   */
  maxBufferedBytes: number;
  /**
   * How long a disconnected agent stays "viewing" before presence.left is published. A
   * reconnect within this window (a network blip, a gateway-initiated slow-consumer drop)
   * produces no left/joined pair: the new connection simply takes over the watch.
   */
  presenceGraceMs: number;
  /** Publishes presence events into the stream (via the pipeline). */
  publish: (events: UnsequencedEvent[]) => void;
  logger: Logger;
  metrics: Metrics;
}

export class ConnectionManager {
  readonly #connections = new Map<string, Connection>();
  readonly #deps: ConnectionManagerDeps;
  readonly #pendingLeaves = new Set<ReturnType<typeof setTimeout>>();

  constructor(deps: ConnectionManagerDeps) {
    this.#deps = deps;
  }

  get size() {
    return this.#connections.size;
  }

  sockets(): Iterable<WebSocket> {
    return [...this.#connections.values()].map((c) => c.socket);
  }

  accept(socket: WebSocket) {
    const connection: Connection = {
      id: randomUUID(),
      socket,
      live: false,
      agent: null,
      invalidMessages: 0,
      connectedAt: Date.now(),
    };
    this.#connections.set(connection.id, connection);
    this.#deps.metrics.gauge("gateway.connections.active", this.#connections.size);
    trackLiveness(socket);

    socket.on("message", (data, isBinary) => {
      if (isBinary) return this.#reject(connection, "Binary frames are not supported");
      this.#onMessage(connection, data.toString());
    });
    socket.on("close", () => this.#onClose(connection));
    socket.on("error", (error) =>
      this.#deps.logger.warn("ws.socket_error", {
        connectionId: connection.id,
        error: error.message,
      }),
    );
  }

  /**
   * Fan out to live connections. Serialised once, not per socket: with N clients the
   * cost is one JSON.stringify plus N writes.
   */
  broadcast(events: RealtimeEvent[]) {
    if (events.length === 0 || this.#connections.size === 0) return;
    const frame = JSON.stringify({ type: "events", events } satisfies ServerMessage);
    for (const connection of this.#connections.values()) {
      if (!connection.live) continue;
      if (connection.socket.bufferedAmount > this.#deps.maxBufferedBytes) {
        this.#dropSlowConsumer(connection);
        continue;
      }
      connection.socket.send(frame);
    }
  }

  /**
   * One slow client (a throttled tab, a phone on a bad link) must not grow the gateway's
   * memory without bound. It is cut loose instead. Nothing is lost: it reconnects with
   * its cursor and replay fills in everything it missed, or it gets a snapshot if it fell
   * further behind than the replay buffer.
   */
  #dropSlowConsumer(connection: Connection) {
    connection.live = false;
    this.#deps.metrics.increment("gateway.backpressure.disconnects");
    this.#deps.logger.warn("ws.slow_consumer", {
      connectionId: connection.id,
      bufferedBytes: connection.socket.bufferedAmount,
    });
    connection.socket.close(CLOSE_SLOW_CONSUMER, "Slow consumer");
    // The close frame queues behind the backlog; don't wait for it indefinitely.
    setTimeout(() => {
      if (this.#connections.has(connection.id)) connection.socket.terminate();
    }, SLOW_CONSUMER_GRACE_MS).unref();
  }

  /** Close every socket with "going away" so clients reconnect to the next instance. */
  closeAll() {
    for (const timer of this.#pendingLeaves) clearTimeout(timer);
    this.#pendingLeaves.clear();
    for (const connection of this.#connections.values())
      connection.socket.close(1001, "Server shutting down");
  }

  #send(connection: Connection, message: ServerMessage) {
    connection.socket.send(JSON.stringify(message));
  }

  #reject(connection: Connection, message: string) {
    connection.invalidMessages++;
    this.#send(connection, { type: "error", code: "bad_request", message });
    if (connection.invalidMessages >= MAX_INVALID_MESSAGES)
      connection.socket.close(1008, "Too many invalid messages");
  }

  #onMessage(connection: Connection, raw: string) {
    const result = decodeClientMessage(raw);
    if (!result.ok) return this.#reject(connection, "Malformed message");
    const message: ClientMessage = result.value;

    switch (message.type) {
      case "hello":
        return this.#handshake(
          connection,
          message.agent,
          message.protocolVersion,
          message.resumeFrom,
        );
      case "ping":
        return this.#send(connection, {
          type: "pong",
          nonce: message.nonce,
          serverTime: Date.now(),
          headSequence: this.#deps.log.headSequence(),
        });
      case "session.watch":
      case "session.unwatch": {
        if (!connection.agent) return this.#reject(connection, "Send hello first");
        const change =
          message.type === "session.watch"
            ? this.#deps.rooms.watch(connection.id, connection.agent, message.sessionId)
            : this.#deps.rooms.unwatch(connection.id, connection.agent.id, message.sessionId);
        this.#publishPresence(change ? [change] : []);
        return;
      }
    }
  }

  /**
   * Resume or snapshot, then go live. Entirely synchronous: no broadcast can run between
   * reading the replay range and marking the connection live, so the client receives
   * every event exactly once, in order, across the handoff.
   */
  #handshake(
    connection: Connection,
    agent: Agent,
    protocolVersion: number,
    resumeFrom: StreamCursor | null,
  ) {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.#send(connection, {
        type: "error",
        code: "unsupported_protocol",
        message: `Expected protocol ${PROTOCOL_VERSION}`,
      });
      connection.socket.close(1002, "Unsupported protocol");
      return;
    }
    const { log, store } = this.#deps;
    connection.agent = agent;
    connection.live = false;
    const head = log.headSequence();

    this.#send(connection, {
      type: "welcome",
      connectionId: connection.id,
      streamId: log.streamId,
      serverTime: Date.now(),
      heartbeatIntervalMs: this.#deps.heartbeatIntervalMs,
      headSequence: head,
    });

    const resumable =
      resumeFrom !== null &&
      resumeFrom.streamId === log.streamId &&
      log.canResumeFrom(resumeFrom.sequence);

    if (resumable) {
      const missed = log.readAfter(resumeFrom.sequence);
      this.#send(connection, {
        type: "sync.started",
        fromSequence: resumeFrom.sequence + 1,
        toSequence: head,
      });
      for (let i = 0; i < missed.length; i += REPLAY_CHUNK) {
        this.#send(connection, { type: "events", events: missed.slice(i, i + REPLAY_CHUNK) });
      }
      this.#send(connection, {
        type: "sync.completed",
        replayedCount: missed.length,
        headSequence: head,
      });
    } else {
      this.#send(connection, {
        type: "snapshot",
        streamId: log.streamId,
        sequence: head,
        sessions: store.list(),
      });
    }

    connection.live = true;
    this.#deps.logger.debug("ws.handshake", {
      connectionId: connection.id,
      mode: resumable ? "replay" : "snapshot",
      from: resumeFrom?.sequence ?? null,
      head,
    });
  }

  #onClose(connection: Connection) {
    this.#connections.delete(connection.id);
    this.#deps.metrics.gauge("gateway.connections.active", this.#connections.size);
    this.#deps.metrics.histogram(
      "websocket.connection.duration",
      Date.now() - connection.connectedAt,
    );
    const agent = connection.agent;
    if (!agent) return;
    const leave = () => this.#publishPresence(this.#deps.rooms.leaveAll(connection.id, agent.id));
    if (this.#deps.presenceGraceMs <= 0) return leave();
    const timer = setTimeout(() => {
      this.#pendingLeaves.delete(timer);
      leave();
    }, this.#deps.presenceGraceMs);
    timer.unref();
    this.#pendingLeaves.add(timer);
  }

  #publishPresence(changes: PresenceChange[]) {
    const events: UnsequencedEvent[] = changes
      // Presence for sessions that aged out (or never existed) isn't worth a stream entry.
      .filter((change) => this.#deps.store.has(change.sessionId))
      .map((change) => ({
        type: change.type === "joined" ? "presence.joined" : "presence.left",
        eventId: `presence_${randomUUID()}`,
        sessionId: change.sessionId,
        timestamp: Date.now(),
        payload: { agent: change.agent },
      }));
    if (events.length > 0) this.#deps.publish(events);
  }
}
