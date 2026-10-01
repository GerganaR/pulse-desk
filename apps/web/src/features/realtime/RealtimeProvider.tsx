import type { RealtimeClient } from "@pulsedesk/realtime-client";
import type { FaultInjector } from "@pulsedesk/realtime-client/fault-injection";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { useConfig } from "@/app/config";
import { useAppStore } from "@/app/hooks";
import type { Connection } from "./connection";

const RealtimeContext = createContext<Connection | null>(null);

/** The connection chunk. Named so the server can send a preload hint for it. */
const loadConnection = () => import(/* webpackChunkName: "realtime" */ "./connection");

/** Waits between attempts to fetch the connection chunk when the fetch itself fails. */
const CHUNK_RETRY_MS = [1_000, 3_000, 10_000, 30_000] as const;

/**
 * Owns the WebSocket connection for the lifetime of the app.
 *
 * The connection opens in an effect, so it never runs during SSR. Its code (the realtime
 * client, the wire schemas and their validation) is a separate chunk, fetched in parallel
 * with the page's scripts and run after hydration: a server-rendered page is readable and
 * interactive before any of it executes. Until the chunk has run, the context is `null`
 * and the status pill reads "Connecting".
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { gatewayUrl, devTools, eventBatchMs } = useConfig();
  const store = useAppStore();
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    let stopped = false;
    let started: Connection | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const start = (attempt: number) => {
      loadConnection().then(
        ({ startConnection }) => {
          // Under StrictMode this effect runs twice; the first run is stopped before its
          // chunk resolves and never opens a socket.
          if (stopped) return;
          started = startConnection({
            gatewayUrl,
            devTools,
            eventBatchMs,
            getState: store.getState,
            dispatch: store.dispatch,
          });
          setConnection(started);
        },
        () => {
          // The chunk couldn't be fetched (offline, or a deploy replaced it). Keep trying:
          // without it the page would say "Connecting" forever.
          if (stopped) return;
          const delay = CHUNK_RETRY_MS[Math.min(attempt, CHUNK_RETRY_MS.length - 1)];
          retryTimer = setTimeout(() => start(attempt + 1), delay);
        },
      );
    };
    start(0);

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      started?.stop();
      setConnection(null);
    };
  }, [gatewayUrl, devTools, eventBatchMs, store]);

  return <RealtimeContext value={connection}>{children}</RealtimeContext>;
}

/** The realtime client, or `null` until the connection chunk has loaded. */
export function useRealtimeClient(): RealtimeClient | null {
  return use(RealtimeContext)?.client ?? null;
}

/** Fault controls for the dev reliability panel; null unless devtools are enabled. */
export function useFaultInjector(): FaultInjector | null {
  return use(RealtimeContext)?.faults ?? null;
}

/** Tell the gateway this agent is viewing a session (presence) for as long as mounted. */
export function useWatchSession(sessionId: string) {
  const client = useRealtimeClient();
  // Effects never run during SSR, so presence is only ever announced by a real browser.
  useEffect(() => {
    if (!client || !sessionId) return;
    client.watchSession(sessionId);
    return () => client.unwatchSession(sessionId);
  }, [client, sessionId]);
}
