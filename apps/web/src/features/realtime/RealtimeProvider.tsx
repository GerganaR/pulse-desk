import { createMetrics, createMemorySink } from "@pulsedesk/observability";
import { createRealtimeClient, type RealtimeClient } from "@pulsedesk/realtime-client";
import { bindBrowserLifecycle } from "@pulsedesk/realtime-client/browser";
import {
  createFaultInjector,
  type FaultInjector,
} from "@pulsedesk/realtime-client/fault-injection";
import {
  connectionStateChanged,
  eventsReceived,
  notificationAdded,
  snapshotReceived,
  syncCompleted,
  syncStarted,
} from "@pulsedesk/state";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { useConfig } from "@/app/config";
import { useAppDispatch, useAppStore } from "@/app/hooks";
import { currentAgent } from "@/lib/current-agent";
import { formatCount } from "@/lib/format";
import { createEventBatcher } from "./event-batcher";
import { PROLONGED_OUTAGE_MS } from "./outage";

interface RealtimeContextValue {
  client: RealtimeClient;
  /** Only in devtools builds with devtools enabled: the transport's fault controls. */
  faults: FaultInjector | null;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/** In-memory metrics for the realtime layer, shown in the dev reliability panel. */
export const realtimeMetricsSink = createMemorySink();

/**
 * Owns the WebSocket connection for the lifetime of the app.
 *
 * - The connection opens in an effect, so it never runs during SSR, and resumes from the
 *   stream position the server rendered: no gap between SSR data and live data.
 * - Socket events are batched before dispatch (one Redux update per ~32 ms window).
 * - A snapshot supersedes anything pending, so the batch buffer is cleared, not flushed.
 * - Reconnects are quiet (the indicator changes, nothing pops up). Only recovering from a
 *   prolonged outage, or from a gateway restart, earns a single toast.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { gatewayUrl, devTools } = useConfig();
  const store = useAppStore();
  const dispatch = useAppDispatch();

  // Creating the client has no side effects (no socket until connect()), so it is made
  // once, during render — also on the server, where it's simply never connected. It
  // resumes from the stream position the server rendered.
  const [value] = useState<RealtimeContextValue>(() => {
    const { streamId, sequence } = store.getState().sessions;
    // `__DEVTOOLS__` is a build-time constant: in production builds this is `null` and the
    // fault-injection module is never bundled.
    const faults = __DEVTOOLS__ && devTools ? createFaultInjector() : null;
    const client = createRealtimeClient({
      url: gatewayUrl,
      agent: currentAgent,
      resumeFrom: streamId !== null && sequence !== null ? { streamId, sequence } : null,
      metrics: createMetrics(realtimeMetricsSink),
      transport: faults?.transport,
    });
    return { client, faults };
  });
  const realtime = value.client;

  useEffect(() => {
    const metrics = createMetrics(realtimeMetricsSink);
    const batcher = createEventBatcher({
      onFlush: (events) => {
        metrics.histogram("websocket.batch.size", events.length);
        dispatch(eventsReceived(events));
      },
    });

    // For the single "we're back" toast. A short blip gets none; a prolonged outage or a
    // reload from a fresh snapshot (gateway restart) gets one, saying what happened.
    let outageStartedAt: number | null = null;
    let caughtUp: string | null = null;
    let reloaded: string | null = null;

    const unsubscribe = realtime.subscribe((event) => {
      switch (event.type) {
        case "state": {
          const s = event.state;
          dispatch(
            connectionStateChanged({
              status: s.status,
              reconnectAttempt: s.reconnectAttempt,
              nextRetryAt: s.nextRetryAt,
              liveSince: s.liveSince,
              disconnectedAt: s.disconnectedAt,
              network: s.network,
              rttMs: s.rttMs,
              degraded: s.degraded,
            }),
          );
          if (s.disconnectedAt !== null) {
            outageStartedAt = s.disconnectedAt;
          } else if (s.status === "live") {
            const prolonged =
              outageStartedAt !== null && Date.now() - outageStartedAt >= PROLONGED_OUTAGE_MS;
            if (prolonged || reloaded)
              dispatch(
                notificationAdded({
                  tone: "success",
                  title: "Live updates restored",
                  description: reloaded ?? caughtUp ?? undefined,
                }),
              );
            outageStartedAt = caughtUp = reloaded = null;
          }
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
          if (event.reason === "new_stream")
            reloaded = "The gateway restarted, so sessions were reloaded from a fresh snapshot.";
          else if (event.reason === "cursor_expired")
            reloaded = "Too much happened while offline to replay, so sessions were reloaded.";
          return;
        case "events":
          batcher.push(event.events);
          return;
        case "sync.started":
          dispatch(
            syncStarted({
              fromSequence: event.fromSequence,
              toSequence: event.toSequence,
              reason: event.reason,
            }),
          );
          return;
        case "sync.completed":
          batcher.flush(); // show replayed events before announcing we're caught up
          dispatch(syncCompleted({ replayedCount: event.replayedCount }));
          if (event.reason === "reconnect" && event.replayedCount > 0) {
            const count = formatCount(event.replayedCount);
            caughtUp = `Caught up on ${count} missed event${event.replayedCount === 1 ? "" : "s"}.`;
          }
          return;
      }
    });

    // Under StrictMode this runs twice; close() then connect() is supported and the
    // client keeps its cursor, so the second connection resumes where the first left off.
    realtime.connect();
    const unbindLifecycle = bindBrowserLifecycle(realtime);
    return () => {
      unbindLifecycle();
      unsubscribe();
      realtime.close();
      batcher.flush();
    };
  }, [realtime, dispatch]);

  return <RealtimeContext value={value}>{children}</RealtimeContext>;
}

function useRealtimeContext(): RealtimeContextValue {
  const context = use(RealtimeContext);
  if (!context) throw new Error("Realtime hooks require <RealtimeProvider>");
  return context;
}

export function useRealtimeClient(): RealtimeClient {
  return useRealtimeContext().client;
}

/** Fault controls for the dev reliability panel; null unless devtools are enabled. */
export function useFaultInjector(): FaultInjector | null {
  return useRealtimeContext().faults;
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
