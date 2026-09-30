import type { Session, SessionStatus } from "@pulsedesk/contracts";
import { createRng, type Rng } from "./random.ts";
import {
  BROWSERS,
  DEVICES,
  FIRST_NAMES,
  LANDING_PATHS,
  LOCATIONS,
  REFERRERS,
  SITE_PATHS,
} from "./vocabulary.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Minimal valid session for unit tests; override only what the test cares about. */
export function makeSession(overrides: Partial<Session> = {}): Session {
  const startedAt = overrides.startedAt ?? 1_760_000_000_000;
  return {
    id: "ses_test",
    visitor: { id: "vis_test", label: "Visitor #1000", name: null, country: "BG", city: "Sofia" },
    device: "desktop",
    browser: "Chrome",
    os: "macOS",
    referrer: null,
    landingPath: "/",
    currentPath: "/",
    status: "active",
    startedAt,
    lastActivityAt: startedAt,
    endedAt: null,
    pageViews: 1,
    eventCount: 1,
    ...overrides,
  };
}

function pickDevice(rng: Rng) {
  let roll = rng.next();
  for (const entry of DEVICES) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return rng.pick(DEVICES); // only reachable through float rounding of the weights
}

export interface GenerateSessionsOptions {
  seed?: number;
  /** Reference "now"; all timestamps are placed relative to it. */
  now: number;
  count?: number;
}

/**
 * Believable population of sessions spread over the last ~6 hours: a live cohort
 * (active/idle, recent activity) plus a tail of ended sessions. IDs are stable for a
 * given seed; timestamps move with `now`.
 */
export function generateSessions({
  seed = 42,
  now,
  count = 64,
}: GenerateSessionsOptions): Session[] {
  const rng = createRng(seed);
  const sessions: Session[] = [];

  for (let i = 0; i < count; i++) {
    const visitorNumber = 1000 + ((i * 7919 + seed) % 9000);
    const location = rng.pick(LOCATIONS);
    const deviceEntry = pickDevice(rng);
    const landingPath = rng.pick(LANDING_PATHS);

    // First ~40% are live (started within the last hour), the rest ended earlier.
    const live = i < count * 0.4;
    const startedAt = live
      ? now - rng.int(20 * SECOND, 58 * MINUTE)
      : now - rng.int(65 * MINUTE, 6 * 60 * MINUTE);
    const durationMs = live ? now - startedAt : rng.int(40 * SECOND, 25 * MINUTE);
    const status: SessionStatus = !live ? "closed" : rng.chance(0.25) ? "idle" : "active";
    const lastActivityAt =
      status === "active"
        ? now - rng.int(0, 45 * SECOND)
        : status === "idle"
          ? now - rng.int(2 * MINUTE, 9 * MINUTE)
          : startedAt + durationMs;
    const pageViews = Math.max(1, Math.round(durationMs / MINUTE / 1.5) + rng.int(0, 3));

    sessions.push({
      id: `ses_${(seed * 100_003 + i * 7_561).toString(36)}`,
      visitor: {
        id: `vis_${visitorNumber}`,
        label: `Visitor #${visitorNumber}`,
        name: rng.chance(0.3) ? rng.pick(FIRST_NAMES) : null,
        country: location.country,
        city: location.city,
      },
      device: deviceEntry.device,
      browser:
        deviceEntry.device === "desktop" ? rng.pick(BROWSERS) : rng.pick(["Safari", "Chrome"]),
      os: rng.pick(deviceEntry.os),
      referrer: rng.pick(REFERRERS),
      landingPath,
      currentPath: status === "closed" ? landingPath : rng.pick(SITE_PATHS),
      status,
      startedAt,
      lastActivityAt: Math.min(Math.max(lastActivityAt, startedAt), now),
      endedAt: status === "closed" ? startedAt + durationMs : null,
      pageViews,
      eventCount: pageViews * rng.int(2, 5),
    });
  }

  return sessions;
}
