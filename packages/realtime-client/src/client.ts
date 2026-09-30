import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  type Agent,
  type ClientMessage,
  type RealtimeEvent,
  type Session,
  type StreamCursor,
} from "@pulsedesk/contracts";
import { noopMetrics, type Logger, type Metrics } from "@pulsedesk/observability";
import { backoffDelay, defaultBackoff, type BackoffOptions } from "./backoff.ts";
import { OPEN, browserTransport, type TransportFactory, type WebSocketLike } from "./transport.ts";

/**
 *   idle ──connect()──► connecting ──open──► syncing ──snapshot / sync.completed──► live
 *                           ▲                   │                                     │
 *                           │                   └────────── socket closed ────────────┤
 *                           └──── timer ◄──── reconnecting ◄──────────────────────────┘
 *   any ──close()──► closed (terminal until connect())
 */
export type ConnectionStatus =
  "idle" | "connecting" | "syncing" | "live" | "reconnecting" | "closed";

export interface RealtimeClientState {
  status: ConnectionStatus;
  /** Last position fully delivered to subscribers; sent as the resume point on reconnect. */
  cursor: StreamCursor | null;
  /** Consecutive failed attempts since the last live connection. */
  reconnectAttempt: number;
  /** When the next reconnect attempt fires (epoch ms), while reconnecting. */
  nextRetryAt: number | null;
  /** When the current connection went live. */
  liveSince: number | null;
}

export type RealtimeClientEvent =
  | { type: "state"; state: RealtimeClientState }
  | { type: "snapshot"; streamId: string; sequence: number; sessions: Session[] }
  | { type: "events"; events: RealtimeEvent[] }
  | { type: "sync.started"; fromSequence: number; toSequence: number }
  | { type: "sync.completed"; replayedCount: number };

export type RealtimeClientListener = (event: RealtimeClientEvent) => void;

export interface RealtimeClientOptions {
  url: string;
  agent: Agent;
  /** Where to resume from, e.g. the sequence of the server-rendered snapshot. */
  resumeFrom: StreamCursor | null;
  transport?: TransportFactory;
  backoff?: Partial<BackoffOptions>;
  metrics?: Metrics;
  logger?: Logger;
  now?: () => number;
}

export interface RealtimeClient {
  connect(): void;
  /** Permanently close: cancels timers and never reconnects (until connect() is called). */
  close(): void;
  watchSession(sessionId: string): void;
  unwatchSession(sessionId: string): void;
  subscribe(listener: RealtimeClientListener): () => void;
  getState(): RealtimeClientState;
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const transport = options.transport ?? browserTransport;
  const backoff = { ...defaultBackoff, ...options.backoff };
  const metrics = options.metrics ?? noopMetrics;
  const now = options.now ?? Date.now;

  const listeners = new Set<RealtimeClientListener>();
  const watched = new Set<string>();
  let socket: WebSocketLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Stream epoch of the current connection, from its welcome message. */
  let streamId: string | null = null;
  let state: RealtimeClientState = {
    status: "idle",
    cursor: options.resumeFrom,
    reconnectAttempt: 0,
    nextRetryAt: null,
    liveSince: null,
  };

  const emit = (event: RealtimeClientEvent) => listeners.forEach((listener) => listener(event));
  const setState = (patch: Partial<RealtimeClientState>) => {
    state = { ...state, ...patch };
    emit({ type: "state", state });
  };
  const send = (message: ClientMessage) => {
    if (socket?.readyState === OPEN) socket.send(JSON.stringify(message));
  };

