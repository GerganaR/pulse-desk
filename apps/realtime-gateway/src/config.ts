const env = process.env;
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== "" ? parsed : fallback;
};

export interface GatewayConfig {
  host: string;
  port: number;
  /** Events retained for replay. Clients further behind than this get a fresh snapshot. */
  replayBufferSize: number;
  /** Events kept per session for the detail timeline. */
  timelineLimit: number;
  heartbeatIntervalMs: number;
  /** No visitor activity for this long → session marked idle. */
  idleAfterMs: number;
  /** No visitor activity for this long → session closed (inactivity_timeout). */
  closeAfterMs: number;
  /** Ended sessions stay in snapshots this long, then age out. */
  closedRetentionMs: number;
  maxClosedSessions: number;
  sweepIntervalMs: number;
  maxConnections: number;
  /** Per-socket send backlog above which a client is disconnected as a slow consumer. */
  maxBufferedBytes: number;
  /** A reconnect within this window keeps an agent's presence without a left/joined pair. */
  presenceGraceMs: number;
  /** Largest accepted WebSocket frame from clients (they only send small control messages). */
  maxClientFrameBytes: number;
  maxIngestBodyBytes: number;
}

export function loadConfig(): GatewayConfig {
  return {
    host: env.GATEWAY_HOST ?? "0.0.0.0",
    // Not `PORT`: turbo passes PORT through for the web app, and sharing it would collide.
    port: number(env.GATEWAY_PORT, 4000),
    replayBufferSize: number(env.REPLAY_BUFFER_SIZE, 10_000),
    timelineLimit: number(env.TIMELINE_LIMIT, 300),
    heartbeatIntervalMs: number(env.HEARTBEAT_INTERVAL_MS, 15_000),
    idleAfterMs: number(env.IDLE_AFTER_MS, 45_000),
    closeAfterMs: number(env.CLOSE_AFTER_MS, 3 * 60_000),
    closedRetentionMs: number(env.CLOSED_RETENTION_MS, 6 * 60 * 60_000),
    maxClosedSessions: number(env.MAX_CLOSED_SESSIONS, 300),
    sweepIntervalMs: number(env.SWEEP_INTERVAL_MS, 5_000),
    maxConnections: number(env.MAX_CONNECTIONS, 1_000),
    // Well above a full replay burst (500-event chunks), far below a memory problem.
    maxBufferedBytes: number(env.MAX_BUFFERED_BYTES, 8 * 1024 * 1024),
    presenceGraceMs: number(env.PRESENCE_GRACE_MS, 5_000),
    maxClientFrameBytes: 16 * 1024,
    maxIngestBodyBytes: 1024 * 1024,
  };
}
