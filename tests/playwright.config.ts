import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);
const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? 4150);
const baseURL = `http://localhost:${WEB_PORT}`;
const gatewayHttp = `http://localhost:${GATEWAY_PORT}`;

/**
 * E2E runs the whole stack: the realtime gateway and event simulator from source, and
 * the *production* web build (what ships: real SSR server, asset manifest, CSP, hashed
 * assets). The simulator is seeded and fast so tests see activity within seconds.
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
      name: "web",
      command: "pnpm --filter @pulsedesk/web start",
      url: `${baseURL}/healthz`,
      env: {
        PORT: String(WEB_PORT),
        GATEWAY_HTTP_URL: gatewayHttp,
        PUBLIC_GATEWAY_URL: `ws://localhost:${GATEWAY_PORT}/ws`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
