import { PROTOCOL_VERSION, type ServerMessage } from "@pulsedesk/contracts";
import { createLogger, createMemorySink, createMetrics } from "@pulsedesk/observability";
import { makeSession } from "@pulsedesk/test-utils";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SessionStore } from "../events/session-store.ts";
import { CLOSE_SLOW_CONSUMER, ConnectionManager } from "./connection-manager.ts";
import { InMemoryEventLog } from "./replay-buffer.ts";
import { SessionRooms } from "./session-room.ts";

/** Just enough of a `ws` socket for the manager, with a controllable send backlog. */
class FakeWs extends EventEmitter {
  bufferedAmount = 0;
  sent: ServerMessage[] = [];
  closedWith: number | null = null;
  terminated = false;
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(code: number) {
    this.closedWith = code;
  }
  terminate() {
    this.terminated = true;
  }
  ping() {}
  hello() {
    const hello = {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      agent: { id: "a", name: "A" },
      resumeFrom: null,
    };
    this.emit("message", Buffer.from(JSON.stringify(hello)), false);
  }
}

const MAX_BUFFERED = 1_000;

function setup() {
  const sink = createMemorySink();
  const log = new InMemoryEventLog(100, "stream");
  const manager = new ConnectionManager({
    log,
    store: new SessionStore({
      timelineLimit: 20,
      idleAfterMs: 45_000,
      closeAfterMs: 180_000,
      closedRetentionMs: 3_600_000,
      maxClosedSessions: 10,
    }),
    rooms: new SessionRooms(),
    heartbeatIntervalMs: 15_000,
    maxBufferedBytes: MAX_BUFFERED,
    presenceGraceMs: 0,
    publish: () => {},
    logger: createLogger({ sink: { write: () => {} } }),
    metrics: createMetrics(sink),
  });
  const connect = () => {
    const socket = new FakeWs();
    manager.accept(socket as unknown as WebSocket);
    socket.hello();
    return socket;
  };
  const broadcast = () =>
    manager.broadcast(
      log.append([
        {
          type: "session.created",
          eventId: `e${log.headSequence() + 1}`,
          sessionId: "s1",
          timestamp: 0,
          payload: { session: makeSession({ id: "s1" }) },
        },
      ]),
    );
  return { manager, connect, broadcast, sink };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ConnectionManager backpressure", () => {
  it("disconnects a slow consumer instead of buffering for it, and keeps serving the rest", () => {
    const { connect, broadcast, sink } = setup();
    const healthy = connect();
    const slow = connect();
    slow.bufferedAmount = MAX_BUFFERED + 1;

    broadcast();
    expect(healthy.sent.at(-1)?.type).toBe("events");
    expect(slow.sent.at(-1)?.type).not.toBe("events");
    expect(slow.closedWith).toBe(CLOSE_SLOW_CONSUMER);
    expect(sink.get("gateway.backpressure.disconnects")?.count).toBe(1);

    // No further frames are queued for it while it closes.
    const sentBefore = slow.sent.length;
    broadcast();
    expect(slow.sent).toHaveLength(sentBefore);
    expect(sink.get("gateway.backpressure.disconnects")?.count).toBe(1);
  });

  it("destroys a slow consumer that doesn't finish closing", () => {
    const { connect, broadcast } = setup();
    const slow = connect();
    slow.bufferedAmount = MAX_BUFFERED + 1;
    broadcast();
    expect(slow.terminated).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(slow.terminated).toBe(true);
  });

  it("leaves a socket alone while its backlog is under the limit", () => {
    const { connect, broadcast } = setup();
    const socket = connect();
    socket.bufferedAmount = MAX_BUFFERED;
    broadcast();
    expect(socket.closedWith).toBeNull();
    expect(socket.sent.at(-1)?.type).toBe("events");
  });
});

describe("ConnectionManager heartbeat", () => {
  it("answers ping with pong carrying the stream head", () => {
    const { connect, broadcast } = setup();
    const socket = connect();
    broadcast();
    broadcast();
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "ping", nonce: 7, sentAt: 1 })),
      false,
    );
    expect(socket.sent.at(-1)).toMatchObject({ type: "pong", nonce: 7, headSequence: 2 });
  });
});
