import { defineConfig, devices } from "@playwright/test";
import { BATCH_VARIANTS, GATEWAY_PORT, gatewayHttp, webUrl } from "./browser/env.ts";

/**
 * Browser performance scenarios (`pnpm perf`). Not part of `pnpm e2e`: they measure, so
 * they run one at a time, and their numbers depend on the machine.
 *
 * The stack is the production web build and a gateway, with no simulator: each scenario
 * creates exactly the traffic it measures. The gateway is started fresh for every
 * scenario by a fixture (see browser/harness.ts), so one scenario's sessions never show
 * up in another's numbers. One web server per batching window, so the same burst can be
 * compared across windows without rebuilding (the window is runtime configuration,
 * `PUBLIC_EVENT_BATCH_MS`).
 */
export default defineConfig({
  testDir: "./browser",
  testMatch: "**/*.perf.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
  webServer: [
    ...BATCH_VARIANTS.map((batchMs) => ({
      name: `web (batch ${batchMs} ms)`,
      command: "pnpm --filter @pulsedesk/web start",
      url: `${webUrl(batchMs)}/healthz`,
      env: {
        PORT: String(new URL(webUrl(batchMs)).port),
        GATEWAY_HTTP_URL: gatewayHttp,
        PUBLIC_GATEWAY_URL: `ws://localhost:${GATEWAY_PORT}/ws`,
        PUBLIC_EVENT_BATCH_MS: String(batchMs),
        // Nothing here talks to ai-service; point at a closed port rather than a dev one.
        AI_SERVICE_URL: "http://localhost:4359",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    })),
  ],
});
