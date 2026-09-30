import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Mirrors the realtime client's state for the UI; the client stays the source of truth. */
export type RealtimeStatus = "idle" | "connecting" | "syncing" | "live" | "reconnecting" | "closed";

/** Why a replay happened: first connect, after a lost connection, or to fill a gap. */
export type SyncReason = "initial" | "reconnect" | "resync";

export interface SyncRange {
  fromSequence: number;
  toSequence: number;
  reason: SyncReason;
}

/** The fields mirrored from the client on every state change. */
export interface ConnectionSnapshot {
  status: RealtimeStatus;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  liveSince: number | null;
  /** When the connection was lost; null while live. Drives the prolonged-outage banner. */
  disconnectedAt: number | null;
  network: "online" | "offline";
  rttMs: number | null;
  degraded: boolean;
}

export interface ConnectionState extends ConnectionSnapshot {
  /** Replay in progress. */
  sync: SyncRange | null;
  /**
   * The most recent completed replay. The timeline highlights events in this range, so
   * what was missed while disconnected is visible without a toast per reconnect.
   */
  lastReplay: (SyncRange & { count: number }) | null;
}

export const initialConnectionState: ConnectionState = {
  status: "idle",
  reconnectAttempt: 0,
  nextRetryAt: null,
  liveSince: null,
  disconnectedAt: null,
  network: "online",
  rttMs: null,
  degraded: false,
  sync: null,
  lastReplay: null,
};

export const connectionSlice = createSlice({
  name: "connection",
  initialState: initialConnectionState,
  reducers: {
    connectionStateChanged(state, action: PayloadAction<ConnectionSnapshot>) {
      Object.assign(state, action.payload);
      if (action.payload.status !== "syncing" && action.payload.status !== "live")
        state.sync = null;
    },
    syncStarted(state, action: PayloadAction<SyncRange>) {
      state.sync = action.payload;
    },
    syncCompleted(state, action: PayloadAction<{ replayedCount: number }>) {
      if (state.sync) state.lastReplay = { ...state.sync, count: action.payload.replayedCount };
      state.sync = null;
    },
  },
});

export const { connectionStateChanged, syncStarted, syncCompleted } = connectionSlice.actions;
export const selectConnection = (state: { connection: ConnectionState }) => state.connection;

/**
 * Replayed range worth highlighting: replays after a lost connection or a resync. The
 * initial catch-up (between the server render and the socket opening) is routine and
 * isn't highlighted.
 */
export const selectHighlightedReplay = (state: { connection: ConnectionState }) => {
  const replay = state.connection.lastReplay;
  return replay && replay.reason !== "initial" && replay.count > 0 ? replay : null;
};
