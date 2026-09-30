import type { RealtimeEvent, UnsequencedEvent } from "@pulsedesk/contracts";
import { randomUUID } from "node:crypto";

/**
 * The gateway's event log: the single authority that assigns sequence numbers.
 *
 * The interface is what the rest of the gateway depends on. The in-memory ring buffer
 * below is the demo implementation; a production deployment would back this with a
 * durable, replicated log (Redis Streams, Kafka) where `streamId` becomes the
 * stream/partition identity and `sequence` its offset.
 */
export interface EventLog {
  /** Identity of this stream epoch. Cursors from another epoch are not resumable. */
  readonly streamId: string;
  /** Assign contiguous sequence numbers and retain the events for replay. */
  append(events: readonly UnsequencedEvent[]): RealtimeEvent[];
  /** Events with sequence > `after`, oldest first, at most `limit`. */
  readAfter(after: number, limit?: number): RealtimeEvent[];
  /** Whether every event after `sequence` is still retained. */
  canResumeFrom(sequence: number): boolean;
  headSequence(): number;
}

/**
 * Fixed-capacity ring buffer indexed by sequence. Sequences are contiguous, so the slot
 * for sequence `s` is `s % capacity` and a range read is a straight walk — O(k) reads,
 * O(1) appends, constant memory.
 */
export class InMemoryEventLog implements EventLog {
  readonly streamId: string;
  readonly #capacity: number;
  readonly #slots: (RealtimeEvent | undefined)[];
  #head = 0;

  constructor(capacity: number, streamId: string = randomUUID()) {
    if (capacity < 1) throw new Error("Event log capacity must be at least 1");
    this.#capacity = capacity;
    this.#slots = new Array<RealtimeEvent | undefined>(capacity);
    this.streamId = streamId;
  }

  append(events: readonly UnsequencedEvent[]): RealtimeEvent[] {
    return events.map((event) => {
      const sequenced = { ...event, sequence: ++this.#head } as RealtimeEvent;
      this.#slots[this.#head % this.#capacity] = sequenced;
      return sequenced;
    });
  }

  headSequence(): number {
    return this.#head;
  }

  /** Oldest retained sequence (1 until the buffer has wrapped). */
  #oldest(): number {
    return Math.max(1, this.#head - this.#capacity + 1);
  }

  canResumeFrom(sequence: number): boolean {
    return sequence <= this.#head && sequence >= this.#oldest() - 1;
  }

  readAfter(after: number, limit = Number.POSITIVE_INFINITY): RealtimeEvent[] {
    const from = Math.max(after + 1, this.#oldest());
    const to = Math.min(this.#head, after + limit);
    const events: RealtimeEvent[] = [];
    for (let sequence = from; sequence <= to; sequence++) {
      const event = this.#slots[sequence % this.#capacity];
      if (event) events.push(event);
    }
    return events;
  }
}
