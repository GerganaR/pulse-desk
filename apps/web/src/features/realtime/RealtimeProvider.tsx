import { createMetrics, createMemorySink } from "@pulsedesk/observability";
import { createRealtimeClient, type RealtimeClient } from "@pulsedesk/realtime-client";
import {
  connectionStateChanged,
  eventsReceived,
  snapshotReceived,
  syncCompleted,
  syncStarted,
} from "@pulsedesk/state";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { useConfig } from "@/app/config";
import { useAppDispatch, useAppStore } from "@/app/hooks";
import { currentAgent } from "@/lib/current-agent";
import { createEventBatcher } from "./event-batcher";

const RealtimeClientContext = createContext<RealtimeClient | null>(null);

/** In-memory metrics for the realtime layer (surfaced by the dev panel in Phase 4). */
export const realtimeMetricsSink = createMemorySink();

/**
 * Owns the WebSocket connection for the lifetime of the app.
 *
 * - The connection opens in an effect, so it never runs during SSR, and resumes from the
 *   stream position the server rendered: no gap between SSR data and live data.
 * - Socket events are batched before dispatch (one Redux update per ~32 ms window).
 * - A snapshot supersedes anything pending, so the batch buffer is cleared, not flushed.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { gatewayUrl } = useConfig();
  const store = useAppStore();
  const dispatch = useAppDispatch();

  // Creating the client has no side effects (no socket until connect()), so it is made
  // once, during render — also on the server, where it's simply never connected. It
  // resumes from the stream position the server rendered.
  const [realtime] = useState(() => {
    const { streamId, sequence } = store.getState().sessions;
    return createRealtimeClient({
      url: gatewayUrl,
      agent: currentAgent,
      resumeFrom: streamId !== null && sequence !== null ? { streamId, sequence } : null,
      metrics: createMetrics(realtimeMetricsSink),
    });
  });

  useEffect(() => {
    const metrics = createMetrics(realtimeMetricsSink);
    const batcher = createEventBatcher({
      onFlush: (events) => {
        metrics.histogram("websocket.batch.size", events.length);
        dispatch(eventsReceived(events));
      },
    });

    const unsubscribe = realtime.subscribe((event) => {
      switch (event.type) {
        case "state": {
          const { status, reconnectAttempt, nextRetryAt, liveSince } = event.state;
          dispatch(connectionStateChanged({ status, reconnectAttempt, nextRetryAt, liveSince }));
          return;
        }
        case "snapshot":
          batcher.clear();
          dispatch(
            snapshotReceived({
              streamId: event.streamId,
              sequence: event.sequence,
              sessions: event.sessions,
            }),
          );
          return;
        case "events":
          batcher.push(event.events);
          return;
        case "sync.started":
          dispatch(syncStarted({ fromSequence: event.fromSequence, toSequence: event.toSequence }));
          return;
        case "sync.completed":
          batcher.flush(); // show replayed events before announcing we're caught up
          dispatch(syncCompleted({ replayedCount: event.replayedCount }));
          return;
      }
    });

    // Under StrictMode this runs twice; close() then connect() is supported and the
    // client keeps its cursor, so the second connection resumes where the first left off.
    realtime.connect();
    return () => {
      unsubscribe();
      realtime.close();
      batcher.flush();
    };
  }, [realtime, dispatch]);

  return <RealtimeClientContext value={realtime}>{children}</RealtimeClientContext>;
}

export function useRealtimeClient(): RealtimeClient {
  const client = use(RealtimeClientContext);
  if (!client) throw new Error("useRealtimeClient() requires <RealtimeProvider>");
  return client;
}

/** Tell the gateway this agent is viewing a session (presence) for as long as mounted. */
export function useWatchSession(sessionId: string) {
  const client = useRealtimeClient();
  // Effects never run during SSR, so presence is only ever announced by a real browser.
  useEffect(() => {
    if (!sessionId) return;
    client.watchSession(sessionId);
    return () => client.unwatchSession(sessionId);
  }, [client, sessionId]);
}
