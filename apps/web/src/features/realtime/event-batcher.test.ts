import type { RealtimeEvent } from "@pulsedesk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventBatcher } from "./event-batcher";

const event = (sequence: number) => ({ sequence }) as RealtimeEvent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("event batcher", () => {
  it("coalesces a burst into a single flush after the interval", () => {
    const onFlush = vi.fn();
    const batcher = createEventBatcher({ onFlush, intervalMs: 32 });
    for (let i = 1; i <= 200; i++) batcher.push([event(i)]);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(32);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![0]).toHaveLength(200);
  });

  it("flushes immediately at the size cap", () => {
    const onFlush = vi.fn();
    const batcher = createEventBatcher({ onFlush, maxSize: 3 });
    batcher.push([event(1), event(2), event(3)]);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(batcher.pending).toBe(0);
  });

  it("preserves order across pushes", () => {
    const onFlush = vi.fn();
    const batcher = createEventBatcher({ onFlush });
    batcher.push([event(1), event(2)]);
    batcher.push([event(3)]);
    batcher.flush();
    expect(onFlush.mock.calls[0]![0].map((e: RealtimeEvent) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("clear() drops pending events and cancels the timer", () => {
    const onFlush = vi.fn();
    const batcher = createEventBatcher({ onFlush });
    batcher.push([event(1)]);
    batcher.clear();
    vi.advanceTimersByTime(1_000);
    expect(onFlush).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
