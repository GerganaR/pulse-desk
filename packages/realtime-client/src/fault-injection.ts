import type { RealtimeEvent } from "@pulsedesk/contracts";
import {
  browserTransport,
  type TransportFactory,
  type WebSocketEventMapLike,
  type WebSocketLike,
} from "./transport.ts";

/**
 * Development-only fault injection. Wraps a transport and misbehaves on purpose, so the
 * client's recovery paths can be exercised against the real gateway:
 *
 *   disconnect      cut every socket (abnormal close 1006) and fail new ones until restore()
 *   latency         delay every inbound frame (pongs included, so RTT and "Degraded" react)
 *   drop N          remove the next N events from inbound frames → a gap → resync
 *   duplicate       deliver the next event twice → dedupe
 *   reorder         deliver the next batch late (after the one behind it) → reorder buffer
 *
 * The client can't tell this apart from a real network: it only sees a WebSocketLike.
 * Never imported by production code paths; see the devtools build flag in apps/web.
 */

/** Appears in this module's runtime strings; the production bundle check looks for it. */
const MARKER = "pulsedesk-devtools";
const CLOSED = 3;
/** A held batch is released by the next one, or after this long if the stream is quiet. */
const HOLD_MAX_MS = 1_000;

export interface FaultInjectorState {
  /** Network "cut": live sockets were dropped and new ones fail until restore(). */
  disconnected: boolean;
  latencyMs: number;
  /** Events still to be dropped. */
  dropRemaining: number;
  duplicateArmed: boolean;
  reorderArmed: boolean;
}

export interface FaultLogEntry {
  id: number;
  at: number;
  message: string;
}

export interface FaultInjector {
  transport: TransportFactory;
  disconnect(): void;
  restore(): void;
  setLatency(ms: number): void;
  dropEvents(count: number): void;
  duplicateNextEvent(): void;
  reorderNextBatch(): void;
  getState(): FaultInjectorState;
  /** Most recent first, bounded. */
  getLog(): readonly FaultLogEntry[];
  subscribe(listener: () => void): () => void;
}

type AnyListener = (event: never) => void;

const range = (events: readonly RealtimeEvent[]) => {
  const first = events[0]?.sequence;
  const last = events.at(-1)?.sequence;
  return first === last ? `#${first}` : `#${first}–${last}`;
};

