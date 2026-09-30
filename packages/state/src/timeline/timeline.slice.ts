import type { RealtimeEvent, SessionDetailSnapshot } from "@pulsedesk/contracts";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { ThunkExtra } from "../api.ts";
import { eventsReceived, snapshotReceived } from "../realtime/realtime.actions.ts";

/** Client-side cap per session; older entries are dropped (and flagged) past it. */
export const TIMELINE_LIMIT = 500;

export type HistoryStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface Timeline {
  /** Ordered by sequence, unique by sequence. */
  events: RealtimeEvent[];
  history: HistoryStatus;
  error: string | null;
  /** Older events exist that aren't loaded. */
  truncated: boolean;
}

export interface TimelinesState {
  streamId: string | null;
  /**
   * Only sessions someone has opened get a timeline: memory scales with what agents
   * look at, not with all traffic. Live events for those sessions are appended as they
   * arrive, even while their history is still loading.
   */
  bySession: Record<string, Timeline>;
}

export const initialTimelinesState: TimelinesState = { streamId: null, bySession: {} };

const emptyTimeline = (): Timeline => ({
  events: [],
  history: "idle",
  error: null,
  truncated: false,
});

/** Merge by sequence: overlapping history and live events can arrive in any order. */
function merge(
  existing: RealtimeEvent[],
  incoming: readonly RealtimeEvent[],
): { events: RealtimeEvent[]; dropped: boolean } {
  const bySequence = new Map<number, RealtimeEvent>();
  for (const event of existing) bySequence.set(event.sequence, event);
  for (const event of incoming) bySequence.set(event.sequence, event);
  const events = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
  const dropped = events.length > TIMELINE_LIMIT;
  return { events: dropped ? events.slice(-TIMELINE_LIMIT) : events, dropped };
}

export const fetchSessionDetail = createAsyncThunk<
  { sessionId: string; detail: SessionDetailSnapshot | null },
  string,
  { state: { timelines: TimelinesState }; extra: ThunkExtra; rejectValue: string }
>(
  "timelines/fetchSessionDetail",
  async (sessionId, { extra, signal, rejectWithValue }) => {
    try {
      return { sessionId, detail: await extra.api.fetchSessionDetail(sessionId, signal) };
    } catch (error) {
      if (signal.aborted) throw error;
      return rejectWithValue(error instanceof Error ? error.message : "Failed to load activity");
    }
  },
  {
    condition: (sessionId, { getState }) => {
      const history = getState().timelines.bySession[sessionId]?.history;
      return history !== "loading" && history !== "ready";
    },
  },
);

export const timelinesSlice = createSlice({
  name: "timelines",
  initialState: initialTimelinesState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(snapshotReceived, (state, action) => {
        // A new stream epoch restarts sequences: timelines from the old epoch can't be
        // merged with the new one, so drop them and let open pages refetch.
        if (state.streamId !== null && state.streamId !== action.payload.streamId)
          state.bySession = {};
        state.streamId = action.payload.streamId;
      })
      .addCase(eventsReceived, (state, action) => {
        const bySession = new Map<string, RealtimeEvent[]>();
        for (const event of action.payload) {
          if (!state.bySession[event.sessionId]) continue;
          bySession.set(event.sessionId, [...(bySession.get(event.sessionId) ?? []), event]);
        }
        for (const [sessionId, events] of bySession) {
          const timeline = state.bySession[sessionId];
          if (!timeline) continue;
          // Fast path: live events almost always extend the end of the timeline.
          const last = timeline.events.at(-1)?.sequence ?? 0;
          if (events.every((e) => e.sequence > last)) timeline.events.push(...events);
          else timeline.events = merge(timeline.events, events).events;
          if (timeline.events.length > TIMELINE_LIMIT) {
            timeline.events.splice(0, timeline.events.length - TIMELINE_LIMIT);
            timeline.truncated = true;
          }
        }
      })
      .addCase(fetchSessionDetail.pending, (state, action) => {
        const timeline = (state.bySession[action.meta.arg] ??= emptyTimeline());
        timeline.history = "loading";
        timeline.error = null;
      })
      .addCase(fetchSessionDetail.fulfilled, (state, action) => {
        const { sessionId, detail } = action.payload;
        const timeline = (state.bySession[sessionId] ??= emptyTimeline());
        if (!detail) {
          timeline.history = "missing";
          return;
        }
        if (state.streamId !== null && detail.streamId !== state.streamId) {
          // History from a different epoch than our live stream: don't mix sequences.
          timeline.history = "idle";
          return;
        }
        const merged = merge(timeline.events, detail.events);
        timeline.events = merged.events;
        timeline.truncated = detail.truncated || merged.dropped;
        timeline.history = "ready";
      })
      .addCase(fetchSessionDetail.rejected, (state, action) => {
        const timeline = state.bySession[action.meta.arg];
        if (!timeline) return;
        timeline.history = action.meta.aborted ? "idle" : "error";
        timeline.error = action.meta.aborted ? null : (action.payload ?? "Failed to load activity");
      });
  },
});

export const selectTimeline = (
  state: { timelines: TimelinesState },
  sessionId: string,
): Timeline | undefined => state.timelines.bySession[sessionId];
