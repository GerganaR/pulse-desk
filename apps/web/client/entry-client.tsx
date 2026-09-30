// Must stay the first import: configures Zod before any schema module evaluates.
import "@pulsedesk/contracts/csp-safe";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../src/styles/app.css";

import { createPulseStore } from "@pulsedesk/state";
import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/app/App";
import { Root } from "@/app/Root";
import { readBootstrapData } from "@/lib/bootstrap";
import { createHttpApi } from "@/lib/http-api";

const { assets, preloadedState, serverNow, theme } = readBootstrapData();

const store = createPulseStore({ preloadedState, extra: { api: createHttpApi() } });

hydrateRoot(
  document,
  <Root assets={assets} store={store} now={serverNow} theme={theme}>
    <BrowserRouter>
      <App />
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
