import type { SessionsState } from "./sessions.slice.ts";

/**
 * How long an ended session stays in a tab, and how many are kept. The gateway ages
 * ended sessions out of its snapshots with the same defaults; a tab that stays open for
 * days only ever receives events, never that clean-up, so it does its own. Without it the
 * session list, and everything derived from it on each event, grows without bound.
 */
export const CLOSED_SESSION_RETENTION_MS = 6 * 60 * 60 * 1_000;
export const MAX_CLOSED_SESSIONS = 300;

/**
 * Ended sessions that are past retention at `now`: older than the window, or beyond the
 * cap (oldest first). `now` is the stream's clock (the newest event's timestamp), not the
 * browser's, so the result doesn't depend on the tab's clock being right.
 */
export function selectExpiredSessionIds(state: { sessions: SessionsState }, now: number): string[] {
  const closed: { id: string; endedAt: number }[] = [];
  for (const id of state.sessions.ids) {
    const session = state.sessions.entities[id];
    if (session?.status === "closed")
      closed.push({ id, endedAt: session.endedAt ?? session.lastActivityAt });
  }
  closed.sort((a, b) => b.endedAt - a.endedAt);
  return closed
    .filter(
      ({ endedAt }, index) =>
        index >= MAX_CLOSED_SESSIONS || now - endedAt > CLOSED_SESSION_RETENTION_MS,
    )
    .map(({ id }) => id);
}
