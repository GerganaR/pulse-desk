import {
  projectSession,
  type RealtimeEvent,
  type Session,
  type UnsequencedEvent,
} from "@pulsedesk/contracts";
import {
  BROWSERS,
  DEVICES,
  FIRST_NAMES,
  LOCATIONS,
  REFERRERS,
  SITE_PAGES,
  type Rng,
  type SitePath,
} from "@pulsedesk/test-utils";
import { pickJourney, type Step } from "./journeys.ts";

const SECOND = 1_000;

/** Journey steps expanded into the atomic actions that each produce one event (or none). */
type Action =
  | Exclude<Step, { kind: "form" }>
  | { kind: "form_open"; formId: string }
  | { kind: "typing"; formId: string; field: string; isTyping: boolean }
  | { kind: "submit"; formId: string; success: boolean; errorCode: string };

interface Visitor {
  session: Session;
  journey: string;
  actions: Action[];
  nextAt: number;
  eventCount: number;
}

export interface SimulationOptions {
  rng: Rng;
  /** Target number of concurrently live simulated sessions. */
  sessionCount: number;
  /** Approximate events per second across all sessions. */
  eventRate: number;
  /** Fraction of events replaced by malformed ones, to exercise gateway validation. */
  errorRate: number;
}

/**
 * Pure traffic model: given a clock, produce the events visitors would generate.
 * No I/O, no timers — the process wrapper (simulator.ts) owns those — so journeys and
 * timing are deterministic under a seed and unit-testable with a fake clock.
 */
export class Simulation {
  readonly #options: SimulationOptions;
  readonly #visitors = new Map<string, Visitor>();
  #nextSpawnAt = 0;
  #localSequence = 0;

  constructor(options: SimulationOptions) {
    this.#options = options;
  }

  get liveCount(): number {
    return this.#visitors.size;
  }

  /** Mean time between one visitor's actions, derived from the global event rate. */
  get #meanStepMs(): number {
    return (this.#options.sessionCount / Math.max(this.#options.eventRate, 0.01)) * SECOND;
  }

