import type { StreamCursor } from "@pulsedesk/contracts";
import { createMemorySink, createMetrics } from "@pulsedesk/observability";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay } from "./backoff.ts";
import {
  createRealtimeClient,
  defaultHeartbeat,
  type RealtimeClientEvent,
  type RealtimeClientOptions,
} from "./client.ts";
import { FakeSocket, clickEvent as event } from "./test/fake-socket.ts";

const agent = { id: "a1", name: "Jordan" };
const STREAM = "s-1";
let sockets: FakeSocket[];
const latest = () => sockets.at(-1)!;

function setup(
  resumeFrom: StreamCursor | null = null,
  overrides: Partial<RealtimeClientOptions> = {},
) {
  sockets = [];
  const sink = createMemorySink();
  const client = createRealtimeClient({
    url: "ws://gateway/ws",
    agent,
    resumeFrom,
    transport: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    backoff: { random: () => 0.5 },
    metrics: createMetrics(sink),
    ...overrides,
  });
  const received: RealtimeClientEvent[] = [];
  client.subscribe((e) => received.push(e));
  const statuses = () => received.flatMap((e) => (e.type === "state" ? [e.state.status] : []));
  const delivered = () =>
    received.flatMap((e) => (e.type === "events" ? e.events.map((x) => x.sequence) : []));
  return { client, received, statuses, delivered, sink };
}

/**
 * Plays the gateway's side of a handshake on the latest socket: welcome, then replay from
 * the client's cursor (same stream) or a snapshot.
 */
function handshake({ head = 0, streamId = STREAM, replay = [] as number[] } = {}) {
  const socket = latest();
  if (socket.readyState !== 1) socket.open();
  const hello = socket.sentOfType("hello").at(-1)!;
  socket.receive({
    type: "welcome",
    connectionId: "c",
    streamId,
    serverTime: 0,
    heartbeatIntervalMs: 15_000,
    headSequence: head,
  });
  if (hello.resumeFrom?.streamId === streamId) {
    socket.receive({
      type: "sync.started",
      fromSequence: hello.resumeFrom.sequence + 1,
      toSequence: head,
    });
    if (replay.length > 0) socket.receive({ type: "events", events: replay.map((s) => event(s)) });
    socket.receive({ type: "sync.completed", replayedCount: replay.length, headSequence: head });
  } else {
    socket.receive({ type: "snapshot", streamId, sequence: head, sessions: [] });
  }
}

function pong(socket: FakeSocket, headSequence = 0) {
  const ping = socket.sentOfType("ping").at(-1)!;
  socket.receive({ type: "pong", nonce: ping.nonce, serverTime: 0, headSequence });
}

