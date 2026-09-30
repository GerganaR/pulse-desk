import type { DeviceType, Session, SessionStatus } from "@pulsedesk/contracts";
import { createSelector } from "@reduxjs/toolkit";
import { sessionsAdapter, type SessionsState } from "./sessions.slice.ts";

type State = { sessions: SessionsState };

const HOUR = 60 * 60 * 1000;

const adapterSelectors = sessionsAdapter.getSelectors((state: State) => state.sessions);

export const selectAllSessions = adapterSelectors.selectAll;
export const selectSessionById = adapterSelectors.selectById;
export const selectSessionsLoadState = (state: State) => ({
  status: state.sessions.status,
  error: state.sessions.error,
});
export const selectSessionsStatus = (state: State) => state.sessions.status;
export const selectSessionsError = (state: State) => state.sessions.error;

const byRecentActivity = (a: Session, b: Session) =>
  b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id);

/** Most recently active first; ties broken by id so ordering is deterministic (SSR-safe). */
export const selectSessionsByRecentActivity = createSelector([selectAllSessions], (sessions) =>
  [...sessions].sort(byRecentActivity),
);

export const selectLiveSessions = createSelector([selectSessionsByRecentActivity], (sessions) =>
  sessions.filter((s) => s.status !== "closed"),
);

export interface SessionStats {
  active: number;
  idle: number;
  startedLast24h: number;
  /** Mean duration of sessions started in the last 24h; ongoing sessions count up to `now`. */
  avgDurationMs: number | null;
  avgPageViews: number | null;
}

/**
 * "Last 24 hours" rather than calendar "today": agents work across time zones, and a
 * rolling window means the server and the browser agree on the number (no hydration
 * mismatch around midnight).
 */
export const selectSessionStats = createSelector(
  [selectAllSessions, (_state: State, now: number) => now],
  (sessions, now): SessionStats => {
    let active = 0;
    let idle = 0;
    let recent = 0;
    let totalDuration = 0;
    let totalPageViews = 0;
    for (const s of sessions) {
      if (s.status === "active") active++;
      else if (s.status === "idle") idle++;
      if (s.startedAt >= now - 24 * HOUR) {
        recent++;
        totalDuration += Math.max(0, (s.endedAt ?? now) - s.startedAt);
        totalPageViews += s.pageViews;
      }
    }
    return {
      active,
      idle,
      startedLast24h: recent,
      avgDurationMs: recent > 0 ? totalDuration / recent : null,
      avgPageViews: recent > 0 ? totalPageViews / recent : null,
    };
  },
);

export const ACTIVITY_BUCKET_MS = 5 * 60 * 1000;
export const ACTIVITY_BUCKET_COUNT = 12;

export interface ActivityBucket {
  start: number;
  end: number;
  count: number;
}

/** Floor `now` to the bucket grid. Pass this (not raw `now`) to keep memoisation effective. */
export const alignToActivityBucket = (now: number) =>
  Math.floor(now / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS;

/**
 * Sessions started per 5-minute bucket over the last hour. The final bucket is the
 * current, partial one. Recomputes only when a session is added/changed or the aligned
 * clock crosses a bucket boundary.
 */
export const selectSessionActivity = createSelector(
  [selectAllSessions, (_state: State, alignedNow: number) => alignedNow],
  (sessions, alignedNow): ActivityBucket[] => {
    const firstStart = alignedNow - (ACTIVITY_BUCKET_COUNT - 1) * ACTIVITY_BUCKET_MS;
    const buckets = Array.from({ length: ACTIVITY_BUCKET_COUNT }, (_, i) => ({
      start: firstStart + i * ACTIVITY_BUCKET_MS,
      end: firstStart + (i + 1) * ACTIVITY_BUCKET_MS,
      count: 0,
    }));
    for (const s of sessions) {
      const index = Math.floor((s.startedAt - firstStart) / ACTIVITY_BUCKET_MS);
      const bucket = buckets[index];
      if (bucket) bucket.count++;
    }
    return buckets;
  },
);

export interface PageCount {
  path: string;
  count: number;
}

export const selectTopLivePages = createSelector([selectLiveSessions], (sessions): PageCount[] => {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.currentPath, (counts.get(s.currentPath) ?? 0) + 1);
  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 5);
});

export const selectLiveDeviceBreakdown = createSelector(
  [selectLiveSessions],
  (sessions): Record<DeviceType, number> => {
    const counts: Record<DeviceType, number> = { desktop: 0, mobile: 0, tablet: 0 };
    for (const s of sessions) counts[s.device]++;
    return counts;
  },
);

export type StatusFilter = "all" | SessionStatus;

export const selectStatusCounts = createSelector(
  [selectAllSessions],
  (sessions): Record<StatusFilter, number> => {
    const counts: Record<StatusFilter, number> = {
      all: sessions.length,
      active: 0,
      idle: 0,
      closed: 0,
    };
    for (const s of sessions) counts[s.status]++;
    return counts;
  },
);

function matchesQuery(session: Session, query: string): boolean {
  const { visitor } = session;
  return [visitor.label, visitor.name ?? "", visitor.city, session.currentPath, session.id]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

/** Filtered + ordered list for the sessions table. Arguments are primitives so the memo hits. */
export const selectFilteredSessions = createSelector(
  [
    selectSessionsByRecentActivity,
    (_state: State, status: StatusFilter) => status,
    (_state: State, _status: StatusFilter, query: string) => query.trim().toLowerCase(),
  ],
  (sessions, status, query) =>
    sessions.filter(
      (s) => (status === "all" || s.status === status) && (query === "" || matchesQuery(s, query)),
    ),
);
