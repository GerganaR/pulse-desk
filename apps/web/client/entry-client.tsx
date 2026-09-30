import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../src/styles/app.css";

import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/app/App";
import { Root } from "@/app/Root";
import { readBootstrapData } from "@/lib/bootstrap";

const { assets } = readBootstrapData();

hydrateRoot(
  document,
  <Root assets={assets}>
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
