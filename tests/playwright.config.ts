import { defineConfig, devices } from "@playwright/test";

import {
  AI_SERVICE_PORT,
  DEVTOOLS_WEB_PORT,
  GATEWAY_PORT,
  OUTAGE_WEB_PORT,
  UNREACHABLE_GATEWAY_PORT,
  WEB_PORT,
  aiServiceHttp,
  devtoolsWebUrl,
  gatewayHttp,
  outageWebUrl,
  webUrl as baseURL,
} from "./e2e/env.ts";

/**
 * E2E runs the whole stack: the realtime gateway, event simulator and ai-service (mock
 * provider, dev faults enabled, 3 s first-token limit) from source, and
 * the *production* web build (what ships: real SSR server, asset manifest, CSP, hashed
 * assets). The simulator is seeded and fast so tests see activity within seconds.
 *
 * A second web server runs the devtools build (`pnpm build:devtools`): identical except
 * that the reliability panel is compiled in. Only the reliability spec uses it, so every
 * other test still exercises the exact artefact that ships.
 *
 * A third serves the production build with the gateway unreachable, which is how a page
 * gets into its error and outage states without any test-only code in the app. Only the
 * accessibility spec uses it.
 * Ports differ from `pnpm dev` defaults so a running dev stack doesn't interfere.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      name: "gateway",
      command: "pnpm --filter @pulsedesk/realtime-gateway start",
      url: `${gatewayHttp}/healthz`,
      env: { GATEWAY_PORT: String(GATEWAY_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "simulator",
      command: "pnpm --filter @pulsedesk/event-simulator start",
      wait: { stdout: /simulator\.starting/ },
      env: {
        GATEWAY_HTTP_URL: gatewayHttp,
        SEED: "7",
        SESSION_COUNT: "10",
        EVENT_RATE: "10",
        ERROR_RATE: "0",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "ai-service",
      command: "pnpm --filter @pulsedesk/ai-service start",
      url: `${aiServiceHttp}/healthz`,
      env: {
        AI_SERVICE_PORT: String(AI_SERVICE_PORT),
        AI_DEBUG: "1",
        AI_FIRST_TOKEN_TIMEOUT_MS: "3000",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "web",
      command: "pnpm --filter @pulsedesk/web start",
      url: `${baseURL}/healthz`,
      env: {
        PORT: String(WEB_PORT),
        GATEWAY_HTTP_URL: gatewayHttp,
        PUBLIC_GATEWAY_URL: `ws://localhost:${GATEWAY_PORT}/ws`,
        AI_SERVICE_URL: aiServiceHttp,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      name: "web-devtools",
      command: "pnpm --filter @pulsedesk/web start:devtools",
      url: `${devtoolsWebUrl}/healthz`,
      env: {
        PORT: String(DEVTOOLS_WEB_PORT),
        GATEWAY_HTTP_URL: gatewayHttp,
        PUBLIC_GATEWAY_URL: `ws://localhost:${GATEWAY_PORT}/ws`,
        AI_SERVICE_URL: aiServiceHttp,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      name: "web-outage",
      command: "pnpm --filter @pulsedesk/web start",
      url: `${outageWebUrl}/healthz`,
      env: {
        PORT: String(OUTAGE_WEB_PORT),
        GATEWAY_HTTP_URL: `http://localhost:${UNREACHABLE_GATEWAY_PORT}`,
        PUBLIC_GATEWAY_URL: `ws://localhost:${UNREACHABLE_GATEWAY_PORT}/ws`,
        AI_SERVICE_URL: aiServiceHttp,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
