import type { RootState } from "@pulsedesk/state";
import type { ThemePreference } from "@/app/theme";

/**
 * Data the server hands to the client at hydration time, embedded as
 * `window.__PULSEDESK__` via React's `bootstrapScriptContent`.
 *
 * Runtime config is injected rather than baked into the bundle at build time, so the
 * same build artefact can be promoted across environments.
 */

export interface AssetManifest {
  scripts: string[];
  styles: string[];
}

export interface PublicConfig {
  /** WebSocket URL of the realtime gateway. */
  gatewayUrl: string;
  /** Whether dev-only tooling (reliability panel) may render. Always false in production. */
  devTools: boolean;
}

export interface BootstrapData {
  assets: AssetManifest;
  config: PublicConfig;
  /** Redux state produced during SSR; the client store starts from exactly this. */
  preloadedState: Partial<RootState>;
  /**
   * The server's clock at render time. Time-relative UI ("8s ago") renders with this
   * during hydration so markup matches, then switches to the browser clock.
   */
  serverNow: number;
  theme: ThemePreference;
}

declare global {
  interface Window {
    __PULSEDESK__?: BootstrapData;
  }
}

export const BOOTSTRAP_GLOBAL = "__PULSEDESK__";

export function readBootstrapData(): BootstrapData {
  const data = window.__PULSEDESK__;
  if (!data) {
    throw new Error("Missing bootstrap data: the page was not rendered by the PulseDesk server.");
  }
  return data;
}
