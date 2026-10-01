import type { RealtimeEvent, Session } from "@pulsedesk/contracts";
import {
  TIMELINE_LIMIT,
  createPulseStore,
  eventsReceived,
  fetchSessionDetail,
  selectFilteredSessions,
  selectSessionStats,
  selectTimeline,
  selectTopLivePages,
  snapshotReceived,
  type PulseStore,
} from "@pulsedesk/state";
import { makeSession } from "@pulsedesk/test-utils";
import { describe, expect, it } from "vitest";
import { measure, report } from "./report.ts";

const T0 = 1_760_000_000_000;
const PATHS = ["/pricing", "/docs", "/checkout", "/blog", "/signup"];

const sessions = (count: number): Session[] =>
  Array.from({ length: count }, (_, i) =>
    makeSession({ id: `s${i}`, lastActivityAt: T0 - i * 1_000, startedAt: T0 - 600_000 }),
  );

/** `count` events spread over `sessionCount` sessions, sequences continuing from `after`. */
function burst(count: number, sessionCount: number, after: number): RealtimeEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const sequence = after + 1 + i;
    const sessionId = `s${i % sessionCount}`;
    const base = { eventId: `e${sequence}`, sequence, sessionId, timestamp: T0 + sequence };
    return i % 2 === 0
      ? {
          ...base,
          type: "session.page_view",
          payload: { path: PATHS[i % PATHS.length] as string, title: "Page" },
        }
      : {
          ...base,
          type: "session.click",
          payload: { element: "cta", label: "Upgrade", path: "/pricing" },
        };
  });
}

function storeWith(sessionCount: number, timelineEvents: RealtimeEvent[] = []): PulseStore {
  const store = createPulseStore({
    extra: {
      api: {
        fetchSessionsSnapshot: () => new Promise(() => {}),
        fetchSessionDetail: async (sessionId) => ({
          streamId: "stream",
          sequence: 0,
          session: makeSession({ id: sessionId }),
          events: timelineEvents,
          truncated: false,
          viewers: [],
        }),
      },
    },
  });
  store.dispatch(
    snapshotReceived({ streamId: "stream", sequence: 0, sessions: sessions(sessionCount) }),
  );
  return store;
}

/** What a render after an update would recompute on the dashboard and the sessions page. */
function readDerived(store: PulseStore) {
  const state = store.getState();
  selectFilteredSessions(state, "all", "");
  selectSessionStats(state, T0);
  selectTopLivePages(state);
}

describe("1,000-event burst through the reducers", () => {
  const EVENTS = 1_000;
  const SESSIONS = 100;

  it("applies the burst as one batch well within a frame", () => {
    let store = storeWith(SESSIONS);
    const ms = measure(() => {
      store = storeWith(SESSIONS);
      store.dispatch(eventsReceived(burst(EVENTS, SESSIONS, 0)));
      readDerived(store);
    });
    // The setup (a 100-session snapshot) is in the measurement; it is the same for all
    // three variants below, so they compare fairly.
    report("burst-1000 one batch", { ms, eventsPerSecond: Math.round((EVENTS / ms) * 1_000) });

    expect(store.getState().sessions.sequence).toBe(EVENTS);
    expect(store.getState().sessions.entities["s0"]?.eventCount).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });

  it("batching is what keeps it cheap: the same burst, one dispatch per event", () => {
    const events = burst(EVENTS, SESSIONS, 0);
    const batched = measure(() => {
      const store = storeWith(SESSIONS);
      // 1,000 events in a second at a 32 ms window: about 32 flushes.
      for (let i = 0; i < events.length; i += 32) {
        store.dispatch(eventsReceived(events.slice(i, i + 32)));
        readDerived(store);
      }
    });
    const unbatched = measure(() => {
      const store = storeWith(SESSIONS);
      for (const event of events) {
        store.dispatch(eventsReceived([event]));
        readDerived(store);
      }
    });
    report("burst-1000 by dispatch count", {
      "32-flushes-ms": batched,
      "1000-dispatches-ms": unbatched,
      ratio: unbatched / batched,
    });
    // Each dispatch re-sorts and re-filters the session list; batching does that 32
    // times instead of 1,000.
    expect(unbatched).toBeGreaterThan(batched * 3);
  });

  it("stays linear in the number of sessions (1,000 sessions, same burst)", () => {
    const small = measure(() => {
      const store = storeWith(100);
      store.dispatch(eventsReceived(burst(EVENTS, 100, 0)));
      readDerived(store);
    });
    const large = measure(() => {
      const store = storeWith(1_000);
      store.dispatch(eventsReceived(burst(EVENTS, 1_000, 0)));
      readDerived(store);
    });
    report("burst-1000 by session count", { "100-sessions-ms": small, "1000-sessions-ms": large });
    // Ten times the sessions should cost about ten times, not a hundred.
    expect(large).toBeLessThan(small * 40 + 20);
  });
});

describe("10,000-event timeline", () => {
  const history = (count: number) =>
    Array.from({ length: count }, (_, i) => burst(1, 1, i)[0] as RealtimeEvent).map((event) => ({
      ...event,
      sessionId: "s0",
    }));

  it("appends a flush to a full timeline in well under a frame", async () => {
    const store = storeWith(10, history(TIMELINE_LIMIT));
    await store.dispatch(fetchSessionDetail("s0"));
    expect(selectTimeline(store.getState(), "s0")?.events).toHaveLength(TIMELINE_LIMIT);

    let sequence = TIMELINE_LIMIT;
    const ms = measure(
      () => {
        const events = burst(10, 1, sequence);
        sequence += 10;
        store.dispatch(eventsReceived(events));
      },
      { runs: 50 },
    );
    report(`timeline-${TIMELINE_LIMIT} append 10 events`, { ms });

    const timeline = selectTimeline(store.getState(), "s0");
    expect(timeline?.events).toHaveLength(TIMELINE_LIMIT);
    expect(timeline?.truncated).toBe(true);
    expect(timeline?.events.at(-1)?.sequence).toBe(sequence);
    expect(ms).toBeLessThan(8);
  });

  it("builds a 10,000-event timeline from live events without going quadratic", async () => {
    const store = storeWith(10);
    await store.dispatch(fetchSessionDetail("s0"));
    const events = history(10_000);

    const start = performance.now();
    for (let i = 0; i < events.length; i += 50)
      store.dispatch(eventsReceived(events.slice(i, i + 50)));
    const ms = performance.now() - start;
    report("timeline build 10000 events in 200 flushes", { ms, perFlushMs: ms / 200 });

    const timeline = selectTimeline(store.getState(), "s0");
    expect(timeline?.events).toHaveLength(10_000);
    const sequences = timeline?.events.map((e) => e.sequence) ?? [];
    expect(sequences).toEqual(Array.from({ length: 10_000 }, (_, i) => i + 1));
    expect(ms).toBeLessThan(2_000);
  });
});
