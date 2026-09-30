import type { PulseStore } from "@pulsedesk/state";
import { StrictMode, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import type { AssetManifest, PublicConfig } from "@/lib/bootstrap";
import { ClockProvider } from "@/lib/clock";
import { ConfigProvider } from "./config";
import { Document } from "./Document";
import { AIFaultsProvider } from "@/features/copilot/AIFaultsProvider";
import { RealtimeProvider } from "@/features/realtime/RealtimeProvider";
import { ThemeProvider, type ThemePreference } from "./theme";

export interface RootProps {
  assets: AssetManifest;
  config: PublicConfig;
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
export function Root({ assets, config, store, now, theme, children }: RootProps) {
  return (
    <StrictMode>
      <ConfigProvider config={config}>
        <ReduxProvider store={store}>
          <RealtimeProvider>
            <AIFaultsProvider>
              <ClockProvider now={now}>
                <ThemeProvider initial={theme}>
                  <Document assets={assets}>{children}</Document>
                </ThemeProvider>
              </ClockProvider>
            </AIFaultsProvider>
          </RealtimeProvider>
        </ReduxProvider>
      </ConfigProvider>
    </StrictMode>
  );
}
