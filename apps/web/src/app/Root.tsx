import type { PulseStore } from "@pulsedesk/state";
import { StrictMode, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import type { AssetManifest } from "@/lib/bootstrap";
import { ClockProvider } from "@/lib/clock";
import { Document } from "./Document";
import { ThemeProvider, type ThemePreference } from "./theme";

export interface RootProps {
  assets: AssetManifest;
  store: PulseStore;
  /** Render-time clock: the server's `now`, reused by the client during hydration. */
  now: number;
  theme: ThemePreference;
  /** The router — StaticRouter on the server, BrowserRouter on the client. */
  children: ReactNode;
}

/**
 * The single tree both entry points render. Server and client must produce identical
 * markup, so everything except the router implementation lives here, and every input
 * that could differ (state, time, theme) is passed in explicitly from the server.
 */
export function Root({ assets, store, now, theme, children }: RootProps) {
  return (
    <StrictMode>
      <ReduxProvider store={store}>
        <ClockProvider now={now}>
          <ThemeProvider initial={theme}>
            <Document assets={assets}>{children}</Document>
          </ThemeProvider>
        </ClockProvider>
      </ReduxProvider>
    </StrictMode>
  );
}