export function createFaultInjector(
  inner: TransportFactory = browserTransport,
  { now = Date.now }: { now?: () => number } = {},
): FaultInjector {
  let state: FaultInjectorState = {
    disconnected: false,
    latencyMs: 0,
    dropRemaining: 0,
    duplicateArmed: false,
    reorderArmed: false,
  };
  let log: FaultLogEntry[] = [];
  let logId = 0;
  const listeners = new Set<() => void>();
  const sockets = new Set<FaultySocket>();

  const update = (patch: Partial<FaultInjectorState>, message?: string) => {
    state = { ...state, ...patch };
    if (message) log = [{ id: ++logId, at: now(), message }, ...log].slice(0, 30);
    listeners.forEach((listener) => listener());
  };

  class FaultySocket implements WebSocketLike {
    readonly #listeners = new Map<keyof WebSocketEventMapLike, AnyListener[]>();
    readonly #real: WebSocketLike | null;
    #detached = false;
    /** Delivery time of the last scheduled frame: latency must never reorder frames. */
    #lastDeliveryAt = 0;
    #held: { frame: string; timer: ReturnType<typeof setTimeout> } | null = null;

    constructor(url: string) {
      if (state.disconnected) {
        // Like a connection attempt into a dead network: it fails shortly after.
        this.#real = null;
        this.#detached = true;
        setTimeout(() => {
          this.#fire("error", {});
          this.#fire("close", { code: 1006, reason: `${MARKER}: offline`, wasClean: false });
        }, 50);
        return;
      }
      const real = inner(url);
      this.#real = real;
      sockets.add(this);
      real.addEventListener("open", (event) => this.#forward("open", event));
      real.addEventListener("error", (event) => this.#forward("error", event));
      real.addEventListener("close", (event) => {
        sockets.delete(this);
        this.#forward("close", event);
      });
      real.addEventListener("message", ({ data }) => {
        if (!this.#detached) this.#inbound(String(data));
      });
    }

    get readyState() {
      return this.#detached ? CLOSED : (this.#real?.readyState ?? CLOSED);
    }

    send(data: string) {
      if (!this.#detached) this.#real?.send(data);
    }

    close(code?: number, reason?: string) {
      this.#real?.close(code, reason);
    }

    addEventListener<K extends keyof WebSocketEventMapLike>(
      type: K,
      listener: (event: WebSocketEventMapLike[K]) => void,
    ) {
      this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener as AnyListener]);
    }

    /** Simulate the network vanishing: the client sees an abnormal close right away. */
    cut() {
      if (this.#detached) return;
      this.#detached = true;
      sockets.delete(this);
      if (this.#held) clearTimeout(this.#held.timer);
      this.#real?.close(4001, "Fault injection");
      this.#fire("close", { code: 1006, reason: `${MARKER}: network cut`, wasClean: false });
    }

    #forward<K extends keyof WebSocketEventMapLike>(type: K, event: WebSocketEventMapLike[K]) {
      if (!this.#detached) this.#fire(type, event);
    }

    #fire(type: keyof WebSocketEventMapLike, event: unknown) {
      for (const listener of this.#listeners.get(type) ?? [])
        (listener as (e: unknown) => void)(event);
    }

    #inbound(frame: string) {
      let message: { type?: unknown; events?: RealtimeEvent[] };
      try {
        message = JSON.parse(frame) as typeof message;
      } catch {
        return this.#schedule(frame);
      }
      if (message.type !== "events" || !Array.isArray(message.events)) return this.#schedule(frame);
      this.#inboundEvents(message.events);
    }

    #inboundEvents(incoming: RealtimeEvent[]) {
      let events = incoming;
      const frameOf = (list: RealtimeEvent[]) => JSON.stringify({ type: "events", events: list });

      if (state.dropRemaining > 0 && events.length > 0) {
        const dropped = events.slice(0, state.dropRemaining);
        events = events.slice(dropped.length);
        update(
          { dropRemaining: state.dropRemaining - dropped.length },
          `Dropped ${dropped.length} event${dropped.length === 1 ? "" : "s"} ${range(dropped)}`,
        );
        if (events.length === 0) return;
      }

      if (state.reorderArmed) {
        if (events.length > 1) {
          update({ reorderArmed: false }, `Delivered batch ${range(events)} in reverse order`);
          events = [...events].reverse();
        } else {
          // A single-event batch can only be out of order relative to the next batch.
          const frame = frameOf(events);
          const timer = setTimeout(() => this.#releaseHeld(), HOLD_MAX_MS);
          this.#held = { frame, timer };
          update({ reorderArmed: false }, `Holding ${range(events)} until after the next batch`);
          return;
        }
      }

      this.#schedule(frameOf(events));

      if (state.duplicateArmed) {
        const [first] = events;
        if (first) {
          update({ duplicateArmed: false }, `Delivered ${range([first])} twice`);
          this.#schedule(frameOf([first]));
        }
      }
      this.#releaseHeld();
    }

    #releaseHeld() {
      if (!this.#held) return;
      clearTimeout(this.#held.timer);
      const { frame } = this.#held;
      this.#held = null;
      this.#schedule(frame);
    }

    #schedule(frame: string) {
      const deliver = () => {
        if (!this.#detached) this.#fire("message", { data: frame });
      };
      if (state.latencyMs <= 0 && this.#lastDeliveryAt <= now()) return deliver();
      const at = Math.max(now() + state.latencyMs, this.#lastDeliveryAt);
      this.#lastDeliveryAt = at;
      setTimeout(deliver, at - now());
    }
  }

  return {
    transport: (url) => new FaultySocket(url),
    disconnect() {
      if (state.disconnected) return;
      update({ disconnected: true }, "Network cut: sockets dropped, reconnects will fail");
      for (const socket of [...sockets]) socket.cut();
    },
    restore() {
      if (!state.disconnected) return;
      update({ disconnected: false }, "Network restored");
    },
    setLatency(ms) {
      update({ latencyMs: Math.max(0, ms) }, ms > 0 ? `Latency set to ${ms} ms` : "Latency off");
    },
    dropEvents(count) {
      if (count > 0)
        update({ dropRemaining: state.dropRemaining + count }, `Armed: drop next ${count}`);
    },
    duplicateNextEvent() {
      update({ duplicateArmed: true }, "Armed: duplicate next event");
    },
    reorderNextBatch() {
      update({ reorderArmed: true }, "Armed: deliver next batch out of order");
    },
    getState: () => state,
    getLog: () => log,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
