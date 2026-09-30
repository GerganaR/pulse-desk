import { describe, expect, it } from "vitest";
import type { RealtimeEvent, RealtimeEventOf, RealtimeEventType, Session } from "./index.ts";
import { projectSession } from "./projection.ts";

const T0 = 1_760_000_000_000;

const session: Session = {
  id: "ses_1",
  visitor: { id: "v1", label: "Visitor #1", name: null, country: "BG", city: "Sofia" },
  device: "desktop",
  browser: "Chrome",
  os: "macOS",
  referrer: null,
  landingPath: "/",
  currentPath: "/",
  status: "idle",
  startedAt: T0,
  lastActivityAt: T0,
  endedAt: null,
  pageViews: 1,
  eventCount: 1,
};

let seq = 0;
function event<T extends RealtimeEventType>(
  type: T,
  payload: RealtimeEventOf<T>["payload"],
  timestamp = T0 + 1_000,
): RealtimeEvent {
  seq++;
  return {
    type,
    payload,
    eventId: `e${seq}`,
    sequence: seq,
    sessionId: "ses_1",
    timestamp,
  } as RealtimeEvent;
}

describe("projectSession", () => {
  it("creates a session from session.created", () => {
    expect(projectSession(undefined, event("session.created", { session }))).toBe(session);
  });

  it("ignores activity for unknown sessions", () => {
    expect(
      projectSession(undefined, event("session.click", { element: "cta", label: "Go", path: "/" })),
    ).toBeUndefined();
  });

  it("page views move the visitor, count, and reactivate an idle session", () => {
    const next = projectSession(
      session,
      event("session.page_view", { path: "/pricing", title: "Pricing" }),
    );
    expect(next).toMatchObject({
      currentPath: "/pricing",
      pageViews: 2,
      eventCount: 2,
      status: "active",
      lastActivityAt: T0 + 1_000,
    });
  });

  it("never moves lastActivityAt backwards for a late-stamped event", () => {
    const later = { ...session, lastActivityAt: T0 + 60_000 };
    const next = projectSession(
      later,
      event("session.click", { element: "cta", label: "Go", path: "/" }, T0 + 5_000),
    );
    expect(next?.lastActivityAt).toBe(T0 + 60_000);
  });

  it("closing sets endedAt and makes the session final", () => {
    const closed = projectSession(
      session,
      event("session.closed", { reason: "tab_closed" }, T0 + 9_000),
    )!;
    expect(closed).toMatchObject({ status: "closed", endedAt: T0 + 9_000 });
    const after = projectSession(closed, event("session.page_view", { path: "/x", title: "X" }));
    expect(after).toBe(closed);
  });

  it("returns the same object when nothing changes (cheap identity checks)", () => {
    const agent = { id: "a", name: "Agent" };
    expect(projectSession(session, event("presence.joined", { agent }))).toBe(session);
    expect(projectSession(session, event("session.updated", { status: "idle" }))).toBe(session);
  });

  it("applies gateway status updates", () => {
    const active = { ...session, status: "active" as const };
    expect(projectSession(active, event("session.updated", { status: "idle" }))?.status).toBe(
      "idle",
    );
  });
});
