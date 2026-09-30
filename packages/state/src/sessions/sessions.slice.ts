import type { Session, SessionsSnapshot } from "@pulsedesk/contracts";
import {
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
  type EntityState,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { ThunkExtra } from "../api.ts";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface SessionsState extends EntityState<Session, string> {
  status: LoadStatus;
  error: string | null;
  /** Stream position the entities reflect; live events continue from sequence + 1. */
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
  sequence: null,
});

export const fetchSessionsSnapshot = createAsyncThunk<
  SessionsSnapshot,
  undefined,
  { state: { sessions: SessionsState }; extra: ThunkExtra; rejectValue: string }
>(
  "sessions/fetchSnapshot",
  async (_, { extra, signal, rejectWithValue }) => {
    try {
      return await extra.api.fetchSessionsSnapshot(signal);
    } catch (error) {
      if (signal.aborted) throw error; // surfaces as meta.aborted, not a user-facing error
      return rejectWithValue(error instanceof Error ? error.message : "Failed to load sessions");
    }
  },
  {
    // Prevent duplicate in-flight requests (e.g. StrictMode double effects, two
    // components mounting at once).
    condition: (_, { getState }) => getState().sessions.status !== "loading",
  },
);

export const sessionsSlice = createSlice({
  name: "sessions",
  initialState: initialSessionsState,
  reducers: {
    snapshotReceived(state, action: PayloadAction<SessionsSnapshot>) {
      sessionsAdapter.setAll(state, action.payload.sessions);
      state.sequence = action.payload.sequence;
      state.status = "ready";
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSessionsSnapshot.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchSessionsSnapshot.fulfilled, (state, action) => {
        sessionsAdapter.setAll(state, action.payload.sessions);
        state.sequence = action.payload.sequence;
        state.status = "ready";
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

export const { snapshotReceived } = sessionsSlice.actions;
