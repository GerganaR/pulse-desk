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
