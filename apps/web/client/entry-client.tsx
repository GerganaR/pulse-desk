import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../src/styles/app.css";

import { createPulseStore } from "@pulsedesk/state";
import { useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/app/App";
import { Root } from "@/app/Root";
import { preloadAllRoutes } from "@/app/routes";
import { readBootstrapData } from "@/lib/bootstrap";
import { createHttpApi } from "@/lib/http-api";
import { metrics } from "@/lib/metrics";

const { assets, config, preloadedState, serverNow, theme } = readBootstrapData();

const store = createPulseStore({ preloadedState, extra: { api: createHttpApi() } });

/**
 * Renders nothing: its effect runs once the shell has hydrated. The time since navigation
 * start is recorded as a metric and as a User Timing mark (visible in browser DevTools
 * and to the performance tests).
 */
function HydrationMark() {
  useEffect(() => {
    performance.mark("pulsedesk:hydrated");
    metrics.gauge("web.hydration.duration", performance.now());
  }, []);
  return null;
}

hydrateRoot(
  document,
  <Root assets={assets} config={config} store={store} now={serverNow} theme={theme}>
    <BrowserRouter>
      <App />
      <HydrationMark />
    </BrowserRouter>
  </Root>,
  {
    // Fires for hydration mismatches (React re-renders the subtree on the client).
    // These must be treated as bugs; E2E tests fail on this console output.
    onRecoverableError(error, errorInfo) {
      console.error("[hydration] recoverable error", error, errorInfo.componentStack);
    },
  },
);

// Once the page is interactive and the browser is idle, fetch the other pages' chunks so
// navigation doesn't wait on the network. Safari has no requestIdleCallback.
const whenIdle: (callback: () => void) => void =
  "requestIdleCallback" in window
    ? (cb) => window.requestIdleCallback(cb)
    : (cb) => setTimeout(cb, 2_000);
const saveData =
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
whenIdle(() => {
  // Someone who asked their browser to save data gets each page's code when they open it.
  // A failed preload is not an error: the chunk is requested again on navigation.
  if (!saveData) void preloadAllRoutes().catch(() => {});
  // Web Vitals: the browser buffers the entries, so starting late misses nothing.
  void import("@pulsedesk/observability/web-vitals").then(
    ({ reportWebVitals }) => reportWebVitals(metrics),
    () => {},
  );
});
