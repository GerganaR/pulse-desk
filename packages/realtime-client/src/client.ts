import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  type Agent,
  type ClientMessage,
  type RealtimeEvent,
  type ServerMessage,
  type Session,
  type StreamCursor,
} from "@pulsedesk/contracts";
import { noopMetrics, type Logger, type Metrics } from "@pulsedesk/observability";
import { backoffDelay, defaultBackoff, type BackoffOptions } from "./backoff.ts";
import { EventSequencer } from "./sequencer.ts";
import { OPEN, browserTransport, type TransportFactory, type WebSocketLike } from "./transport.ts";

/**
 *   idle ──connect()──► connecting ──open──► syncing ──snapshot / sync.completed──► live
 *                           ▲                   │  ▲                                  │
 *                           │                   │  └──── gap not filled in time ──────┤
 *                           │                   │        (resync: hello, same socket) │
 *                           │                   └────────── socket lost ──────────────┤
 *                           └──── timer ◄──── reconnecting ◄──────────────────────────┘
 *   any ──close()──► closed (terminal until connect())
 *
 * "Socket lost" includes a heartbeat timeout: a socket that stops answering pings is
 * abandoned without waiting for a close handshake that may never come.
 * While the browser reports it is offline, reconnecting waits for the network instead of
 * burning backoff attempts.
 */
export type ConnectionStatus =
  "idle" | "connecting" | "syncing" | "live" | "reconnecting" | "closed";

export type NetworkStatus = "online" | "offline";

export interface RealtimeClientState {
  status: ConnectionStatus;
  /** Last position fully delivered to subscribers; sent as the resume point on reconnect. */
  cursor: StreamCursor | null;
  /** Consecutive failed attempts; reset once a connection has stayed healthy for a while. */
  reconnectAttempt: number;
  /** When the next reconnect attempt fires (epoch ms), while reconnecting. */
  nextRetryAt: number | null;
  /** When the current connection went live. */
  liveSince: number | null;
  /** When the connection was lost (or first failed); null while live. */
  disconnectedAt: number | null;
  /** What the browser reports (navigator.onLine and online/offline events). */
  network: NetworkStatus;
  /** Latest heartbeat round-trip time. */
  rttMs: number | null;
  /** Open but unhealthy: slow pongs, or a pong currently overdue. */
  degraded: boolean;
}

/** Counters for diagnostics (the dev reliability panel). Read on demand, never emitted. */
export interface RealtimeClientStats {
  reconnectCount: number;
  eventsReceived: number;
  eventsDelivered: number;
  staleDropped: number;
  duplicatesDropped: number;
  gapsDetected: number;
  resyncs: number;
  heartbeatTimeouts: number;
  /** Events held in the reorder buffer behind a gap. */
  pendingEvents: number;
  lastEventAt: number | null;
}

export type SyncReason = "initial" | "reconnect" | "resync";
export type SnapshotReason = "initial" | "new_stream" | "cursor_expired";

export type RealtimeClientEvent =
  | { type: "state"; state: RealtimeClientState }
  | {
      type: "snapshot";
      streamId: string;
      sequence: number;
      sessions: Session[];
      reason: SnapshotReason;
    }
  | { type: "events"; events: RealtimeEvent[] }
  | { type: "sync.started"; fromSequence: number; toSequence: number; reason: SyncReason }
  | { type: "sync.completed"; replayedCount: number; reason: SyncReason };

export type RealtimeClientListener = (event: RealtimeClientEvent) => void;

export interface HeartbeatOptions {
  /** How often to ping while connected. */
  intervalMs: number;
  /** No pong within this → the socket is considered dead and replaced. */
  timeoutMs: number;
  /** A pong slower than this (or one this overdue) marks the connection degraded. */
  degradedRttMs: number;
  /** While degraded, probe this often (instead of every interval) to notice recovery. */
  degradedProbeMs: number;
}

export const defaultHeartbeat: HeartbeatOptions = {
  intervalMs: 10_000,
  timeoutMs: 6_000,
  degradedRttMs: 1_000,
  degradedProbeMs: 2_000,
};

export interface RealtimeClientOptions {
  url: string;
  agent: Agent;
  /** Where to resume from, e.g. the sequence of the server-rendered snapshot. */
  resumeFrom: StreamCursor | null;
  transport?: TransportFactory;
  backoff?: Partial<BackoffOptions>;
  heartbeat?: Partial<HeartbeatOptions>;
  /** How long a gap may stay open (waiting for a late event) before asking for a resync. */
  gapTimeoutMs?: number;
  /** A connection must stay live this long before the backoff attempt counter resets. */
  stableAfterMs?: number;
  /** Resync immediately if this many events pile up behind a gap. */
  maxPendingEvents?: number;
  metrics?: Metrics;
  logger?: Logger;
  now?: () => number;
}

