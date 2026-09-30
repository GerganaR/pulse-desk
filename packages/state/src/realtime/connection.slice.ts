import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Mirrors the realtime client's state for the UI; the client stays the source of truth. */
export type RealtimeStatus = "idle" | "connecting" | "syncing" | "live" | "reconnecting" | "closed";

export interface ConnectionState {
  status: RealtimeStatus;
  reconnectAttempt: number;
  nextRetryAt: number | null;
  liveSince: number | null;
  /** Replay in progress after a reconnect. */
  sync: { fromSequence: number; toSequence: number } | null;
  lastSyncReplayed: number | null;
}

export const initialConnectionState: ConnectionState = {
  status: "idle",
  reconnectAttempt: 0,
  nextRetryAt: null,
  liveSince: null,
  sync: null,
  lastSyncReplayed: null,
};

export const connectionSlice = createSlice({
  name: "connection",
  initialState: initialConnectionState,
  reducers: {
    connectionStateChanged(
      state,
      action: PayloadAction<
        Pick<ConnectionState, "status" | "reconnectAttempt" | "nextRetryAt" | "liveSince">
      >,
    ) {
      Object.assign(state, action.payload);
      if (action.payload.status !== "syncing" && action.payload.status !== "live")
        state.sync = null;
    },
    syncStarted(state, action: PayloadAction<{ fromSequence: number; toSequence: number }>) {
      state.sync = action.payload;
    },
    syncCompleted(state, action: PayloadAction<{ replayedCount: number }>) {
      state.sync = null;
      state.lastSyncReplayed = action.payload.replayedCount;
    },
  },
});

export const { connectionStateChanged, syncStarted, syncCompleted } = connectionSlice.actions;
export const selectConnection = (state: { connection: ConnectionState }) => state.connection;