const expectedDelay = (attempt: number, random = 0.5) =>
  backoffDelay(attempt, { baseDelayMs: 1_000, maxDelayMs: 30_000, random: () => random });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("realtime client: handshake and delivery", () => {
  it("handshakes with its resume cursor and becomes live after the snapshot", () => {
    const { client, statuses, received } = setup({ streamId: "old", sequence: 40 });
    client.connect();
    latest().open();
    expect(latest().sent[0]).toMatchObject({
      type: "hello",
      agent,
      resumeFrom: { streamId: "old", sequence: 40 },
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
      reason: "new_stream",
    });
    expect(client.getState().cursor).toEqual({ streamId: "s-2", sequence: 3 });
  });

  it("labels a first-ever snapshot as initial", () => {
    const { client, received } = setup(null);
    client.connect();
    handshake({ head: 3 });
    expect(received.find((e) => e.type === "snapshot")).toMatchObject({ reason: "initial" });
  });

  it("delivers replayed and live events, dropping anything at or below the cursor", () => {
    const { client, delivered, statuses, sink, received } = setup({
      streamId: STREAM,
      sequence: 5,
    });
    client.connect();
    latest().open();
    latest().receive({
      type: "welcome",
      connectionId: "c",
      streamId: STREAM,
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
    expect(received.find((e) => e.type === "sync.started")).toMatchObject({ reason: "initial" });
  });

  it("ignores malformed frames without disconnecting", () => {
    const { client, delivered, sink } = setup({ streamId: STREAM, sequence: 0 });
    client.connect();
    handshake();
    latest().receive("{not json");
    latest().receive(JSON.stringify({ type: "events", events: [{ bogus: true }] }));
    latest().receive({ type: "events", events: [event(1)] });

    expect(delivered()).toEqual([1]);
    expect(sink.get("websocket.frames.invalid")?.count).toBe(2);
    expect(latest().closedWith).toBeNull();
  });

  it("ignores late events from a replaced socket", () => {
    const { client, delivered } = setup({ streamId: STREAM, sequence: 0 });
    client.connect();
    const first = latest();
    first.open();
    first.drop();
    vi.advanceTimersByTime(60_000);
    first.receive({ type: "events", events: [event(1)] }); // stale socket
    expect(delivered()).toEqual([]);
  });
});

describe("realtime client: ordering, dedupe and resync", () => {
  it("releases out-of-order events in sequence once the gap fills, without a resync", () => {
    const { client, delivered } = setup({ streamId: STREAM, sequence: 0 });
    client.connect();
    handshake();
    latest().receive({ type: "events", events: [event(1), event(3)] });
    expect(delivered()).toEqual([1]);
    expect(client.getStats().pendingEvents).toBe(1);

    latest().receive({ type: "events", events: [event(2)] });
    expect(delivered()).toEqual([1, 2, 3]);
    vi.advanceTimersByTime(5_000); // well past the gap timeout
    expect(latest().sentOfType("hello")).toHaveLength(1); // no resync was needed
  });

  it("drops duplicates by sequence and by eventId", () => {
    const { client, delivered } = setup({ streamId: STREAM, sequence: 0 });
    client.connect();
    handshake();
    latest().receive({ type: "events", events: [event(1), event(1)] });
    latest().receive({ type: "events", events: [event(1)] });
    latest().receive({ type: "events", events: [event(2, "e1")] }); // re-sequenced duplicate
    latest().receive({ type: "events", events: [event(3)] });
    expect(delivered()).toEqual([1, 3]);
    expect(client.getStats()).toMatchObject({ duplicatesDropped: 2, staleDropped: 1 });
  });

  it("resyncs on the same socket when a gap isn't filled in time, and applies each event once", () => {
    const { client, delivered, statuses, received } = setup(
      { streamId: STREAM, sequence: 0 },
      { gapTimeoutMs: 2_000 },
    );
    client.connect();
    handshake();
    const socket = latest();
    socket.receive({ type: "events", events: [event(1), event(3), event(4)] }); // 2 was lost

    vi.advanceTimersByTime(1_999);
    expect(socket.sentOfType("hello")).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(socket.sentOfType("hello")).toHaveLength(2);
    expect(socket.sentOfType("hello")[1]).toMatchObject({
      resumeFrom: { streamId: STREAM, sequence: 1 },
    });
    expect(statuses().at(-1)).toBe("syncing");

    handshake({ head: 4, replay: [2, 3, 4] });
    expect(delivered()).toEqual([1, 2, 3, 4]);
    expect(statuses().at(-1)).toBe("live");
    expect(sockets).toHaveLength(1);
    expect(received.find((e) => e.type === "sync.started" && e.reason === "resync")).toBeTruthy();
    expect(client.getStats()).toMatchObject({ resyncs: 1, gapsDetected: 1, pendingEvents: 0 });
  });

  it("finds a trailing gap from the pong's head sequence and resyncs", () => {
    const { client, delivered } = setup({ streamId: STREAM, sequence: 0 }, { gapTimeoutMs: 500 });
    client.connect();
    handshake();
    const socket = latest();
    socket.receive({ type: "events", events: [event(1)] });
    pong(socket, 3); // the server is at 3; events 2 and 3 never arrived
    vi.advanceTimersByTime(500);
    expect(socket.sentOfType("hello").at(-1)).toMatchObject({
      resumeFrom: { streamId: STREAM, sequence: 1 },
    });
    handshake({ head: 3, replay: [2, 3] });
    expect(delivered()).toEqual([1, 2, 3]);
  });

  it("resyncs at once when the reorder buffer overflows", () => {
    const { client } = setup({ streamId: STREAM, sequence: 0 }, { maxPendingEvents: 3 });
    client.connect();
    handshake();
    latest().receive({ type: "events", events: [3, 4, 5, 6].map((s) => event(s)) });
    expect(latest().sentOfType("hello")).toHaveLength(2);
  });
});

describe("realtime client: reconnect and backoff", () => {
  it("reconnects with backoff and resumes from the last delivered sequence", () => {
    const { client, statuses, received } = setup({ streamId: STREAM, sequence: 0 });
    client.connect();
    handshake();
    latest().receive({ type: "events", events: [event(1), event(2)] });
    latest().drop();

    expect(statuses().at(-1)).toBe("reconnecting");
    expect(client.getState().disconnectedAt).toBe(Date.now());
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(expectedDelay(1));
    expect(sockets).toHaveLength(2);
    latest().open();
    expect(latest().sent[0]).toMatchObject({
      type: "hello",
      resumeFrom: { streamId: STREAM, sequence: 2 },
    });
    handshake({ head: 3, replay: [3] });
    expect(received.findLast((e) => e.type === "sync.started")).toMatchObject({
      reason: "reconnect",
    });
    expect(client.getState().disconnectedAt).toBeNull();
    // A normal catch-up replay is not a gap.
    expect(client.getStats()).toMatchObject({ gapsDetected: 0, resyncs: 0 });
  });

  it("follows the exact backoff schedule for a seeded jitter sequence", () => {
    const jitter = [0, 0.5, 0.25, 1 - 1e-9, 0.5, 0.5, 0.5];
    let draw = 0;
    const { client } = setup(null, { backoff: { random: () => jitter[draw++] ?? 0 } });
    client.connect();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      latest().drop();
      delays.push(client.getState().nextRetryAt! - Date.now());
      vi.advanceTimersByTime(delays.at(-1)!);
    }
    // equal jitter: ceiling/2 + random * ceiling/2, ceiling = min(30s, 1s * 2^(n-1))
    expect(delays).toEqual([500, 1_500, 2_500, 8_000, 12_000, 22_500, 22_500]);
  });

  it("resets the attempt counter only after the connection stays up for the grace period", () => {
    const { client } = setup(null, { stableAfterMs: 10_000 });
    client.connect();
    latest().drop();
    vi.advanceTimersByTime(60_000);
    handshake();
    latest().drop(); // flapped before it was stable: keeps backing off
    expect(client.getState().reconnectAttempt).toBe(2);

    vi.advanceTimersByTime(60_000);
    handshake();
    pong(latest()); // keep the heartbeat happy
    vi.advanceTimersByTime(9_999);
    expect(client.getState().reconnectAttempt).toBe(2);
    vi.advanceTimersByTime(1);
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

  it("reconnectNow() skips the remaining backoff wait", () => {
    const { client } = setup(null);
    client.connect();
    latest().drop();
    client.reconnectNow();
    expect(sockets).toHaveLength(2);
  });

  it("reconnectNow() during an attempt in flight retries at once if that attempt fails", () => {
    const { client } = setup(null);
    client.connect();
    for (let i = 0; i < 5; i++) {
      latest().drop();
      vi.advanceTimersByTime(60_000); // deep into backoff
    }
    expect(client.getState().status).toBe("connecting");
    client.reconnectNow(); // e.g. the network came back while this attempt was pending
    const before = sockets.length;
    latest().drop(); // the pending attempt still fails
    vi.advanceTimersByTime(0);
    expect(sockets).toHaveLength(before + 1); // no 16–30 s backoff wait
  });

  it("waits for the network while offline, then reconnects immediately when it returns", () => {
    const { client } = setup(null);
    client.connect();
    client.setNetworkStatus(false);
    latest().drop();
    expect(client.getState()).toMatchObject({ status: "reconnecting", nextRetryAt: null });
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);

    client.setNetworkStatus(true);
    expect(sockets).toHaveLength(2);
  });
});

describe("realtime client: heartbeat", () => {
  it("pings as soon as it's live and records the round-trip time", () => {
    const { client } = setup(null);
    client.connect();
    handshake();
    expect(latest().sentOfType("ping")).toHaveLength(1);
    vi.advanceTimersByTime(120);
    pong(latest());
    expect(client.getState()).toMatchObject({ rttMs: 120, degraded: false });

    vi.advanceTimersByTime(defaultHeartbeat.intervalMs);
    expect(latest().sentOfType("ping")).toHaveLength(2);
  });

  it("is degraded while a pong is overdue or slow, and recovers on a fast one", () => {
    const { client } = setup(null, { heartbeat: { degradedRttMs: 1_000, intervalMs: 5_000 } });
    client.connect();
    handshake();
    vi.advanceTimersByTime(1_001);
    expect(client.getState().degraded).toBe(true); // overdue, before any answer
    vi.advanceTimersByTime(499);
    pong(latest());
    expect(client.getState()).toMatchObject({ rttMs: 1_500, degraded: true });

    vi.advanceTimersByTime(2_000); // degraded: the next probe comes early
    vi.advanceTimersByTime(40);
    pong(latest());
    expect(client.getState()).toMatchObject({ rttMs: 40, degraded: false });
  });

  it("probes more often while degraded, so recovery shows quickly", () => {
    const { client } = setup(null, {
      heartbeat: { intervalMs: 10_000, degradedRttMs: 1_000, degradedProbeMs: 2_000 },
    });
    client.connect();
    handshake();
    vi.advanceTimersByTime(1_500);
    pong(latest());
    expect(client.getState().degraded).toBe(true);

    vi.advanceTimersByTime(2_000); // not the 10 s interval
    expect(latest().sentOfType("ping")).toHaveLength(2);
    vi.advanceTimersByTime(30);
    pong(latest());
    expect(client.getState().degraded).toBe(false);
  });

  it("abandons a socket that stops answering and reconnects", () => {
    const { client, sink } = setup(null, { heartbeat: { timeoutMs: 6_000 } });
    client.connect();
    handshake();
    const dead = latest();
    vi.advanceTimersByTime(6_000);

    expect(client.getState().status).toBe("reconnecting");
    expect(dead.closedWith).toBe(4000);
    expect(sink.get("websocket.heartbeat.timeouts")?.count).toBe(1);
    dead.drop(); // its close event arrives late and must be ignored
    expect(client.getState().reconnectAttempt).toBe(1);

    vi.advanceTimersByTime(expectedDelay(1));
    expect(sockets).toHaveLength(2);
  });

  it("probes the socket when the browser reports going offline", () => {
    const { client } = setup(null);
    client.connect();
    handshake();
    pong(latest());
    client.setNetworkStatus(false);
    expect(latest().sentOfType("ping")).toHaveLength(2);
  });
});

describe("realtime client: close()", () => {
  it("is final: no reconnect timers, no further state changes", () => {
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

  it("leaves no heartbeat, gap or stability timers behind", () => {
    const { client } = setup({ streamId: STREAM, sequence: 0 });
    client.connect();
    handshake();
    latest().receive({ type: "events", events: [event(2)] }); // arms the gap timer
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    client.close();
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
