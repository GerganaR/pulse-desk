import type { SessionsSnapshot } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { PulseApi } from "../api.ts";
import { createPulseStore } from "../store.ts";
import {
  ACTIVITY_BUCKET_COUNT,
  ACTIVITY_BUCKET_MS,
  alignToActivityBucket,
  selectFilteredSessions,
  selectSessionActivity,
  selectSessionStats,
  selectSessionsByRecentActivity,
  selectStatusCounts,
  selectTopLivePages,
} from "./sessions.selectors.ts";
import { snapshotReceived } from "../realtime/realtime.actions.ts";
import { fetchSessionsSnapshot } from "./sessions.slice.ts";

const now = 1_760_000_000_000;
const MIN = 60_000;

const snapshot: SessionsSnapshot = {
  streamId: "stream-1",
  sequence: 120,
  sessions: [
    makeSession({
      id: "a",
      status: "active",
      startedAt: now - 10 * MIN,
      lastActivityAt: now - 1_000,
      currentPath: "/pricing",
    }),
    makeSession({
      id: "b",
      status: "idle",
      startedAt: now - 30 * MIN,
      lastActivityAt: now - 5 * MIN,
      currentPath: "/pricing",
    }),
    makeSession({
      id: "c",
      status: "closed",
      startedAt: now - 2 * 60 * MIN,
      lastActivityAt: now - 100 * MIN,
      endedAt: now - 100 * MIN,
      currentPath: "/checkout",
    }),
    makeSession({
      id: "d",
      status: "active",
      startedAt: now - 2 * MIN,
      lastActivityAt: now - 1_000,
      currentPath: "/docs/getting-started",
      visitor: { id: "v", label: "Visitor #4242", name: "Amara", city: "Lisbon", country: "PT" },
    }),
  ],
};

function storeWith(api: Partial<PulseApi> = {}) {
  const fullApi: PulseApi = {
    fetchSessionsSnapshot: vi.fn(async () => snapshot),
    fetchSessionDetail: vi.fn(async () => null),
    ...api,
  };
  return { store: createPulseStore({ extra: { api: fullApi } }), api: fullApi };
}

describe("sessions slice", () => {
  it("loads a snapshot and records its stream position", async () => {
    const { store } = storeWith();
    await store.dispatch(fetchSessionsSnapshot());
    const state = store.getState().sessions;
    expect(state.status).toBe("ready");
    expect(state.sequence).toBe(120);
    expect(state.ids).toHaveLength(4);
  });

  it("does not issue a second request while one is in flight", async () => {
    const { store, api } = storeWith();
    await Promise.all([
      store.dispatch(fetchSessionsSnapshot()),
      store.dispatch(fetchSessionsSnapshot()),
    ]);
    expect(api.fetchSessionsSnapshot).toHaveBeenCalledOnce();
  });

  it("exposes a readable error when the request fails", async () => {
    const { store } = storeWith({
      fetchSessionsSnapshot: async () => {
        throw new Error("Gateway unavailable");
      },
    });
    await store.dispatch(fetchSessionsSnapshot());
    expect(store.getState().sessions).toMatchObject({
      status: "error",
      error: "Gateway unavailable",
    });
  });

  it("treats an aborted request as cancelled, not failed", async () => {
    const { store } = storeWith({
      fetchSessionsSnapshot: (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });
    const request = store.dispatch(fetchSessionsSnapshot());
    request.abort();
    await request;
    expect(store.getState().sessions).toMatchObject({ status: "idle", error: null });
  });

  it("replaces entities wholesale on a new snapshot (removed sessions disappear)", () => {
    const { store } = storeWith();
    store.dispatch(snapshotReceived(snapshot));
    store.dispatch(
      snapshotReceived({ streamId: "stream-1", sequence: 130, sessions: [snapshot.sessions[0]!] }),
    );
    expect(store.getState().sessions.ids).toEqual(["a"]);
  });
});

describe("session selectors", () => {
  const { store } = storeWith();
  store.dispatch(snapshotReceived(snapshot));
  const state = store.getState();

  it("orders by most recent activity with a deterministic tie-break", () => {
    expect(selectSessionsByRecentActivity(state).map((s) => s.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("computes stats over a rolling 24h window, counting ongoing sessions up to now", () => {
    const stats = selectSessionStats(state, now);
    expect(stats).toMatchObject({ active: 2, idle: 1, startedLast24h: 4 });
    // a=10m, b=30m, c=20m (ended), d=2m → mean 15.5m
    expect(stats.avgDurationMs).toBe(15.5 * MIN);
  });

  it("returns null averages instead of NaN when there is no data", () => {
    const empty = storeWith().store.getState();
    expect(selectSessionStats(empty, now)).toMatchObject({
      avgDurationMs: null,
      avgPageViews: null,
    });
  });

  it("buckets session starts into the last hour on a stable grid", () => {
    const aligned = alignToActivityBucket(now);
    const buckets = selectSessionActivity(state, aligned);
    expect(buckets).toHaveLength(ACTIVITY_BUCKET_COUNT);
    expect(buckets.at(-1)!.start).toBe(aligned);
    expect(buckets.every((b) => b.end - b.start === ACTIVITY_BUCKET_MS)).toBe(true);
    // c started 2h ago — outside the window
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
  });

  it("memoises on the aligned clock so ticking seconds don't recompute", () => {
    const aligned = alignToActivityBucket(now);
    expect(selectSessionActivity(state, aligned)).toBe(selectSessionActivity(state, aligned));
  });

  it("ranks the pages live visitors are on", () => {
    expect(selectTopLivePages(state)).toEqual([
      { path: "/pricing", count: 2 },
      { path: "/docs/getting-started", count: 1 },
    ]);
  });

  it("counts sessions per status for filter tabs", () => {
    expect(selectStatusCounts(state)).toEqual({ all: 4, active: 2, idle: 1, closed: 1 });
  });

  it.each([
    ["all", "", ["a", "d", "b", "c"]],
    ["active", "", ["a", "d"]],
    ["all", "amara", ["d"]],
    ["all", "  LISBON ", ["d"]],
    ["all", "/checkout", ["c"]],
    ["idle", "pricing", ["b"]],
  ] as const)("filters status=%s query=%j", (status, query, expected) => {
    expect(selectFilteredSessions(state, status, query).map((s) => s.id)).toEqual(expected);
  });
});
