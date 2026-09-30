import {
  UnsequencedEventSchema,
  decode,
  type IngestResponse,
  type RealtimeEvent,
  type UnsequencedEvent,
} from "@pulsedesk/contracts";
import type { Logger, Metrics } from "@pulsedesk/observability";
import type { EventLog } from "../websocket/replay-buffer.ts";
import type { SessionStore } from "./session-store.ts";

/** Remembers recently seen event ids (FIFO-bounded) to drop producer retries. */
class RecentIds {
  readonly #ids = new Set<string>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  /** Returns false if the id was already seen. */
  add(id: string): boolean {
    if (this.#ids.has(id)) return false;
    this.#ids.add(id);
    if (this.#ids.size > this.#capacity) {
      // Sets iterate in insertion order: the first value is the oldest.
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) this.#ids.delete(oldest);
    }
    return true;
  }
}

export interface PipelineDeps {
  log: EventLog;
  store: SessionStore;
  broadcast: (events: RealtimeEvent[]) => void;
  logger: Logger;
  metrics: Metrics;
}

/**
 * The write path: validate → deduplicate → sequence (event log) → project (session
 * store) → fan out. Everything that enters the stream — producer events, inactivity
 * transitions, presence — goes through `publish`, so ordering has a single source.
 */
export class EventPipeline {
  readonly #deps: PipelineDeps;
  readonly #recentIds = new RecentIds(50_000);

  constructor(deps: PipelineDeps) {
    this.#deps = deps;
  }

  /**
   * Accept a producer batch. Events are validated individually: one malformed event is
   * rejected with a reason instead of failing the whole batch.
   */
  ingest(rawEvents: readonly unknown[]): IngestResponse {
    const accepted: UnsequencedEvent[] = [];
    const rejected: IngestResponse["rejected"] = [];
    // Sessions created earlier in this same batch count as known.
    const createdInBatch = new Set<string>();

    rawEvents.forEach((raw, index) => {
      const result = decode(UnsequencedEventSchema, raw);
      if (!result.ok) {
        rejected.push({ index, reason: "invalid", sessionId: sessionIdOf(raw) });
        return;
      }
      const event = result.value;
      if (!this.#recentIds.add(event.eventId)) {
        rejected.push({ index, reason: "duplicate_event", sessionId: event.sessionId });
        return;
      }
      if (event.type === "session.created") {
        createdInBatch.add(event.sessionId);
      } else if (!this.#deps.store.has(event.sessionId) && !createdInBatch.has(event.sessionId)) {
        rejected.push({ index, reason: "unknown_session", sessionId: event.sessionId });
        return;
      }
      accepted.push(event);
    });

    if (rejected.length > 0) {
      this.#deps.metrics.increment("gateway.events.rejected", rejected.length);
      this.#deps.logger.debug("ingest.rejected", {
        count: rejected.length,
        reasons: [...new Set(rejected.map((r) => r.reason))],
      });
    }
    this.publish(accepted);
    this.#deps.metrics.increment("gateway.events.ingested", accepted.length);
    return { accepted: accepted.length, rejected, headSequence: this.#deps.log.headSequence() };
  }

  /** Sequence, project and broadcast events that are already trusted. */
  publish(events: readonly UnsequencedEvent[]): RealtimeEvent[] {
    if (events.length === 0) return [];
    const sequenced = this.#deps.log.append(events);
    for (const event of sequenced) this.#deps.store.apply(event);
    this.#deps.broadcast(sequenced);
    return sequenced;
  }
}

function sessionIdOf(raw: unknown): string | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "sessionId" in raw &&
    typeof raw.sessionId === "string"
  ) {
    return raw.sessionId;
  }
  return null;
}