  function open() {
    clearTimeout(retryTimer);
    const current = transport(options.url);
    socket = current;
    metrics.increment("websocket.connect.attempts");
    setState({ status: "connecting", nextRetryAt: null });

    // Every handler checks it still belongs to the current socket: after a reconnect, a
    // dying socket's late frames or close event must not touch the new connection.
    const isCurrent = () => socket === current;

    current.addEventListener("open", () => {
      if (!isCurrent()) return;
      setState({ status: "syncing" });
      send({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        agent: options.agent,
        resumeFrom: state.cursor,
      });
      // Presence is per connection on the server: re-establish it after every (re)connect.
      for (const sessionId of watched) send({ type: "session.watch", sessionId });
    });

    current.addEventListener("message", ({ data }) => {
      if (!isCurrent()) return;
      onMessage(typeof data === "string" ? data : String(data));
    });

    current.addEventListener("close", ({ code }) => {
      if (!isCurrent()) return;
      socket = null;
      if (state.liveSince !== null)
        metrics.histogram("websocket.connection.duration", now() - state.liveSince);
      if (state.status === "closed") return;
      scheduleReconnect(code);
    });

    // "error" is always followed by "close"; reconnect logic lives there.
    current.addEventListener("error", () => {});
  }

  function scheduleReconnect(code: number) {
    const attempt = state.reconnectAttempt + 1;
    const delay = backoffDelay(attempt, backoff);
    metrics.increment("websocket.reconnect.count");
    options.logger?.warn("realtime.disconnected", { code, attempt, retryInMs: delay });
    setState({
      status: "reconnecting",
      reconnectAttempt: attempt,
      nextRetryAt: now() + delay,
      liveSince: null,
    });
    retryTimer = setTimeout(open, delay);
  }

  function goLive() {
    setState({ status: "live", reconnectAttempt: 0, liveSince: now() });
  }

  function onMessage(raw: string) {
    const decoded = decodeServerMessage(raw);
    if (!decoded.ok) {
      // Never let one bad frame take the connection (or the UI) down.
      metrics.increment("websocket.frames.invalid");
      options.logger?.warn("realtime.invalid_frame", { kind: decoded.error.kind });
      return;
    }
    const message = decoded.value;
    switch (message.type) {
      case "welcome":
        streamId = message.streamId;
        return;
      case "pong":
        return;
      case "snapshot":
        state = { ...state, cursor: { streamId: message.streamId, sequence: message.sequence } };
        emit({
          type: "snapshot",
          streamId: message.streamId,
          sequence: message.sequence,
          sessions: message.sessions,
        });
        return goLive();
      case "sync.started":
        return emit({
          type: "sync.started",
          fromSequence: message.fromSequence,
          toSequence: message.toSequence,
        });
      case "sync.completed":
        emit({ type: "sync.completed", replayedCount: message.replayedCount });
        return goLive();
      case "events":
        return deliver(message.events);
      case "error":
        options.logger?.warn("realtime.server_error", {
          code: message.code,
          message: message.message,
        });
        return;
    }
  }

  function deliver(events: RealtimeEvent[]) {
    const cursor = state.cursor;
    // Anything at or below the cursor was already delivered (e.g. overlap between an
    // HTTP snapshot and the socket's replay). Phase 4 adds gap detection and reordering.
    const fresh = cursor ? events.filter((event) => event.sequence > cursor.sequence) : events;
    metrics.increment("websocket.events.received", events.length);
    if (fresh.length < events.length)
      metrics.increment("websocket.events.dropped", events.length - fresh.length);
    const last = fresh.at(-1);
    if (!last) return;
    state = {
      ...state,
      cursor: { streamId: streamId ?? cursor?.streamId ?? "", sequence: last.sequence },
    };
    emit({ type: "events", events: fresh });
  }

  return {
    connect() {
      if (state.status === "idle" || state.status === "closed") open();
    },
    close() {
      clearTimeout(retryTimer);
      setState({ status: "closed", nextRetryAt: null });
      const current = socket;
      socket = null;
      current?.close(1000, "Client closed");
    },
    watchSession(sessionId) {
      watched.add(sessionId);
      send({ type: "session.watch", sessionId });
    },
    unwatchSession(sessionId) {
      if (!watched.delete(sessionId)) return;
      send({ type: "session.unwatch", sessionId });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
  };
}
