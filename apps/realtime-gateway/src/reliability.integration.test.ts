import type { RealtimeEvent, UnsequencedEvent } from "@pulsedesk/contracts";
import { createLogger } from "@pulsedesk/observability";
import { createRealtimeClient, type RealtimeClient } from "@pulsedesk/realtime-client";
import {
  createFaultInjector,
  type FaultInjector,
} from "@pulsedesk/realtime-client/fault-injection";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { createGateway, type Gateway } from "./gateway.ts";

/**
 * The real realtime client against an in-process gateway over real sockets, with the
 * fault injector between them. These are the reliability guarantees end to end:
 * whatever happens to the connection, the client applies every event exactly once and
 * in order.
 */

let gateway: Gateway;
let port: number;
let client: RealtimeClient;
let injector: FaultInjector;
let delivered: RealtimeEvent[];
let counter = 0;

const created = (id: string): UnsequencedEvent => ({
  type: "session.created",
  eventId: `c${++counter}`,
  sessionId: id,
  timestamp: Date.now(),
  payload: { session: makeSession({ id }) },
});
const click = (id: string): UnsequencedEvent => ({
  type: "session.click",
  eventId: `k${++counter}`,
  sessionId: id,
  timestamp: Date.now(),
  payload: { element: "cta", label: "Upgrade", path: "/pricing" },
});

const ingest = (events: UnsequencedEvent[]) => gateway.pipeline.ingest(events);

async function until(predicate: () => boolean, what: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function startClient(options: { gapTimeoutMs?: number } = {}) {
  injector = createFaultInjector();
  delivered = [];
  client = createRealtimeClient({
    url: `ws://127.0.0.1:${port}/ws`,
    agent: { id: "agent_1", name: "Jordan" },
    resumeFrom: null,
    transport: injector.transport,
    backoff: { baseDelayMs: 50, maxDelayMs: 200 },
    ...options,
  });
  client.subscribe((event) => {
    if (event.type === "events") delivered.push(...event.events);
  });
  client.connect();
}

/** Delivered sequences must be exactly from..to: no gap, no duplicate, in order. */
function expectContiguous(from: number, to: number) {
  const sequences = delivered.map((e) => e.sequence);
  expect(sequences).toEqual(Array.from({ length: to - from + 1 }, (_, i) => from + i));
}

beforeEach(async () => {
  gateway = createGateway({
    config: { ...loadConfig(), presenceGraceMs: 0 },
    logger: createLogger({ sink: { write: () => {} } }),
  });
  port = await gateway.listen(0, "127.0.0.1");
});

afterEach(async () => {
  client.close();
  await gateway.close();
});

describe("reliability (real client ↔ gateway)", () => {
  it("a socket killed mid-stream resumes with a contiguous replay of everything it missed", async () => {
    ingest([created("s1")]); // seq 1, in the snapshot
    startClient();
    await until(() => client.getState().status === "live", "live");

    // A producer keeps publishing throughout.
    let producing = true;
    const producer = (async () => {
      while (producing) {
        ingest([click("s1"), click("s1")]);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    })();

    await until(() => delivered.length > 20, "some live events");
    injector.disconnect(); // network cut: live socket dies, reconnects fail
    await until(() => client.getState().status === "reconnecting", "reconnecting");
    const missedFrom = gateway.log.headSequence();
    await new Promise((resolve) => setTimeout(resolve, 150)); // events keep coming meanwhile
    expect(gateway.log.headSequence()).toBeGreaterThan(missedFrom);

    injector.restore();
    client.reconnectNow();
    await until(() => client.getState().status === "live", "live again");
    producing = false;
    await producer;

    const head = gateway.log.headSequence();
    await until(() => delivered.at(-1)?.sequence === head, "caught up to head");
    expectContiguous(2, head);
    expect(client.getStats().reconnectCount).toBeGreaterThanOrEqual(1);
  });

  it("recovers lost frames by resyncing on the same socket", async () => {
    ingest([created("s1")]);
    startClient({ gapTimeoutMs: 100 });
    await until(() => client.getState().status === "live", "live");

    injector.dropEvents(3);
    ingest([click("s1"), click("s1"), click("s1")]); // 2–4: all lost in transit
    ingest([click("s1")]); // 5 arrives and reveals the gap
    await until(() => delivered.length === 4, "gap filled by resync");

    expectContiguous(2, 5);
    expect(client.getStats()).toMatchObject({ resyncs: 1, gapsDetected: 1, reconnectCount: 0 });
  });

  it("finds a trailing gap with no later event, through the heartbeat's head sequence", async () => {
    ingest([created("s1")]);
    startClient({ gapTimeoutMs: 50 });
    // Slow pongs, as under a loaded CI machine. Going live sends a ping at once, and
    // checkConnection() is a no-op while one is in flight; that pong reports the old head.
    // So wait for the first round trip, or the check below may never happen.
    injector.setLatency(300);
    await until(() => client.getState().status === "live", "live");
    await until(() => client.getState().rttMs !== null, "first heartbeat");

    injector.dropEvents(2);
    ingest([click("s1"), click("s1")]); // lost, and nothing follows them
    client.checkConnection(); // the next heartbeat reports head = 3
    await until(() => delivered.length === 2, "trailing gap filled");
    expectContiguous(2, 3);
  });

  it("applies duplicated and reordered frames exactly once, in order", async () => {
    ingest([created("s1")]);
    startClient();
    await until(() => client.getState().status === "live", "live");

    injector.duplicateNextEvent();
    ingest([click("s1")]); // 2, delivered twice
    injector.reorderNextBatch();
    ingest([click("s1")]); // 3, held back
    ingest([click("s1")]); // 4, overtakes 3
    await until(() => delivered.length === 3, "three events");

    expectContiguous(2, 4);
    expect(client.getStats()).toMatchObject({ duplicatesDropped: 1, resyncs: 0 });
  });

  it("a cursor older than the replay buffer gets a snapshot instead of a partial replay", async () => {
    await gateway.close();
    gateway = createGateway({
      config: { ...loadConfig(), replayBufferSize: 5 },
      logger: createLogger({ sink: { write: () => {} } }),
    });
    port = await gateway.listen(0, "127.0.0.1");
    ingest([created("s1")]);

    startClient();
    const snapshots: string[] = [];
    client.subscribe((event) => {
      if (event.type === "snapshot") snapshots.push(event.reason);
    });
    await until(() => client.getState().status === "live", "live");

    injector.disconnect();
    await until(() => client.getState().status === "reconnecting", "reconnecting");
    for (let i = 0; i < 10; i++) ingest([click("s1")]); // more than the buffer holds
    injector.restore();
    client.reconnectNow();
    await until(() => snapshots.length === 2, "fresh snapshot");

    expect(snapshots).toEqual(["initial", "cursor_expired"]);
    expect(client.getState().cursor?.sequence).toBe(gateway.log.headSequence());
  });
});
