import type { RealtimeEvent } from "@pulsedesk/contracts";
import { DEFAULT_EVENT_BATCH_MS } from "@/lib/bootstrap";

export interface EventBatcherOptions {
  onFlush: (events: RealtimeEvent[]) => void;
  /** Max time an event waits before being applied. ~2 frames: imperceptible, but coalesces bursts. */
  intervalMs?: number;
  /** Flush immediately at this size so a burst never builds an unbounded buffer. */
  maxSize?: number;
}

/**
 * Coalesces realtime events into one Redux dispatch per window:
 *
 *   socket frames ─► push() ─► buffer ─► flush after `intervalMs` (or at `maxSize`)
 *                                          └─► one eventsReceived(batch) → one render
 *
 * During a replay of 800 missed events, or a traffic burst, the UI does a handful of
 * renders instead of hundreds. Latency cost: at most `intervalMs`.
 */
export function createEventBatcher({
  onFlush,
  intervalMs = DEFAULT_EVENT_BATCH_MS,
  maxSize = 1_000,
}: EventBatcherOptions) {
  let buffer: RealtimeEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    onFlush(batch);
  };

  return {
    push(events: readonly RealtimeEvent[]) {
      buffer.push(...events);
      if (buffer.length >= maxSize) flush();
      else timer ??= setTimeout(flush, intervalMs);
    },
    flush,
    /** Drop pending events (e.g. a snapshot superseded them). */
    clear() {
      clearTimeout(timer);
      timer = undefined;
      buffer = [];
    },
    get pending() {
      return buffer.length;
    },
  };
}

export type EventBatcher = ReturnType<typeof createEventBatcher>;
