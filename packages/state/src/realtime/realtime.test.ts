import type { Agent, RealtimeEvent, SessionDetailSnapshot } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import { describe, expect, it } from "vitest";
import type { PulseApi } from "../api.ts";
import { selectViewers } from "../presence/presence.slice.ts";
import { selectSessionById } from "../sessions/sessions.selectors.ts";
import { createPulseStore } from "../store.ts";
import { fetchSessionDetail, selectTimeline, TIMELINE_LIMIT } from "../timeline/timeline.slice.ts";
import { eventsReceived, snapshotReceived } from "./realtime.actions.ts";

const T0 = 1_760_000_000_000;
const agent: Agent = { id: "a1", name: "Jordan" };

const click = (sequence: number, sessionId = "s1"): RealtimeEvent => ({
  type: "session.click",
  eventId: `e${sequence}`,
  sequence,
  sessionId,
  timestamp: T0 + sequence,
  payload: { element: "cta", label: "Upgrade", path: "/pricing" },
});
const view = (sequence: number, path: string, sessionId = "s1"): RealtimeEvent => ({
  type: "session.page_view",
  eventId: `e${sequence}`,
  sequence,
  sessionId,
  timestamp: T0 + sequence,
  payload: { path, title: path },
});

function setup(detail: Partial<SessionDetailSnapshot> | null = null) {
  const api: PulseApi = {
    fetchSessionsSnapshot: () => new Promise(() => {}),
    fetchSessionDetail: async (sessionId) =>
      detail && {
        streamId: "stream-1",
        sequence: 10,
        session: makeSession({ id: sessionId }),
        events: [],
        truncated: false,
        viewers: [],
        ...detail,
      },
  };
  const store = createPulseStore({ extra: { api } });
  store.dispatch(
    snapshotReceived({
      streamId: "stream-1",
      sequence: 10,
      sessions: [makeSession({ id: "s1", pageViews: 1 })],
    }),
  );
  return store;
}

describe("sessions × realtime events", () => {
  it("applies a batch through the shared projection", () => {
    const store = setup();
    store.dispatch(eventsReceived([view(11, "/pricing"), click(12)]));
    const session = selectSessionById(store.getState(), "s1")!;
    expect(session).toMatchObject({ currentPath: "/pricing", pageViews: 2, eventCount: 3 });
    expect(store.getState().sessions.sequence).toBe(12);
  });

  it("is idempotent: replayed or overlapping events are not applied twice", () => {
    const store = setup();
    store.dispatch(eventsReceived([view(11, "/pricing")]));
    store.dispatch(eventsReceived([view(9, "/old"), view(11, "/pricing"), view(12, "/checkout")]));
    expect(selectSessionById(store.getState(), "s1")).toMatchObject({
      pageViews: 3,
      currentPath: "/checkout",
    });
  });

  it("adds sessions announced by session.created", () => {
    const store = setup();
    store.dispatch(
      eventsReceived([
        {
          type: "session.created",
          eventId: "c",
          sequence: 11,
          sessionId: "s2",
          timestamp: T0,
          payload: { session: makeSession({ id: "s2" }) },
        },
      ]),
    );
    expect(store.getState().sessions.ids).toContain("s2");
  });

  it("ignores a stale snapshot of the same stream (slow HTTP after live events)", () => {
    const store = setup();
    store.dispatch(eventsReceived([view(11, "/pricing")]));
    store.dispatch(snapshotReceived({ streamId: "stream-1", sequence: 10, sessions: [] }));
    expect(store.getState().sessions.ids).toEqual(["s1"]);
  });

  it("accepts a snapshot from a new stream epoch even with a lower sequence", () => {
    const store = setup();
    store.dispatch(
      snapshotReceived({
        streamId: "stream-2",
        sequence: 2,
        sessions: [makeSession({ id: "fresh" })],
      }),
    );
    expect(store.getState().sessions).toMatchObject({
      streamId: "stream-2",
      sequence: 2,
      ids: ["fresh"],
    });
  });
});

describe("timelines", () => {
  it("only tracks sessions whose timeline was requested", () => {
    const store = setup();
    store.dispatch(eventsReceived([click(11)]));
    expect(selectTimeline(store.getState(), "s1")).toBeUndefined();
  });

  it("merges history with live events that arrived while it was loading", async () => {
    const store = setup({ events: [click(8), click(9), click(10), click(11)] });
    const request = store.dispatch(fetchSessionDetail("s1"));
    store.dispatch(eventsReceived([click(11), click(12)])); // live, during the fetch
    await request;

    const timeline = selectTimeline(store.getState(), "s1")!;
    expect(timeline.history).toBe("ready");
    expect(timeline.events.map((e) => e.sequence)).toEqual([8, 9, 10, 11, 12]);
  });

  it("marks unknown sessions as missing", async () => {
    const store = setup(null);
    await store.dispatch(fetchSessionDetail("nope"));
    expect(selectTimeline(store.getState(), "nope")?.history).toBe("missing");
  });

  it("stays bounded and flags truncation", async () => {
    const store = setup({ events: [] });
    await store.dispatch(fetchSessionDetail("s1"));
    store.dispatch(
      eventsReceived(Array.from({ length: TIMELINE_LIMIT + 50 }, (_, i) => click(11 + i))),
    );
    const timeline = selectTimeline(store.getState(), "s1")!;
    expect(timeline.events).toHaveLength(TIMELINE_LIMIT);
    expect(timeline.truncated).toBe(true);
    expect(timeline.events.at(-1)!.sequence).toBe(10 + TIMELINE_LIMIT + 50);
  });

  it("drops timelines when the stream epoch changes (sequences restart)", async () => {
    const store = setup({ events: [click(9)] });
    await store.dispatch(fetchSessionDetail("s1"));
    store.dispatch(snapshotReceived({ streamId: "stream-2", sequence: 1, sessions: [] }));
    expect(selectTimeline(store.getState(), "s1")).toBeUndefined();
  });
});

describe("presence", () => {
  const presence = (
    sequence: number,
    type: "presence.joined" | "presence.left",
    who: Agent = agent,
  ): RealtimeEvent => ({
    type,
    eventId: `p${sequence}`,
    sequence,
    sessionId: "s1",
    timestamp: T0,
    payload: { agent: who },
  });

  it("tracks viewers from detail snapshots and presence events", async () => {
    const other = { id: "a2", name: "Sam" };
    const store = setup({ viewers: [other] });
    await store.dispatch(fetchSessionDetail("s1"));
    store.dispatch(
      eventsReceived([presence(11, "presence.joined"), presence(12, "presence.joined")]),
    );
    expect(selectViewers(store.getState(), "s1")).toEqual([other, agent]); // no duplicates
    store.dispatch(eventsReceived([presence(13, "presence.left", other)]));
    expect(selectViewers(store.getState(), "s1")).toEqual([agent]);
  });

  it("returns a stable empty list for unwatched sessions", () => {
    const store = setup();
    expect(selectViewers(store.getState(), "x")).toBe(selectViewers(store.getState(), "y"));
  });
});
