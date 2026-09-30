import { combineReducers, configureStore } from "@reduxjs/toolkit";
import type { ThunkExtra } from "./api.ts";
import { presenceSlice } from "./presence/presence.slice.ts";
import { connectionSlice } from "./realtime/connection.slice.ts";
import { sessionsSlice } from "./sessions/sessions.slice.ts";
import { timelinesSlice } from "./timeline/timeline.slice.ts";

export const rootReducer = combineReducers({
  [sessionsSlice.reducerPath]: sessionsSlice.reducer,
  [timelinesSlice.reducerPath]: timelinesSlice.reducer,
  [presenceSlice.reducerPath]: presenceSlice.reducer,
  [connectionSlice.reducerPath]: connectionSlice.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export interface CreateStoreOptions {
  preloadedState?: Partial<RootState>;
  extra: ThunkExtra;
}

/**
 * A new store per SSR request and one per browser tab. Never a module singleton on the
 * server: that would leak one visitor's state into another's response.
 */
export function createPulseStore({ preloadedState, extra }: CreateStoreOptions) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefault) => getDefault({ thunk: { extraArgument: extra } }),
  });
}

export type PulseStore = ReturnType<typeof createPulseStore>;
export type AppDispatch = PulseStore["dispatch"];
