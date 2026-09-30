import type { Agent } from "@pulsedesk/contracts";
import { createSlice } from "@reduxjs/toolkit";
import { eventsReceived, snapshotReceived } from "../realtime/realtime.actions.ts";
import { fetchSessionDetail } from "../timeline/timeline.slice.ts";

export interface PresenceState {
  /** Agents currently viewing each session. */
  bySession: Record<string, Agent[]>;
}

const EMPTY: Agent[] = [];

export const presenceSlice = createSlice({
  name: "presence",
  initialState: { bySession: {} } as PresenceState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSessionDetail.fulfilled, (state, action) => {
        const { sessionId, detail } = action.payload;
        if (detail) state.bySession[sessionId] = detail.viewers;
      })
      .addCase(eventsReceived, (state, action) => {
        for (const event of action.payload) {
          if (event.type !== "presence.joined" && event.type !== "presence.left") continue;
          const viewers = (state.bySession[event.sessionId] ?? []).filter(
            (a) => a.id !== event.payload.agent.id,
          );
          state.bySession[event.sessionId] =
            event.type === "presence.joined" ? [...viewers, event.payload.agent] : viewers;
        }
      })
      .addCase(snapshotReceived, () => ({ bySession: {} }));
  },
});

/** Stable empty array so selectors don't return a fresh [] (and re-render) every call. */
export const selectViewers = (state: { presence: PresenceState }, sessionId: string): Agent[] =>
  state.presence.bySession[sessionId] ?? EMPTY;
