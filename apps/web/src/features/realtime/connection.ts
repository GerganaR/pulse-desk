import type { TransportFactory } from "@pulsedesk/realtime-client";
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
  selectExpiredSessionIds,
  sessionsExpired,
  snapshotReceived,
  syncCompleted,
  syncStarted,
  type AppDispatch,
  type RootState,
} from "@pulsedesk/state";
import { currentAgent } from "@/lib/current-agent";
import { formatCount } from "@/lib/format";
import { metrics } from "@/lib/metrics";
import { createEventBatcher } from "./event-batcher";
import { PROLONGED_OUTAGE_MS } from "./outage";

export interface Connection {
  client: RealtimeClient;
  /** Only in devtools builds with devtools enabled: the transport's fault controls. */
  faults: FaultInjector | null;
  /** Close the socket and apply anything still buffered. */
  stop(): void;
}

export interface ConnectionOptions {
  gatewayUrl: string;
  devTools: boolean;
  /** Batching window for incoming events; the batcher's default when omitted. */
  eventBatchMs?: number;
  getState: () => RootState;
  dispatch: AppDispatch;
  /** Tests inject a fake socket. */
  transport?: TransportFactory;
}

/**
 * Opens the WebSocket connection and feeds the store from it. This module is a lazy
 * chunk: the realtime client, the wire schemas and the validation library aren't needed
 * to hydrate a server-rendered page, so they load right after it.
 *
 * - Resumes from the stream position the store already reflects (the server-rendered
 *   snapshot on first load): no gap between SSR data and live data.
 * - Socket events are batched before dispatch (one Redux update per batching window).
 * - A snapshot supersedes anything pending, so the batch buffer is cleared, not flushed.
 * - Reconnects are quiet (the indicator changes, nothing pops up). Only recovering from a
 *   prolonged outage, or from a gateway restart, earns a single toast.
 */
export function startConnection({
  gatewayUrl,
  devTools,
  eventBatchMs,
  getState,
  dispatch,
  transport,
}: ConnectionOptions): Connection {
  const { streamId, sequence } = getState().sessions;
  // `__DEVTOOLS__` is a build-time constant: in production builds this is `null` and the
  // fault-injection module is never bundled.
  const faults = __DEVTOOLS__ && devTools ? createFaultInjector() : null;
  const client = createRealtimeClient({
    url: gatewayUrl,
    agent: currentAgent,
    resumeFrom: streamId !== null && sequence !== null ? { streamId, sequence } : null,
    metrics,
    transport: transport ?? faults?.transport,
  });

  const batcher = createEventBatcher({
    intervalMs: eventBatchMs,
    onFlush: (events) => {
      metrics.histogram("websocket.batch.size", events.length);
      dispatch(eventsReceived(events));
      // A session ending is the only thing that can push the tab past its retention of
      // ended sessions, so that's when to check. Same tick: React renders both at once.
      const closedAt = events.findLast((event) => event.type === "session.closed")?.timestamp;
      if (closedAt === undefined) return;
      const expired = selectExpiredSessionIds(getState(), closedAt);
      if (expired.length > 0) dispatch(sessionsExpired(expired));
    },
  });

  // For the single "we're back" toast. A short blip gets none; a prolonged outage or a
  // reload from a fresh snapshot (gateway restart) gets one, saying what happened.
  let outageStartedAt: number | null = null;
  let caughtUp: string | null = null;
  let reloaded: string | null = null;

  const unsubscribe = client.subscribe((event) => {
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

  client.connect();
  const unbindLifecycle = bindBrowserLifecycle(client);

  return {
    client,
    faults,
    stop() {
      unbindLifecycle();
      unsubscribe();
      client.close();
      batcher.flush();
    },
  };
}
