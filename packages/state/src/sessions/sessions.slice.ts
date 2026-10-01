import { projectSession, type Session, type SessionsSnapshot } from "@pulsedesk/contracts";
import {
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
  type EntityState,
} from "@reduxjs/toolkit";
import type { ThunkExtra } from "../api.ts";
import { eventsReceived, sessionsExpired, snapshotReceived } from "../realtime/realtime.actions.ts";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface SessionsState extends EntityState<Session, string> {
  status: LoadStatus;
  error: string | null;
  /** Stream epoch the entities belong to. */
  streamId: string | null;
  /**
   * Stream position the entities reflect. Events at or below it are already included
   * and are skipped, which makes applying an overlapping replay safe.
   */
  sequence: number | null;
}

/**
 * Normalised by id. Deliberately no `sortComparer`: `lastActivityAt` changes on almost
 * every realtime event, so a sorted id list would be re-sorted on every update. Ordering
 * is done in memoised selectors, only when a consumer actually needs it.
 */
export const sessionsAdapter = createEntityAdapter<Session>();

export const initialSessionsState: SessionsState = sessionsAdapter.getInitialState({
  status: "idle",
  error: null,
  streamId: null,
  sequence: null,
});

export const fetchSessionsSnapshot = createAsyncThunk<
  SessionsSnapshot,
  undefined,
  { state: { sessions: SessionsState }; extra: ThunkExtra; rejectValue: string }
>(
  "sessions/fetchSnapshot",
  async (_, { extra, signal, rejectWithValue, dispatch }) => {
    try {
      const snapshot = await extra.api.fetchSessionsSnapshot(signal);
      dispatch(snapshotReceived(snapshot));
      return snapshot;
    } catch (error) {
      if (signal.aborted) throw error; // surfaces as meta.aborted, not a user-facing error
      return rejectWithValue(error instanceof Error ? error.message : "Failed to load sessions");
    }
  },
  {
    // Prevent duplicate in-flight requests (StrictMode double effects, several consumers).
    condition: (_, { getState }) => getState().sessions.status !== "loading",
  },
);

export const sessionsSlice = createSlice({
  name: "sessions",
  initialState: initialSessionsState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(snapshotReceived, (state, action) => {
        const { streamId, sequence, sessions } = action.payload;
        // Never let an older snapshot of the same stream overwrite newer state (e.g. a
        // slow HTTP response landing after the socket already delivered more).
        if (state.streamId === streamId && state.sequence !== null && sequence < state.sequence)
          return;
        sessionsAdapter.setAll(state, sessions);
        state.streamId = streamId;
        state.sequence = sequence;
        state.status = "ready";
        state.error = null;
      })
      .addCase(eventsReceived, (state, action) => {
        for (const event of action.payload) {
          if (state.sequence !== null && event.sequence <= state.sequence) continue;
          const current = state.entities[event.sessionId];
          const next = projectSession(current, event);
          if (next && next !== current) sessionsAdapter.setOne(state, next);
          state.sequence = event.sequence;
        }
      })
      .addCase(sessionsExpired, (state, action) => {
        sessionsAdapter.removeMany(state, action.payload);
      })
      .addCase(fetchSessionsSnapshot.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchSessionsSnapshot.rejected, (state, action) => {
        if (action.meta.aborted) {
          // A cancelled request isn't a failure; keep whatever we had.
          state.status = state.sequence === null ? "idle" : "ready";
          return;
        }
        state.status = "error";
        state.error = action.payload ?? action.error.message ?? "Failed to load sessions";
      });
  },
});
