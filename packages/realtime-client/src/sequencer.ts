import type { RealtimeEvent } from "@pulsedesk/contracts";

/** A Set that forgets its oldest entries past `capacity` (insertion order = age). */
export class BoundedIdSet {
  readonly #ids = new Set<string>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  add(id: string) {
    this.#ids.add(id);
    if (this.#ids.size > this.#capacity) {
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) this.#ids.delete(oldest);
    }
  }

  clear() {
    this.#ids.clear();
  }

  get size() {
    return this.#ids.size;
  }
}

export interface SequencerStats {
  /** At or below the applied position: overlap between snapshot/replay/live. */
  staleDropped: number;
  /** Same sequence arrived twice while buffered, or an already-applied eventId. */
  duplicatesDropped: number;
  /** Times the stream went from contiguous to having a hole. */
  gapsDetected: number;
}

export interface SequencerOptions {
  /** How many applied eventIds to remember for dedupe. */
  dedupeCapacity?: number;
}

/**
 * Turns whatever the network delivers (late, early, twice) into an exactly-once,
 * in-order stream. Pure and synchronous; timers and resync live in the client.
 *
 *   accept([7, 9, 8, 8, 10])  with applied = 6
 *     7        → contiguous, applied
 *     9        → early: held in the reorder buffer (gap at 8)
 *     8        → fills the gap; 8 and the buffered 9 are released
 *     8        → stale, dropped
 *     10       → contiguous, applied
 *
 * Two independent duplicate checks:
 * - by `sequence`: overlap between an HTTP snapshot, a replay and live frames.
 * - by `eventId` (bounded LRU): the same logical event sequenced twice upstream (e.g. a
 *   producer retry the gateway's own dedupe window missed). It has a *new* sequence, so
 *   the sequence check can't catch it. Its slot still counts as applied, or it would
 *   leave a permanent gap.
 */
export class EventSequencer {
  #applied: number | null;
  /** Highest sequence the server said exists (welcome, pong, sync.completed). */
  #knownHead = 0;
  readonly #pending = new Map<number, RealtimeEvent>();
  readonly #seen: BoundedIdSet;
  #hadGap = false;
  readonly stats: SequencerStats = { staleDropped: 0, duplicatesDropped: 0, gapsDetected: 0 };

  constructor(applied: number | null, { dedupeCapacity = 5_000 }: SequencerOptions = {}) {
    this.#applied = applied;
    this.#seen = new BoundedIdSet(dedupeCapacity);
  }

  /** Last sequence released to subscribers, or null before the first snapshot/cursor. */
  get applied(): number | null {
    return this.#applied;
  }

  /** Events held back waiting for an earlier one. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /**
   * True when something is known to be missing: events are buffered behind a hole, or
   * the server reported a head we haven't reached.
   */
  get hasGap(): boolean {
    if (this.#applied === null) return false;
    return this.#pending.size > 0 || this.#knownHead > this.#applied;
  }

  /** The server's view of the head (from welcome, pong or sync.completed). */
  observeHead(headSequence: number) {
    this.#knownHead = Math.max(this.#knownHead, headSequence);
    this.#noteGap();
  }

  /**
   * Restart at an authoritative position (a snapshot). Buffered events past it are kept,
   * since they may still be useful; anything at or before it is superseded.
   */
  reset(sequence: number, { newStream }: { newStream: boolean }) {
    if (newStream) {
      this.#pending.clear();
      this.#seen.clear();
      this.#knownHead = 0;
    }
    this.#applied = sequence;
    for (const key of this.#pending.keys()) if (key <= sequence) this.#pending.delete(key);
    this.#knownHead = Math.max(this.#knownHead, sequence);
    this.#hadGap = false;
  }

  /** Returns the events that became deliverable, in sequence order, each exactly once. */
  accept(events: readonly RealtimeEvent[]): RealtimeEvent[] {
    // No position yet (no SSR cursor, no snapshot): the first event defines the start.
    if (this.#applied === null) {
      const first = events.reduce<number | null>(
        (min, e) => (min === null ? e.sequence : Math.min(min, e.sequence)),
        null,
      );
      if (first === null) return [];
      this.#applied = first - 1;
    }

    for (const event of events) {
      if (event.sequence <= this.#applied) this.stats.staleDropped++;
      else if (this.#pending.has(event.sequence)) this.stats.duplicatesDropped++;
      else this.#pending.set(event.sequence, event);
    }

    const ready: RealtimeEvent[] = [];
    let next = this.#pending.get(this.#applied + 1);
    while (next) {
      this.#pending.delete(next.sequence);
      this.#applied = next.sequence;
      if (this.#seen.has(next.eventId)) {
        this.stats.duplicatesDropped++;
      } else {
        this.#seen.add(next.eventId);
        ready.push(next);
      }
      next = this.#pending.get(this.#applied + 1);
    }
    this.#knownHead = Math.max(this.#knownHead, this.#applied);
    this.#noteGap();
    return ready;
  }

  /** The lowest missing sequence, for diagnostics. */
  get firstMissing(): number | null {
    return this.hasGap && this.#applied !== null ? this.#applied + 1 : null;
  }

  #noteGap() {
    const gap = this.hasGap;
    if (gap && !this.#hadGap) this.stats.gapsDetected++;
    this.#hadGap = gap;
  }
}
