import path from "node:path";
import type { PublicConfig } from "@/lib/bootstrap";

// `process.env.NODE_ENV` is replaced at build time by Rspack (`mode`), so dev-only
// branches are dead-code-eliminated from the production server bundle.
const isProd = process.env.NODE_ENV === "production";

// Bundled output lives in dist/server; the client build sits next to it in dist/client.
const distDir = path.resolve(import.meta.dirname, "..");
const appDir = path.resolve(distDir, "..");

const gatewayUrl = process.env.PUBLIC_GATEWAY_URL ?? "ws://localhost:4000/ws";

export const serverConfig = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  clientDist: path.join(distDir, "client"),
  publicDir: path.join(appDir, "public"),
  /** Hard ceiling for a single SSR render before we abort and let the client finish. */
  ssrTimeoutMs: Number(process.env.SSR_TIMEOUT_MS ?? 10_000),
  /** Origin of the Rspack dev server that serves client assets in development. */
  clientDevOrigin: `http://localhost:${process.env.CLIENT_DEV_PORT ?? 3001}`,
  publicConfig: {
    gatewayUrl,
    // Not configurable via env on purpose: debug controls can never ship to production.
    devTools: !isProd,
  } satisfies PublicConfig,
};
