import { assertNever } from "./assert-never.ts";
import type { RealtimeEvent, RealtimeEventType } from "./events.ts";
import type { Session } from "./session.ts";

/**
 * How an event changes a session: the single definition, used by the gateway (to build
 * snapshots) and by the browser (to apply live events). Sharing it guarantees that
 * "snapshot + replayed events" and "live events" converge on the same state.
 *
 * Pure and total: returns the same object when nothing changes, so callers can use
 * identity checks to skip work, and `undefined` for activity on a session that doesn't
 * exist (the caller decides whether that's an error).
 *
 * Idempotency is *not* handled here — callers only apply events newer than their cursor.
 */
export function projectSession(
  session: Session | undefined,
  event: RealtimeEvent,
): Session | undefined {
  if (event.type === "session.created") return event.payload.session;
  if (!session) return undefined;
  // An ended session is final; late or stray activity doesn't resurrect it.
  if (session.status === "closed") return session;

  const touched = {
    lastActivityAt: Math.max(session.lastActivityAt, event.timestamp),
    eventCount: session.eventCount + 1,
  };

  switch (event.type) {
    case "session.page_view":
      return {
        ...session,
        ...touched,
        status: "active",
        currentPath: event.payload.path,
        pageViews: session.pageViews + 1,
      };
    case "session.click":
    case "session.form_open":
    case "session.form_submit":
    case "session.typing":
      return { ...session, ...touched, status: "active" };
    case "session.updated":
      // Status changes are derived by the gateway (inactivity), not visitor activity.
      return event.payload.status === session.status
        ? session
        : { ...session, status: event.payload.status };
    case "session.closed":
      return {
        ...session,
        status: "closed",
        endedAt: event.timestamp,
        lastActivityAt: Math.max(session.lastActivityAt, event.timestamp),
      };
    case "presence.joined":
    case "presence.left":
      return session; // presence describes agents, not the visitor
    default:
      return assertNever(event, "event type");
  }
}

const VISITOR_ACTIVITY: ReadonlySet<RealtimeEventType> = new Set<RealtimeEventType>([
  "session.page_view",
  "session.click",
  "session.form_open",
  "session.form_submit",
  "session.typing",
]);

/** Whether an event represents something the *visitor* did (vs. system/agent events). */
export function isVisitorActivity(event: RealtimeEvent): boolean {
  return VISITOR_ACTIVITY.has(event.type);
}
