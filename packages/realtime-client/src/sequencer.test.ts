import { describe, expect, it } from "vitest";
import { BoundedIdSet, EventSequencer } from "./sequencer.ts";
import { clickEvent as event } from "./test/fake-socket.ts";

const sequences = (events: { sequence: number }[]) => events.map((e) => e.sequence);

describe("EventSequencer", () => {
  it("releases contiguous events and drops anything at or below the applied position", () => {
    const sequencer = new EventSequencer(5);
    expect(sequences(sequencer.accept([event(4), event(5), event(6), event(7)]))).toEqual([6, 7]);
    expect(sequencer.applied).toBe(7);
    expect(sequencer.stats.staleDropped).toBe(2);
  });

  it("holds early events in the reorder buffer and releases them in order when the gap fills", () => {
    const sequencer = new EventSequencer(0);
    expect(sequences(sequencer.accept([event(1), event(3), event(4)]))).toEqual([1]);
    expect(sequencer.hasGap).toBe(true);
    expect(sequencer.pendingCount).toBe(2);
    expect(sequencer.firstMissing).toBe(2);

    expect(sequences(sequencer.accept([event(2)]))).toEqual([2, 3, 4]);
    expect(sequencer.hasGap).toBe(false);
    expect(sequencer.stats.gapsDetected).toBe(1);
  });

  it("drops a duplicate that arrives while its twin is still buffered", () => {
    const sequencer = new EventSequencer(0);
    sequencer.accept([event(2), event(2)]);
    expect(sequences(sequencer.accept([event(1)]))).toEqual([1, 2]);
    expect(sequencer.stats.duplicatesDropped).toBe(1);
  });

  it("drops a re-sequenced duplicate by eventId, without leaving a hole where it was", () => {
    const sequencer = new EventSequencer(0);
    // The same logical event sequenced twice upstream: new sequence, same eventId.
    const released = sequencer.accept([event(1, "evt_a"), event(2, "evt_a"), event(3, "evt_b")]);
    expect(released.map((e) => e.eventId)).toEqual(["evt_a", "evt_b"]);
    expect(sequencer.applied).toBe(3);
    expect(sequencer.hasGap).toBe(false);
    expect(sequencer.stats.duplicatesDropped).toBe(1);
  });

  it("detects a trailing gap from the server-reported head, with no later event to reveal it", () => {
    const sequencer = new EventSequencer(0);
    sequencer.accept([event(1)]);
    sequencer.observeHead(3); // events 2 and 3 were lost; the stream has gone quiet
    expect(sequencer.hasGap).toBe(true);
    sequencer.accept([event(2), event(3)]);
    expect(sequencer.hasGap).toBe(false);
  });

  it("a snapshot resets the position; buffered events beyond it survive and drain", () => {
    const sequencer = new EventSequencer(0);
    sequencer.accept([event(5), event(12)]);
    sequencer.reset(10, { newStream: false });
    expect(sequencer.pendingCount).toBe(1); // 5 is superseded by the snapshot, 12 is kept
    expect(sequences(sequencer.accept([event(11)]))).toEqual([11, 12]);
  });

  it("a new stream epoch forgets buffered events and seen ids", () => {
    const sequencer = new EventSequencer(0);
    sequencer.accept([event(1, "x"), event(5)]);
    sequencer.reset(0, { newStream: true });
    expect(sequencer.pendingCount).toBe(0);
    expect(sequences(sequencer.accept([event(1, "x")]))).toEqual([1]);
  });

  it("with no starting position, the first event defines it", () => {
    const sequencer = new EventSequencer(null);
    expect(sequencer.hasGap).toBe(false);
    expect(sequences(sequencer.accept([event(8), event(7)]))).toEqual([7, 8]);
  });
});

describe("BoundedIdSet", () => {
  it("forgets the oldest ids past its capacity", () => {
    const ids = new BoundedIdSet(2);
    ids.add("a");
    ids.add("b");
    ids.add("c");
    expect([ids.has("a"), ids.has("b"), ids.has("c")]).toEqual([false, true, true]);
    expect(ids.size).toBe(2);
  });
});
