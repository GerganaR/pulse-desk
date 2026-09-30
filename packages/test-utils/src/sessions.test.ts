import { SessionSchema } from "@pulsedesk/contracts";
import { describe, expect, it } from "vitest";
import { generateSessions } from "./sessions.ts";

const now = 1_760_000_000_000;

describe("generateSessions", () => {
  it("produces schema-valid sessions", () => {
    for (const session of generateSessions({ now })) {
      expect(SessionSchema.safeParse(session).success, session.id).toBe(true);
    }
  });

  it("is deterministic for a seed", () => {
    expect(generateSessions({ now, seed: 7 })).toEqual(generateSessions({ now, seed: 7 }));
    expect(generateSessions({ now, seed: 7 })).not.toEqual(generateSessions({ now, seed: 8 }));
  });

  it("keeps ids stable as time moves, so a re-fetched snapshot reconciles by id", () => {
    const ids = (at: number) => generateSessions({ now: at }).map((s) => s.id);
    expect(ids(now)).toEqual(ids(now + 60_000));
  });

  it("never places activity in the future and keeps ended sessions consistent", () => {
    for (const s of generateSessions({ now, count: 200 })) {
      expect(s.lastActivityAt).toBeLessThanOrEqual(now);
      expect(s.startedAt).toBeLessThanOrEqual(s.lastActivityAt);
      expect(s.endedAt === null).toBe(s.status !== "closed");
    }
  });

  it("includes a live cohort and a history of ended sessions", () => {
    const statuses = new Set(generateSessions({ now }).map((s) => s.status));
    expect(statuses).toEqual(new Set(["active", "idle", "closed"]));
  });
});
