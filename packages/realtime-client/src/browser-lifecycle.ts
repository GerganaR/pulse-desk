import type { RealtimeClient } from "./client.ts";

export interface BrowserLifecycleOptions {
  /** A tab hidden at least this long gets an immediate health check when shown again. */
  hiddenCheckAfterMs?: number;
}

/**
 * Connects the client to browser signals it can't observe from the socket alone:
 *
 * - `offline` / `online`: stop retrying into a dead network, and retry at once (skipping
 *   the backoff wait) when it returns.
 * - `visibilitychange`: background tabs have their timers throttled (Chrome: down to once
 *   a minute), and a laptop that slept may hold a socket that is already dead. When the
 *   tab comes back after a while, check the connection now instead of at the next
 *   heartbeat, and cut short any pending backoff.
 *
 * Returns a function that removes the listeners. A separate entry point
 * (`@pulsedesk/realtime-client/browser`) so Node consumers never see DOM globals.
 */
export function bindBrowserLifecycle(
  client: Pick<RealtimeClient, "setNetworkStatus" | "reconnectNow" | "checkConnection">,
  { hiddenCheckAfterMs = 5_000 }: BrowserLifecycleOptions = {},
): () => void {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => client.setNetworkStatus(true);
  const onOffline = () => client.setNetworkStatus(false);
  let hiddenAt: number | null = document.hidden ? Date.now() : null;

  const onVisibilityChange = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (hiddenFor < hiddenCheckAfterMs) return;
    client.reconnectNow();
    client.checkConnection();
  };

  if (!navigator.onLine) client.setNetworkStatus(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
