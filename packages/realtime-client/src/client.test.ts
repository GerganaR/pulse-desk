import type { RealtimeEvent, ServerMessage } from "@pulsedesk/contracts";
import { createMemorySink, createMetrics } from "@pulsedesk/observability";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay } from "./backoff.ts";
import { createRealtimeClient, type RealtimeClientEvent } from "./client.ts";
import type { WebSocketEventMapLike, WebSocketLike } from "./transport.ts";

type Listener = (event: never) => void;

/** Controllable stand-in for a WebSocket. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | null = null;
  #listeners = new Map<string, Listener[]>();

  addEventListener<K extends keyof WebSocketEventMapLike>(
    type: K,
    listener: (event: WebSocketEventMapLike[K]) => void,
  ) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closedWith = code;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.#fire("open");
  }
  receive(message: ServerMessage | string) {
    this.#fire("message", {
      data: typeof message === "string" ? message : JSON.stringify(message),
    });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.#fire("close", { code, reason: "", wasClean: false });
  }
  #fire(type: keyof WebSocketEventMapLike, event?: unknown) {
    this.#listeners.get(type)?.forEach((listener) => (listener as (event: unknown) => void)(event));
  }
}

const agent = { id: "a1", name: "Jordan" };
let sockets: FakeSocket[];
const latest = () => sockets.at(-1)!;

function event(sequence: number): RealtimeEvent {
  return {
    type: "session.click",
    eventId: `e${sequence}`,
    sequence,
    sessionId: "s1",
    timestamp: 0,
    payload: { element: "cta", label: "Go", path: "/" },
  };
}

function setup(resumeFrom: { streamId: string; sequence: number } | null = null) {
  sockets = [];
  const sink = createMemorySink();
  const client = createRealtimeClient({
    url: "ws://gateway/ws",
    agent,
    resumeFrom,
    transport: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    backoff: { random: () => 0.5 },
    metrics: createMetrics(sink),
  });
  const received: RealtimeClientEvent[] = [];
  client.subscribe((e) => received.push(e));
  const statuses = () => received.flatMap((e) => (e.type === "state" ? [e.state.status] : []));
  const delivered = () =>
    received.flatMap((e) => (e.type === "events" ? e.events.map((x) => x.sequence) : []));
  return { client, received, statuses, delivered, sink };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("realtime client", () => {
  it("handshakes with its resume cursor and becomes live after the snapshot", () => {
    const { client, statuses, received } = setup({ streamId: "s-1", sequence: 40 });
    client.connect();
    latest().open();
    expect(latest().sent[0]).toMatchObject({
      type: "hello",
      agent,
      resumeFrom: { streamId: "s-1", sequence: 40 },
    });

    latest().receive({
      type: "welcome",
      connectionId: "c",
      streamId: "s-2",
      serverTime: 0,
      heartbeatIntervalMs: 15_000,
      headSequence: 3,
    });
    latest().receive({ type: "snapshot", streamId: "s-2", sequence: 3, sessions: [makeSession()] });

    expect(statuses()).toEqual(["connecting", "syncing", "live"]);
    expect(received.find((e) => e.type === "snapshot")).toMatchObject({
      streamId: "s-2",
      sequence: 3,
    });
    expect(client.getState().cursor).toEqual({ streamId: "s-2", sequence: 3 });
  });

  it("delivers replayed and live events, dropping anything at or below the cursor", () => {
    const { client, delivered, statuses, sink } = setup({ streamId: "s-1", sequence: 5 });
    client.connect();
    latest().open();
    latest().receive({
      type: "welcome",
      connectionId: "c",
      streamId: "s-1",
      serverTime: 0,
      heartbeatIntervalMs: 15_000,
      headSequence: 7,
    });
    latest().receive({ type: "sync.started", fromSequence: 6, toSequence: 7 });
    latest().receive({ type: "events", events: [event(4), event(5), event(6), event(7)] });
    latest().receive({ type: "sync.completed", replayedCount: 2, headSequence: 7 });
    latest().receive({ type: "events", events: [event(7), event(8)] });

    expect(delivered()).toEqual([6, 7, 8]);
    expect(statuses().at(-1)).toBe("live");
    expect(sink.get("websocket.events.dropped")?.sum).toBe(3);
  });

  it("ignores malformed frames without disconnecting", () => {
    const { client, delivered, sink } = setup({ streamId: "s-1", sequence: 0 });
    client.connect();
    latest().open();
    latest().receive("{not json");
    latest().receive(JSON.stringify({ type: "events", events: [{ bogus: true }] }));
    latest().receive({ type: "events", events: [event(1)] });

    expect(delivered()).toEqual([1]);
    expect(sink.get("websocket.frames.invalid")?.count).toBe(2);
    expect(latest().closedWith).toBeNull();
  });

  it("reconnects with backoff and resumes from the last delivered sequence", () => {
    const { client, statuses } = setup({ streamId: "s-1", sequence: 0 });
    client.connect();
    latest().open();
    latest().receive({ type: "events", events: [event(1), event(2)] });
    latest().drop();

    expect(statuses().at(-1)).toBe("reconnecting");
    expect(client.getState().nextRetryAt).not.toBeNull();
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(
      backoffDelay(1, { baseDelayMs: 1_000, maxDelayMs: 30_000, random: () => 0.5 }),
    );
    expect(sockets).toHaveLength(2);
    latest().open();
    expect(latest().sent[0]).toMatchObject({
      type: "hello",
      resumeFrom: { streamId: "s-1", sequence: 2 },
    });
  });

  it("backs off exponentially across consecutive failures and resets once live", () => {
    const { client } = setup(null);
    client.connect();
    const attempts: number[] = [];
    for (let i = 0; i < 4; i++) {
      latest().drop();
      attempts.push(client.getState().reconnectAttempt);
      vi.advanceTimersByTime(60_000);
    }
    expect(attempts).toEqual([1, 2, 3, 4]);

    latest().open();
    latest().receive({ type: "snapshot", streamId: "s", sequence: 0, sessions: [] });
    expect(client.getState().reconnectAttempt).toBe(0);
  });

  it("re-establishes watched sessions after reconnecting", () => {
    const { client } = setup(null);
    client.connect();
    latest().open();
    client.watchSession("s1");
    latest().drop();
    vi.advanceTimersByTime(60_000);
    latest().open();
    expect(latest().sent).toContainEqual({ type: "session.watch", sessionId: "s1" });
  });

  it("ignores late events from a replaced socket", () => {
    const { client, delivered } = setup({ streamId: "s-1", sequence: 0 });
    client.connect();
    const first = latest();
    first.open();
    first.drop();
    vi.advanceTimersByTime(60_000);
    first.receive({ type: "events", events: [event(1)] }); // stale socket
    expect(delivered()).toEqual([]);
  });

  it("close() is final: no reconnect timers, no further state changes", () => {
    const { client, statuses } = setup(null);
    client.connect();
    latest().open();
    client.close();
    latest().drop();
    vi.advanceTimersByTime(120_000);

    expect(sockets).toHaveLength(1);
    expect(statuses().at(-1)).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("backoffDelay", () => {
  const options = { baseDelayMs: 1_000, maxDelayMs: 30_000 };
  it.each([
    [1, 500, 1_000],
    [2, 1_000, 2_000],
    [4, 4_000, 8_000],
    [10, 15_000, 30_000],
  ])("attempt %i stays within [%i, %i] ms", (attempt, min, max) => {
    expect(backoffDelay(attempt, { ...options, random: () => 0 })).toBe(min);
    expect(backoffDelay(attempt, { ...options, random: () => 0.9999 })).toBeLessThanOrEqual(max);
  });
});