export interface RealtimeClient {
  connect(): void;
  /** Permanently close: cancels timers and never reconnects (until connect() is called). */
  close(): void;
  /** Skip the rest of the backoff wait (network came back, user clicked "Retry now"). */
  reconnectNow(): void;
  /** Send a heartbeat now instead of waiting for the next one (tab became visible). */
  checkConnection(): void;
  setNetworkStatus(online: boolean): void;
  watchSession(sessionId: string): void;
  unwatchSession(sessionId: string): void;
  subscribe(listener: RealtimeClientListener): () => void;
  getState(): RealtimeClientState;
  getStats(): RealtimeClientStats;
}

type Pong = Extract<ServerMessage, { type: "pong" }>;

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const transport = options.transport ?? browserTransport;
  const backoff = { ...defaultBackoff, ...options.backoff };
  const heartbeat = { ...defaultHeartbeat, ...options.heartbeat };
  const gapTimeoutMs = options.gapTimeoutMs ?? 2_000;
  const stableAfterMs = options.stableAfterMs ?? 10_000;
  const maxPendingEvents = options.maxPendingEvents ?? 1_000;
  const metrics = options.metrics ?? noopMetrics;
  const logger = options.logger;
  const now = options.now ?? Date.now;

  const listeners = new Set<RealtimeClientListener>();
  const watched = new Set<string>();
  const sequencer = new EventSequencer(options.resumeFrom?.sequence ?? null);
  /** Epoch the cursor belongs to. */
  let cursorStream: string | null = options.resumeFrom?.streamId ?? null;

  let socket: WebSocketLike | null = null;
  /** Whether the current socket has completed a handshake (a later hello is a resync). */
  let socketWasLive = false;
  let hasBeenLive = false;
  let syncReason: SyncReason | null = null;

  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongLateTimer: ReturnType<typeof setTimeout> | undefined;
  let pongTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPing: { nonce: number; sentAt: number } | null = null;
  let pingNonce = 0;
  /** reconnectNow() arrived while an attempt was in flight: if it fails, skip the backoff. */
  let retryImmediately = false;

  const counters = { reconnectCount: 0, eventsReceived: 0, eventsDelivered: 0, resyncs: 0 };
  let heartbeatTimeouts = 0;
  let lastEventAt: number | null = null;

  let state: RealtimeClientState = {
    status: "idle",
    cursor: options.resumeFrom,
    reconnectAttempt: 0,
    nextRetryAt: null,
    liveSince: null,
    disconnectedAt: null,
    network: "online",
    rttMs: null,
    degraded: false,
  };

  const emit = (event: RealtimeClientEvent) => listeners.forEach((listener) => listener(event));
  const setState = (patch: Partial<RealtimeClientState>) => {
    state = { ...state, ...patch };
    emit({ type: "state", state });
  };
  const cursor = (): StreamCursor | null => {
    const applied = sequencer.applied;
    return applied !== null && cursorStream !== null
      ? { streamId: cursorStream, sequence: applied }
      : null;
  };
  const isOpen = () => socket?.readyState === OPEN;
  const send = (message: ClientMessage) => {
    if (socket && isOpen()) socket.send(JSON.stringify(message));
  };

  // ─── connection lifecycle ─────────────────────────────────────────────────────

  function open() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    const current = transport(options.url);
    socket = current;
    socketWasLive = false;
    metrics.increment("websocket.connect.attempts");
    setState({ status: "connecting", nextRetryAt: null });

    // Every handler checks it still belongs to the current socket: after a reconnect, a
    // dying socket's late frames or close event must not touch the new connection.
    const isCurrent = () => socket === current;

    current.addEventListener("open", () => {
      if (!isCurrent()) return;
      sendHello(hasBeenLive ? "reconnect" : "initial");
      // Presence is per connection on the server: re-establish it after every (re)connect.
      for (const sessionId of watched) send({ type: "session.watch", sessionId });
    });

    current.addEventListener("message", ({ data }) => {
      if (!isCurrent()) return;
      onMessage(typeof data === "string" ? data : String(data));
    });

    current.addEventListener("close", ({ code }) => {
      if (!isCurrent()) return;
      lost(code);
    });

    // "error" is always followed by "close"; reconnect logic lives there.
    current.addEventListener("error", () => {});
  }

  function sendHello(reason: SyncReason) {
    syncReason = reason;
    setState({ status: "syncing" });
    send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      agent: options.agent,
      resumeFrom: cursor(),
    });
  }

  /** The current socket is gone (closed by the peer or abandoned by us). */
  function lost(code: number) {
    socket = null;
    stopHeartbeat();
    clearTimeout(gapTimer);
    gapTimer = undefined;
    clearTimeout(stableTimer);
    stableTimer = undefined;
    if (state.liveSince !== null)
      metrics.histogram("websocket.connection.duration", now() - state.liveSince);
    if (state.status === "closed") return;
    scheduleReconnect(code);
  }

  /** Give up on a socket that stopped responding. Its eventual close event is ignored. */
  function abandon(reason: string) {
    const current = socket;
    lost(4000);
    try {
      current?.close(4000, reason);
    } catch {
      // Already closing; nothing to do.
    }
  }

  function scheduleReconnect(code: number) {
    const attempt = state.reconnectAttempt + 1;
    counters.reconnectCount++;
    metrics.increment("websocket.reconnect.count");
    const common = {
      status: "reconnecting" as const,
      reconnectAttempt: attempt,
      liveSince: null,
      disconnectedAt: state.disconnectedAt ?? now(),
      rttMs: null,
      degraded: false,
    };
    if (state.network === "offline") {
      // No point retrying into a dead network; `online` resumes immediately.
      logger?.warn("realtime.disconnected", { code, attempt, waitingForNetwork: true });
      setState({ ...common, nextRetryAt: null });
      return;
    }
    const delay = retryImmediately ? 0 : backoffDelay(attempt, backoff);
    retryImmediately = false;
    logger?.warn("realtime.disconnected", { code, attempt, retryInMs: delay });
    setState({ ...common, nextRetryAt: now() + delay });
    retryTimer = setTimeout(open, delay);
  }

  function goLive() {
    syncReason = null;
    retryImmediately = false;
    if (socketWasLive) {
      // A resync on an already-live socket: nothing about the connection changed.
      setState({ status: "live" });
    } else {
      socketWasLive = true;
      hasBeenLive = true;
      setState({ status: "live", liveSince: now(), disconnectedAt: null });
      // Only a connection that *stays* up earns a backoff reset; otherwise a gateway that
      // accepts and immediately drops would be retried at the minimum delay forever.
      clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        stableTimer = undefined;
        if (state.reconnectAttempt !== 0) setState({ reconnectAttempt: 0 });
      }, stableAfterMs);
      startHeartbeat();
    }
    reviewGap();
  }

  // ─── heartbeat ────────────────────────────────────────────────────────────────

  function startHeartbeat() {
    stopHeartbeat();
    pingTimer = setInterval(sendPing, heartbeat.intervalMs);
    sendPing(); // measure RTT right away rather than one interval later
  }

  function stopHeartbeat() {
    clearInterval(pingTimer);
    clearTimeout(pongLateTimer);
    clearTimeout(pongTimeoutTimer);
    clearTimeout(probeTimer);
    pingTimer = pongLateTimer = pongTimeoutTimer = probeTimer = undefined;
    pendingPing = null;
  }

  function sendPing() {
    // One ping in flight at a time: an overdue one is already being timed.
    if (!isOpen() || pendingPing) return;
    const sentAt = now();
    pendingPing = { nonce: ++pingNonce, sentAt };
    send({ type: "ping", nonce: pendingPing.nonce, sentAt });
    pongLateTimer = setTimeout(() => {
      if (!state.degraded) setState({ degraded: true });
    }, heartbeat.degradedRttMs);
    pongTimeoutTimer = setTimeout(() => {
      heartbeatTimeouts++;
      metrics.increment("websocket.heartbeat.timeouts");
      logger?.warn("realtime.heartbeat_timeout", { timeoutMs: heartbeat.timeoutMs });
      abandon("Heartbeat timeout");
    }, heartbeat.timeoutMs);
  }

  function onPong(pong: Pong) {
    if (!pendingPing || pong.nonce !== pendingPing.nonce) return;
    const rtt = now() - pendingPing.sentAt;
    pendingPing = null;
    clearTimeout(pongLateTimer);
    clearTimeout(pongTimeoutTimer);
    metrics.histogram("websocket.heartbeat.rtt", rtt);
    const degraded = rtt > heartbeat.degradedRttMs;
    if (degraded !== state.degraded || rtt !== state.rttMs) setState({ rttMs: rtt, degraded });
    clearTimeout(probeTimer);
    if (degraded) probeTimer = setTimeout(sendPing, heartbeat.degradedProbeMs);
    sequencer.observeHead(pong.headSequence);
    reviewGap();
  }

  // ─── ordering, gaps and resync ────────────────────────────────────────────────

  /**
   * Called whenever the sequencer's picture changes. A gap first gets a short grace
   * period (the missing event is usually just late, e.g. reordered), then a resync.
   */
  function reviewGap() {
    if (sequencer.pendingCount > maxPendingEvents) return resync();
    if (!sequencer.hasGap) {
      clearTimeout(gapTimer);
      gapTimer = undefined;
      return;
    }
    gapTimer ??= setTimeout(() => {
      gapTimer = undefined;
      if (sequencer.hasGap) resync();
    }, gapTimeoutMs);
  }

  function resync() {
    clearTimeout(gapTimer);
    gapTimer = undefined;
    // A sync already in flight will call reviewGap() again when it completes.
    if (!isOpen() || state.status !== "live") return;
    counters.resyncs++;
    metrics.increment("websocket.resync.count");
    logger?.info("realtime.resync", {
      from: sequencer.applied,
      pending: sequencer.pendingCount,
    });
    sendHello("resync");
  }

  function deliver(events: RealtimeEvent[]) {
    counters.eventsReceived += events.length;
    lastEventAt = now();
    metrics.increment("websocket.events.received", events.length);

    const before = { ...sequencer.stats };
    const ready = sequencer.accept(events);
    const after = sequencer.stats;
    const dropped =
      after.staleDropped + after.duplicatesDropped - before.staleDropped - before.duplicatesDropped;
    if (dropped > 0) metrics.increment("websocket.events.dropped", dropped);
    if (after.gapsDetected > before.gapsDetected) metrics.increment("websocket.gaps.detected");
    release(ready);
  }

  function release(ready: RealtimeEvent[]) {
    // Silent update: the cursor changes with every event and nobody renders it.
    state = { ...state, cursor: cursor() };
    if (ready.length > 0) {
      counters.eventsDelivered += ready.length;
      emit({ type: "events", events: ready });
    }
    reviewGap();
  }

  function onMessage(raw: string) {
    const decoded = decodeServerMessage(raw);
    if (!decoded.ok) {
      // Never let one bad frame take the connection (or the UI) down.
      metrics.increment("websocket.frames.invalid");
      logger?.warn("realtime.invalid_frame", { kind: decoded.error.kind });
      return;
    }
    const message = decoded.value;
    switch (message.type) {
      case "welcome":
        // Nothing to do: the replay or snapshot that follows carries the head position.
        // (Observing welcome.headSequence here would count every normal replay as a gap.)
        return;
      case "pong":
        return onPong(message);
      case "snapshot": {
        const reason: SnapshotReason =
          cursorStream === null || sequencer.applied === null
            ? "initial"
            : cursorStream !== message.streamId
              ? "new_stream"
              : "cursor_expired";
        sequencer.reset(message.sequence, { newStream: cursorStream !== message.streamId });
        cursorStream = message.streamId;
        emit({
          type: "snapshot",
          streamId: message.streamId,
          sequence: message.sequence,
          sessions: message.sessions,
          reason,
        });
        // Events buffered past the snapshot position may now be contiguous.
        release(sequencer.accept([]));
        return goLive();
      }
      case "sync.started":
        return emit({
          type: "sync.started",
          fromSequence: message.fromSequence,
          toSequence: message.toSequence,
          reason: syncReason ?? "reconnect",
        });
      case "sync.completed":
        sequencer.observeHead(message.headSequence);
        emit({
          type: "sync.completed",
          replayedCount: message.replayedCount,
          reason: syncReason ?? "reconnect",
        });
        return goLive();
      case "events":
        return deliver(message.events);
      case "error":
        logger?.warn("realtime.server_error", { code: message.code, message: message.message });
        return;
    }
  }

  function reconnectNow() {
    if (state.status === "reconnecting") open();
    // An attempt is already in flight (it may have started before the network came
    // back). Don't open a second socket; just don't make a failure wait out the backoff.
    else if (state.status === "connecting") retryImmediately = true;
  }

  return {
    connect() {
      if (state.status === "idle" || state.status === "closed") open();
    },
    close() {
      clearTimeout(retryTimer);
      clearTimeout(stableTimer);
      clearTimeout(gapTimer);
      retryTimer = stableTimer = gapTimer = undefined;
      stopHeartbeat();
      setState({ status: "closed", nextRetryAt: null });
      const current = socket;
      socket = null;
      current?.close(1000, "Client closed");
    },
    reconnectNow,
    checkConnection() {
      if (state.status === "live") sendPing();
    },
    setNetworkStatus(online) {
      const network: NetworkStatus = online ? "online" : "offline";
      if (network === state.network) return;
      setState({ network });
      if (online) {
        reconnectNow();
      } else {
        // The OS says the network is gone, but an open socket may not notice for
        // minutes. Probe it: a missing pong then moves us to reconnecting.
        sendPing();
      }
    },
    watchSession(sessionId) {
      watched.add(sessionId);
      send({ type: "session.watch", sessionId });
    },
    unwatchSession(sessionId) {
      if (!watched.delete(sessionId)) return;
      send({ type: "session.unwatch", sessionId });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    getStats: () => ({
      ...counters,
      staleDropped: sequencer.stats.staleDropped,
      duplicatesDropped: sequencer.stats.duplicatesDropped,
      gapsDetected: sequencer.stats.gapsDetected,
      heartbeatTimeouts,
      pendingEvents: sequencer.pendingCount,
      lastEventAt,
    }),
  };
}
