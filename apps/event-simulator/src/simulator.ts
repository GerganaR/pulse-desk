/**
 * Event simulator process: drives the pure `Simulation` with a real clock and ships
 * events to the gateway's ingest endpoint.
 *
 *   tick (250 ms) ─► Simulation.tick(now) ─► outbox ─► POST /ingest (≤ 500 per batch)
 *                                              ▲             │
 *                                              └── retry ◄───┤ network error / 5xx (backoff)
 *                    Simulation.reannounce ◄── unknown_session rejections (gateway restarted)
 */
import {
  IngestResponseSchema,
  MAX_INGEST_BATCH,
  decode,
  type UnsequencedEvent,
} from "@pulsedesk/contracts";
import { createLogger, errorFields, jsonConsoleSink } from "@pulsedesk/observability";
import { createRng } from "@pulsedesk/test-utils";
import { config } from "./config.ts";
import { Simulation } from "./simulation.ts";

const logger = createLogger({ sink: jsonConsoleSink, fields: { service: "event-simulator" } });
const simulation = new Simulation({
  rng: createRng(config.seed),
  sessionCount: config.sessionCount,
  eventRate: config.eventRate,
  errorRate: config.errorRate,
});

const outbox: UnsequencedEvent[] = [];
const stats = { sent: 0, rejected: 0, dropped: 0, reannounced: 0, failures: 0 };
let inFlight = false;
let retryAt = 0;
let consecutiveFailures = 0;

function enqueue(events: UnsequencedEvent[], { front = false } = {}) {
  if (front) outbox.unshift(...events);
  else outbox.push(...events);
  const overflow = outbox.length - config.maxOutbox;
  if (overflow > 0) {
    // Bounded memory while the gateway is down: drop the oldest activity.
    outbox.splice(0, overflow);
    stats.dropped += overflow;
  }
}

async function flush() {
  if (inFlight || outbox.length === 0 || Date.now() < retryAt) return;
  inFlight = true;
  const batch = outbox.splice(0, Math.min(config.maxBatch, MAX_INGEST_BATCH));
  try {
    const response = await fetch(`${config.gatewayUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Gateway responded ${response.status}`);
    const result = decode(IngestResponseSchema, await response.json());
    if (!result.ok) throw new Error("Unexpected ingest response");

    stats.sent += result.value.accepted;
    stats.rejected += result.value.rejected.length;
    const unknown = [
      ...new Set(
        result.value.rejected.flatMap((r) =>
          r.reason === "unknown_session" && r.sessionId ? [r.sessionId] : [],
        ),
      ),
    ];
    if (unknown.length > 0) {
      stats.reannounced += unknown.length;
      enqueue(simulation.reannounce(unknown, Date.now()), { front: true });
    }
    if (consecutiveFailures > 0)
      logger.info("gateway.reachable_again", { afterFailures: consecutiveFailures });
    consecutiveFailures = 0;
  } catch (error) {
    enqueue(batch, { front: true });
    consecutiveFailures++;
    stats.failures++;
    // Exponential backoff capped at 10s; log sparingly so a down gateway doesn't spam.
    const delay = Math.min(10_000, 250 * 2 ** Math.min(consecutiveFailures, 6));
    retryAt = Date.now() + delay;
    if (consecutiveFailures === 1 || consecutiveFailures % 10 === 0) {
      logger.warn("gateway.unreachable", {
        url: config.gatewayUrl,
        retryInMs: delay,
        queued: outbox.length,
        ...errorFields(error),
      });
    }
  } finally {
    inFlight = false;
  }
}

logger.info("simulator.starting", {
  gateway: config.gatewayUrl,
  sessionCount: config.sessionCount,
  eventRate: config.eventRate,
  errorRate: config.errorRate,
  seed: config.seed,
});

enqueue(simulation.start(Date.now()));

const ticker = setInterval(() => {
  enqueue(simulation.tick(Date.now()));
  void flush();
}, config.tickMs);

const reporter = setInterval(() => {
  logger.info("simulator.stats", { live: simulation.liveCount, queued: outbox.length, ...stats });
}, 30_000);
reporter.unref();

function shutdown(signal: string) {
  clearInterval(ticker);
  logger.info("simulator.shutdown", { signal, ...stats });
  // Sessions are intentionally not closed: the gateway's inactivity sweeper ends them,
  // exactly as it would for real visitors whose tabs vanished.
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
