import { MAX_INGEST_BATCH, type UnsequencedEvent } from "@pulsedesk/contracts";
import { Simulation } from "@pulsedesk/event-simulator/src/simulation.ts";
import { createLogger, createMemorySink } from "@pulsedesk/observability";
import { createRealtimeClient } from "@pulsedesk/realtime-client";
import { loadConfig } from "@pulsedesk/realtime-gateway/src/config.ts";
import { createGateway, type Gateway } from "@pulsedesk/realtime-gateway/src/gateway.ts";
import { createRng } from "@pulsedesk/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { report } from "./report.ts";

const SESSIONS = 100;
const CLIENTS = 5;
/**
 * Simulated time: half an hour of visits, sent as fast as the gateway takes them. Visitors
 * finish their journeys and new ones arrive a few seconds apart, so the population turns
 * over several times.
 */
const SIMULATED_MS = 30 * 60_000;
const EVENT_RATE = 50;
const TICK_MS = 250;

let gateway: Gateway | undefined;
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

const until = async (condition: () => boolean, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the gateway/clients");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("100 concurrent simulated sessions", () => {
  it("every connected client receives every event exactly once, in order", async () => {
    const metrics = createMemorySink();
    gateway = createGateway({
      config: { ...loadConfig(), replayBufferSize: 200_000 },
      logger: createLogger({ sink: { write: () => {} } }),
      metricSink: metrics,
    });
    const port = await gateway.listen(0, "127.0.0.1");
    const http = `http://127.0.0.1:${port}`;

    // Real clients over real WebSockets (Node's built-in), connected before the traffic.
    const clients = Array.from({ length: CLIENTS }, (_, i) => {
      const sequences: number[] = [];
      const client = createRealtimeClient({
        url: `ws://127.0.0.1:${port}/ws`,
        agent: { id: `agent_${i}`, name: `Load ${i}` },
        resumeFrom: null,
      });
      client.subscribe((event) => {
        if (event.type === "events") for (const e of event.events) sequences.push(e.sequence);
      });
      client.connect();
      return { client, sequences };
    });
    await until(() => clients.every(({ client }) => client.getState().status === "live"));

    const simulation = new Simulation({
      rng: createRng(42),
      sessionCount: SESSIONS,
      eventRate: EVENT_RATE,
      errorRate: 0,
    });
    const startedAt = Date.now();
    const outbox: UnsequencedEvent[] = simulation.start(startedAt);
    let sent = 0;
    let peakLive = 0;

    const flush = async () => {
      while (outbox.length > 0) {
        const batch = outbox.splice(0, MAX_INGEST_BATCH);
        const response = await fetch(`${http}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
        });
        const result = (await response.json()) as { accepted: number; rejected: unknown[] };
        expect(result.rejected).toEqual([]);
        sent += result.accepted;
      }
    };

    const wallStart = performance.now();
    for (let elapsed = 0; elapsed <= SIMULATED_MS; elapsed += TICK_MS) {
      outbox.push(...simulation.tick(startedAt + elapsed));
      peakLive = Math.max(peakLive, simulation.liveCount);
      if (outbox.length >= 200) await flush();
    }
    await flush();
    const ingestMs = performance.now() - wallStart;

    const head = gateway.log.headSequence();
    await until(() => clients.every(({ sequences }) => sequences.at(-1) === head));
    const totalMs = performance.now() - wallStart;

    const broadcast = metrics.get("gateway.broadcast.duration");
    report(`gateway ${SESSIONS} sessions, ${CLIENTS} clients`, {
      events: sent,
      peakLiveSessions: peakLive,
      ingestMs,
      eventsPerSecond: Math.round((sent / ingestMs) * 1_000),
      deliveredToAllMs: totalMs,
      broadcastAvgMs: broadcast ? broadcast.sum / broadcast.count : 0,
      broadcastMaxMs: broadcast?.max ?? 0,
    });

    expect(peakLive).toBeGreaterThanOrEqual(SESSIONS);
    expect(sent).toBeGreaterThan(5_000);
    for (const { client, sequences } of clients) {
      // Presence and system events are sequenced too, so clients see more than `sent`;
      // what matters is that nothing between the first and the head is missing or doubled.
      const first = sequences[0] as number;
      expect(sequences).toEqual(Array.from({ length: head - first + 1 }, (_, i) => first + i));
      const stats = client.getStats();
      expect(stats).toMatchObject({ gapsDetected: 0, resyncs: 0, duplicatesDropped: 0 });
      expect(stats.reconnectCount).toBe(0);
      client.close();
    }
    // Fan-out to a handful of sockets must not be where the time goes.
    expect(broadcast?.max ?? 0).toBeLessThan(250);
  });
});
