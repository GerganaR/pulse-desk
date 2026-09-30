import type { RealtimeEvent, UnsequencedEvent } from "@pulsedesk/contracts";
import { createLogger, noopMetrics } from "@pulsedesk/observability";
import { makeSession } from "@pulsedesk/test-utils";
import { describe, expect, it, vi } from "vitest";
import { EventPipeline } from "./events/pipeline.ts";
import { SessionStore } from "./events/session-store.ts";
import { InMemoryEventLog } from "./websocket/replay-buffer.ts";
import { SessionRooms } from "./websocket/session-room.ts";

const T0 = 1_760_000_000_000;
const silent = createLogger({ sink: { write: () => {} } });
let counter = 0;

const created = (sessionId: string, at = T0): UnsequencedEvent => ({
  type: "session.created",
  eventId: `e${++counter}`,
  sessionId,
  timestamp: at,
  payload: { session: makeSession({ id: sessionId, startedAt: at, lastActivityAt: at }) },
});
const pageView = (sessionId: string, path = "/pricing", at = T0 + 1000): UnsequencedEvent => ({
  type: "session.page_view",
  eventId: `e${++counter}`,
  sessionId,
  timestamp: at,
  payload: { path, title: path },
});

const storeOptions = {
  timelineLimit: 20,
  idleAfterMs: 45_000,
  closeAfterMs: 180_000,
  closedRetentionMs: 3_600_000,
  maxClosedSessions: 2,
};

describe("InMemoryEventLog", () => {
  it("assigns contiguous sequences starting at 1", () => {
    const log = new InMemoryEventLog(10, "stream-a");
    expect(log.append([created("s1"), pageView("s1")]).map((e) => e.sequence)).toEqual([1, 2]);
    expect(log.headSequence()).toBe(2);
  });

  it("reads everything after a cursor, respecting limits", () => {
    const log = new InMemoryEventLog(10);
    log.append(Array.from({ length: 5 }, () => pageView("s1")));
    expect(log.readAfter(2).map((e) => e.sequence)).toEqual([3, 4, 5]);
    expect(log.readAfter(0, 2).map((e) => e.sequence)).toEqual([1, 2]);
    expect(log.readAfter(5)).toEqual([]);
  });

  it("only allows resuming while every missed event is still retained", () => {
    const log = new InMemoryEventLog(3);
    log.append(Array.from({ length: 5 }, () => pageView("s1"))); // retains 3,4,5
    expect(log.canResumeFrom(2)).toBe(true); // needs 3.. → retained
    expect(log.canResumeFrom(1)).toBe(false); // needs 2 → overwritten
    expect(log.canResumeFrom(6)).toBe(false); // cursor from the future (other epoch)
    expect(log.readAfter(0).map((e) => e.sequence)).toEqual([3, 4, 5]);
  });
});

describe("SessionStore", () => {
  const apply = (store: SessionStore, log: InMemoryEventLog, events: UnsequencedEvent[]) =>
    log.append(events).forEach((e) => store.apply(e));

  it("marks quiet sessions idle, then closes them", () => {
    const store = new SessionStore(storeOptions);
    const log = new InMemoryEventLog(100);
    apply(store, log, [created("s1")]);
    store.get("s1")!.status = "active";

    const idle = store.sweep(T0 + 50_000);
    expect(idle).toMatchObject([{ type: "session.updated", payload: { status: "idle" } }]);
    apply(store, log, idle);
    expect(store.sweep(T0 + 60_000)).toEqual([]); // no repeated transitions

    const closed = store.sweep(T0 + 200_000);
    expect(closed).toMatchObject([
      { type: "session.closed", payload: { reason: "inactivity_timeout" } },
    ]);
  });

  it("keeps only the most recent ended sessions", () => {
    const store = new SessionStore(storeOptions);
    const log = new InMemoryEventLog(100);
    for (const id of ["a", "b", "c"]) {
      apply(store, log, [
        created(id),
        {
          type: "session.closed",
          eventId: `close-${id}-${++counter}`,
          sessionId: id,
          timestamp: T0 + counter,
          payload: { reason: "tab_closed" },
        },
      ]);
    }
    store.sweep(T0 + 1_000);
    expect(
      store
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["b", "c"]);
  });

  it("bounds the timeline and reports truncation", () => {
    const store = new SessionStore(storeOptions);
    const log = new InMemoryEventLog(100);
    apply(store, log, [created("s1"), ...Array.from({ length: 30 }, () => pageView("s1"))]);
    const detail = store.detail("s1")!;
    expect(detail.events.length).toBeLessThanOrEqual(20);
    expect(detail.truncated).toBe(true);
    expect(detail.events.at(-1)!.sequence).toBe(31); // newest kept
  });
});

describe("EventPipeline", () => {
  function setup() {
    const log = new InMemoryEventLog(100);
    const store = new SessionStore(storeOptions);
    const broadcast = vi.fn<(events: RealtimeEvent[]) => void>();
    const pipeline = new EventPipeline({
      log,
      store,
      broadcast,
      logger: silent,
      metrics: noopMetrics,
    });
    return { log, store, broadcast, pipeline };
  }

  it("accepts a new session and its activity in one batch", () => {
    const { pipeline, store, broadcast } = setup();
    const response = pipeline.ingest([created("s1"), pageView("s1")]);
    expect(response).toMatchObject({ accepted: 2, rejected: [], headSequence: 2 });
    expect(store.get("s1")?.currentPath).toBe("/pricing");
    expect(broadcast.mock.calls[0]![0].map((e) => e.sequence)).toEqual([1, 2]);
  });

  it("rejects invalid events individually, not the whole batch", () => {
    const { pipeline } = setup();
    const response = pipeline.ingest([
      created("s1"),
      { type: "session.teleport", sessionId: "s1" },
      pageView("s1"),
    ]);
    expect(response.accepted).toBe(2);
    expect(response.rejected).toEqual([{ index: 1, reason: "invalid", sessionId: "s1" }]);
  });

  it("tells the producer when it sends activity for an unknown session", () => {
    const { pipeline } = setup();
    expect(pipeline.ingest([pageView("ghost")]).rejected).toEqual([
      { index: 0, reason: "unknown_session", sessionId: "ghost" },
    ]);
  });

  it("drops producer retries by event id", () => {
    const { pipeline, log } = setup();
    const event = created("s1");
    pipeline.ingest([event]);
    expect(pipeline.ingest([event]).rejected[0]?.reason).toBe("duplicate_event");
    expect(log.headSequence()).toBe(1);
  });
});

describe("SessionRooms", () => {
  const agent = { id: "a1", name: "Jordan" };

  it("tracks presence per agent across multiple tabs", () => {
    const rooms = new SessionRooms();
    expect(rooms.watch("c1", agent, "s1")).toMatchObject({ type: "joined" });
    expect(rooms.watch("c2", agent, "s1")).toBeNull(); // second tab: no duplicate join
    expect(rooms.unwatch("c1", agent.id, "s1")).toBeNull(); // one tab still open
    expect(rooms.viewers("s1")).toEqual([agent]);
    expect(rooms.leaveAll("c2", agent.id)).toMatchObject([{ type: "left", sessionId: "s1" }]);
    expect(rooms.viewers("s1")).toEqual([]);
  });
});
