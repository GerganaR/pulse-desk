import { UnsequencedEventSchema, type UnsequencedEvent } from "@pulsedesk/contracts";
import { createRng } from "@pulsedesk/test-utils";
import { describe, expect, it } from "vitest";
import { Simulation } from "./simulation.ts";

const T0 = 1_760_000_000_000;

function run(options: {
  seed?: number;
  minutes: number;
  errorRate?: number;
  sessionCount?: number;
}) {
  const sim = new Simulation({
    rng: createRng(options.seed ?? 7),
    sessionCount: options.sessionCount ?? 12,
    eventRate: 4,
    errorRate: options.errorRate ?? 0,
  });
  const events: UnsequencedEvent[] = [...sim.start(T0)];
  const liveCounts: number[] = [];
  for (let t = T0; t < T0 + options.minutes * 60_000; t += 250) {
    events.push(...sim.tick(t));
    liveCounts.push(sim.liveCount);
  }
  return { sim, events, liveCounts };
}

describe("Simulation", () => {
  const { events, liveCounts } = run({ minutes: 20 });

  it("emits only protocol-valid events when errorRate is 0", () => {
    for (const event of events) {
      expect(UnsequencedEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    }
  });

  it("produces believable journeys: views, clicks, forms, submissions and departures", () => {
    const types = new Set(events.map((e) => e.type));
    for (const type of [
      "session.created",
      "session.page_view",
      "session.click",
      "session.form_open",
      "session.typing",
      "session.form_submit",
      "session.closed",
    ]) {
      expect(types, type).toContain(type);
    }
    const submits = events.filter((e) => e.type === "session.form_submit");
    expect(submits.some((e) => e.payload.success)).toBe(true);
    expect(submits.some((e) => !e.payload.success && e.payload.errorCode)).toBe(true);
  });

  it("hits roughly the requested event rate", () => {
    const perSecond = events.length / (20 * 60);
    expect(perSecond).toBeGreaterThan(2);
    expect(perSecond).toBeLessThan(8);
  });

  it("keeps the live population near the target as visitors leave", () => {
    const tail = liveCounts.slice(-400);
    expect(Math.min(...tail)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...tail)).toBeLessThanOrEqual(12);
  });

  it("never sends activity for a session before announcing it, or after closing it", () => {
    const created = new Set<string>();
    const closed = new Set<string>();
    for (const event of events) {
      if (event.type === "session.created") created.add(event.sessionId);
      else {
        expect(created.has(event.sessionId)).toBe(true);
        expect(closed.has(event.sessionId)).toBe(false);
      }
      if (event.type === "session.closed") closed.add(event.sessionId);
    }
  });

  it("uses unique event ids", () => {
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
  });

  it("is reproducible for a seed", () => {
    const a = run({ seed: 3, minutes: 2 }).events.map((e) => [e.type, e.sessionId]);
    const b = run({ seed: 3, minutes: 2 }).events.map((e) => [e.type, e.sessionId]);
    expect(a).toEqual(b);
  });

  it("injects malformed events at the configured error rate", () => {
    const { events: noisy } = run({ minutes: 5, errorRate: 0.2 });
    const invalid = noisy.filter((e) => !UnsequencedEventSchema.safeParse(e).success).length;
    expect(invalid / noisy.length).toBeGreaterThan(0.1);
    expect(invalid / noisy.length).toBeLessThan(0.3);
  });

  it("re-announces live sessions with their current state", () => {
    const { sim, events: all } = run({ minutes: 1, sessionCount: 3 });
    const lastView = all.findLast((e) => e.type === "session.page_view");
    const [announcement] = sim.reannounce([lastView!.sessionId], T0 + 60_000);
    expect(announcement).toMatchObject({ type: "session.created", sessionId: lastView!.sessionId });
    if (announcement?.type === "session.created" && lastView?.type === "session.page_view") {
      expect(announcement.payload.session.currentPath).toBe(lastView.payload.path);
    }
  });
});
