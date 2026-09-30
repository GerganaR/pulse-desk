import {
  projectSession,
  type RealtimeEvent,
  type Session,
  type UnsequencedEvent,
} from "@pulsedesk/contracts";
import { randomUUID } from "node:crypto";

interface Timeline {
  events: RealtimeEvent[];
  /** True once older events have been dropped to respect the limit. */
  truncated: boolean;
}

export interface SessionStoreOptions {
  timelineLimit: number;
  idleAfterMs: number;
  closeAfterMs: number;
  closedRetentionMs: number;
  maxClosedSessions: number;
}

/**
 * Current state of every known session, derived from the event stream with the shared
 * `projectSession`. Serves snapshots (GET /sessions, WS snapshot) and per-session
 * timelines. Everything here is a projection: it can always be rebuilt from the log.
 */
export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #timelines = new Map<string, Timeline>();
  readonly #options: SessionStoreOptions;

  constructor(options: SessionStoreOptions) {
    this.#options = options;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.#sessions.get(sessionId);
  }

  list(): Session[] {
    return [...this.#sessions.values()];
  }

  get size(): number {
    return this.#sessions.size;
  }

  apply(event: RealtimeEvent): void {
    const next = projectSession(this.#sessions.get(event.sessionId), event);
    if (!next) return;
    this.#sessions.set(event.sessionId, next);

    let timeline = this.#timelines.get(event.sessionId);
    if (!timeline || event.type === "session.created") {
      timeline = { events: [], truncated: false };
      this.#timelines.set(event.sessionId, timeline);
    }
    timeline.events.push(event);
    if (timeline.events.length > this.#options.timelineLimit) {
      // Drop from the front in chunks so this isn't an O(n) shift on every event.
      timeline.events.splice(0, Math.ceil(this.#options.timelineLimit / 10));
      timeline.truncated = true;
    }
  }

  detail(
    sessionId: string,
  ): { session: Session; events: RealtimeEvent[]; truncated: boolean } | undefined {
    const session = this.#sessions.get(sessionId);
    if (!session) return undefined;
    const timeline = this.#timelines.get(sessionId);
    return {
      session,
      events: [...(timeline?.events ?? [])],
      truncated: timeline?.truncated ?? false,
    };
  }

  /**
   * Derive status changes from inactivity (visitors don't announce that they left) and
   * age out ended sessions. Returns the events to publish; the store is updated when
   * they come back through `apply`, like every other event.
   */
  sweep(now: number): UnsequencedEvent[] {
    const { idleAfterMs, closeAfterMs, closedRetentionMs, maxClosedSessions } = this.#options;
    const transitions: UnsequencedEvent[] = [];
    const closed: Session[] = [];

    for (const session of this.#sessions.values()) {
      const quietFor = now - session.lastActivityAt;
      if (session.status === "closed") {
        closed.push(session);
      } else if (quietFor >= closeAfterMs) {
        transitions.push({
          type: "session.closed",
          eventId: systemEventId(),
          sessionId: session.id,
          timestamp: now,
          payload: { reason: "inactivity_timeout" },
        });
      } else if (session.status === "active" && quietFor >= idleAfterMs) {
        transitions.push({
          type: "session.updated",
          eventId: systemEventId(),
          sessionId: session.id,
          timestamp: now,
          payload: { status: "idle" },
        });
      }
    }

    // Retention: drop ended sessions past their retention window, and cap the total.
    closed.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    closed.forEach((session, index) => {
      if (index >= maxClosedSessions || now - (session.endedAt ?? now) > closedRetentionMs) {
        this.#sessions.delete(session.id);
        this.#timelines.delete(session.id);
      }
    });

    return transitions;
  }
}

const systemEventId = () => `sys_${randomUUID()}`;