  /** Warm start: a full population of visitors already mid-visit, so dashboards aren't empty. */
  start(now: number): UnsequencedEvent[] {
    const events: UnsequencedEvent[] = [];
    for (let i = 0; i < this.#options.sessionCount; i++) {
      events.push(this.#spawn(now, this.#options.rng.int(30, 12 * 60) * SECOND));
    }
    this.#nextSpawnAt = now;
    return events;
  }

  tick(now: number): UnsequencedEvent[] {
    const { rng, sessionCount } = this.#options;
    const events: UnsequencedEvent[] = [];

    for (const visitor of [...this.#visitors.values()]) {
      while (visitor.nextAt <= now) {
        const action = visitor.actions.shift();
        if (!action) break;
        const event = this.#perform(visitor, action, now);
        if (event) events.push(event);
        visitor.nextAt = now + this.#delayAfter(action);
      }
      if (visitor.actions.length === 0) this.#visitors.delete(visitor.session.id);
    }

    // Replace departed visitors gradually rather than in bursts.
    if (this.#visitors.size < sessionCount && now >= this.#nextSpawnAt) {
      events.push(this.#spawn(now, 0));
      this.#nextSpawnAt = now + rng.int(1, 6) * SECOND;
    }

    return events.map((event) => this.#maybeCorrupt(event));
  }

  /**
   * The gateway doesn't know these sessions (e.g. it restarted and lost its in-memory
   * state). Re-announce them with their current state so their activity is accepted again.
   */
  reannounce(sessionIds: readonly string[], now: number): UnsequencedEvent[] {
    return sessionIds.flatMap((id) => {
      const visitor = this.#visitors.get(id);
      return visitor
        ? [this.#event(visitor, now, "session.created", { session: visitor.session })]
        : [];
    });
  }

  #spawn(now: number, alreadyActiveForMs: number): UnsequencedEvent {
    const { rng } = this.#options;
    const device = pickDevice(rng);
    const location = rng.pick(LOCATIONS);
    const journey = pickJourney(rng);
    const visitorNumber = rng.int(1000, 9999);
    const firstView = journey.steps.find(
      (s): s is Extract<Step, { kind: "view" }> => s.kind === "view",
    );
    const landingPath: SitePath = firstView?.path ?? "/";
    const id = `ses_${now.toString(36)}${rng.int(0, 36 ** 4).toString(36)}`;

    const session: Session = {
      id,
      visitor: {
        id: `vis_${visitorNumber}`,
        label: `Visitor #${visitorNumber}`,
        name: rng.chance(0.3) ? rng.pick(FIRST_NAMES) : null,
        country: location.country,
        city: location.city,
      },
      device: device.device,
      browser: device.device === "desktop" ? rng.pick(BROWSERS) : rng.pick(["Safari", "Chrome"]),
      os: rng.pick(device.os),
      referrer: rng.pick(REFERRERS),
      landingPath,
      currentPath: landingPath,
      status: "active",
      startedAt: now - alreadyActiveForMs,
      lastActivityAt: now,
      endedAt: null,
      pageViews: 0,
      eventCount: 0,
    };

    if (alreadyActiveForMs > 0) {
      // Warm start: the visit has history we didn't observe. Keep the counters coherent
      // (every page view is an event) rather than random.
      session.pageViews = rng.int(1, 5);
      session.eventCount = session.pageViews * rng.int(2, 4);
    }

    const visitor: Visitor = {
      session,
      journey: journey.name,
      actions: expand(journey.steps, rng),
      nextAt: now + rng.int(1, 4) * SECOND,
      eventCount: 0,
    };
    this.#visitors.set(id, visitor);
    return this.#event(visitor, now, "session.created", { session });
  }

  #perform(visitor: Visitor, action: Action, now: number): UnsequencedEvent | null {
    const path = visitor.session.currentPath;
    switch (action.kind) {
      case "view":
        return this.#event(visitor, now, "session.page_view", {
          path: action.path,
          title: SITE_PAGES[action.path],
        });
      case "click":
        return this.#event(visitor, now, "session.click", {
          element: action.element,
          label: action.label,
          path,
        });
      case "form_open":
        return this.#event(visitor, now, "session.form_open", { formId: action.formId, path });
      case "typing":
        return this.#event(visitor, now, "session.typing", {
          formId: action.formId,
          field: action.field,
          isTyping: action.isTyping,
        });
      case "submit":
        return this.#event(visitor, now, "session.form_submit", {
          formId: action.formId,
          success: action.success,
          errorCode: action.success ? null : action.errorCode,
        });
      case "leave":
        return this.#event(visitor, now, "session.closed", { reason: action.reason });
      case "pause":
      case "abandon":
        return null;
    }
  }

  #delayAfter(action: Action): number {
    const { rng } = this.#options;
    switch (action.kind) {
      case "typing":
        return action.isTyping ? rng.int(1_500, 5_000) : rng.int(300, 1_200);
      case "form_open":
        return rng.int(800, 2_500);
      case "pause":
        // Long enough for the gateway to mark the session idle (default 45s).
        return rng.int(55, 95) * SECOND;
      case "view":
      case "click":
      case "submit":
      case "leave":
      case "abandon":
        return Math.round(this.#meanStepMs * (0.4 + rng.next() * 1.4));
    }
  }

  /** Build an event and keep this visitor's local view of the session in sync. */
  #event<T extends UnsequencedEvent["type"]>(
    visitor: Visitor,
    timestamp: number,
    type: T,
    payload: Extract<UnsequencedEvent, { type: T }>["payload"],
  ): UnsequencedEvent {
    visitor.eventCount++;
    const event = {
      type,
      payload,
      eventId: `${visitor.session.id}_${visitor.eventCount}`,
      sessionId: visitor.session.id,
      timestamp,
    } as Extract<UnsequencedEvent, { type: T }>;
    // The same projection the gateway uses, so a re-announced session matches reality.
    const projected = projectSession(visitor.session, {
      ...event,
      sequence: ++this.#localSequence,
    } as RealtimeEvent);
    if (projected) visitor.session = projected;
    return event;
  }

  #maybeCorrupt(event: UnsequencedEvent): UnsequencedEvent {
    if (!this.#options.rng.chance(this.#options.errorRate) || event.type === "session.created")
      return event;
    // Deliberately invalid (paths must start with "/"): the gateway must reject it
    // individually while accepting the rest of the batch.
    return {
      ...event,
      eventId: `${event.eventId}_corrupt`,
      payload: { path: "not-a-path", title: "" },
    } as UnsequencedEvent;
  }
}

function expand(steps: Step[], rng: Rng): Action[] {
  return steps.flatMap((step): Action[] => {
    if (step.kind !== "form") return [step];
    const typing = step.fields.flatMap((field): Action[] => [
      { kind: "typing", formId: step.formId, field, isTyping: true },
      { kind: "typing", formId: step.formId, field, isTyping: false },
    ]);
    return [
      { kind: "form_open", formId: step.formId },
      ...typing,
      {
        kind: "submit",
        formId: step.formId,
        success: !rng.chance(step.failureRate),
        errorCode: step.errorCode,
      },
    ];
  });
}

function pickDevice(rng: Rng) {
  let roll = rng.next();
  for (const entry of DEVICES) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return rng.pick(DEVICES);
}
