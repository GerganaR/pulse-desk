import type { Page } from "@playwright/test";
import { BASELINE_URL, CPU_THROTTLE, webUrl } from "./env.ts";
import {
  expect,
  test,
  cpuTime,
  createSessions,
  liveIndicator,
  report,
  throttleCpu,
} from "./harness.ts";

const RUNS = 5;

interface LoadTiming {
  /** Sum of long-task time beyond 50 ms, from navigation until the page is live. */
  blockingMs: number;
  scriptMs: number;
  /** JavaScript transferred for the page (compressed size is 0 here: served uncompressed). */
  jsKb: number;
  jsRequests: number;
  fcpMs: number;
  lcpMs: number;
  /** The app's own mark; builds before Phase 7 don't set it. */
  hydratedMs: number | null;
  /** Navigation start until the connection indicator says Live. */
  liveMs: number;
}

/**
 * Chrome DevTools' "Slow 4G" preset. The app server doesn't compress responses (a CDN or
 * proxy would), so absolute times here are pessimistic; the comparison between builds is
 * what this is for.
 */
const SLOW_4G = {
  latency: 150,
  downloadThroughput: (1.6 * 1_000_000) / 8,
  uploadThroughput: 93_750,
};

/** Load a page cold (new context each time) with the CPU throttled from the start. */
async function measureLoad(page: Page, url: string, slowNetwork: boolean): Promise<LoadTiming> {
  const cdp = await throttleCpu(page);
  if (slowNetwork) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
  }
  await page.addInitScript(() => {
    const store = { blocking: 0, lcp: 0 };
    (window as unknown as { __load: typeof store }).__load = store;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.blocking += Math.max(0, entry.duration - 50);
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });

  await page.goto(url);
  await expect(liveIndicator(page)).toBeVisible({ timeout: 90_000 });
  const liveMs = await page.evaluate(() => performance.now());
  await page.waitForTimeout(500); // late long tasks are delivered to the observer

  const inPage = await page.evaluate(() => {
    const store = (window as unknown as { __load: { blocking: number; lcp: number } }).__load;
    const scripts = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.endsWith(".js")) as PerformanceResourceTiming[];
    return {
      blockingMs: store.blocking,
      lcpMs: store.lcp,
      fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
      hydratedMs: performance.getEntriesByName("pulsedesk:hydrated")[0]?.startTime ?? null,
      jsKb: scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0) / 1_000,
      jsRequests: scripts.length,
    };
  });
  return { ...inPage, scriptMs: (await cpuTime(cdp)).scriptMs, liveMs };
}

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * What a first visit costs, per route, with the CPU throttled: median of several cold
 * loads. With PERF_BASELINE_URL set, the same is measured for another build served from
 * that URL (and the same gateway), for a before/after comparison.
 */
test.describe(`page load, ${CPU_THROTTLE}x CPU throttle, median of ${RUNS}`, () => {
  const builds = [
    { name: "current", origin: webUrl() },
    ...(BASELINE_URL ? [{ name: "baseline", origin: BASELINE_URL }] : []),
  ];

  for (const { name, origin } of builds) {
    const cases = [
      { route: "dashboard", sessions: 25 },
      { route: "sessions", sessions: 25 },
      { route: "session", sessions: 1 },
      // A busy site: what virtualising the table (and server-rendering only its top) buys.
      { route: "sessions", sessions: 2_000 },
      // The same dashboard over a slow connection: where the size of the bundle shows.
      { route: "dashboard", sessions: 25, slowNetwork: true },
    ] as const;
    for (const { route, sessions: sessionCount, ...options } of cases) {
      const slowNetwork = "slowNetwork" in options;
      const label = `${route} (${sessionCount} sessions${slowNetwork ? ", slow 4G" : ""})`;
      test(`${name}: ${label}`, async ({ browser, request }) => {
        const sessions = await createSessions(request, sessionCount);
        const path = route === "session" ? `/sessions/${sessions[0]!.id}` : `/${route}`;
        const runs: LoadTiming[] = [];
        for (let run = 0; run < RUNS; run++) {
          const context = await browser.newContext();
          runs.push(await measureLoad(await context.newPage(), origin + path, slowNetwork));
          await context.close();
        }
        const median = (pick: (timing: LoadTiming) => number) => medianOf(runs.map(pick));
        const hydrated = runs.map((r) => r.hydratedMs).filter((ms) => ms !== null);
        report(`load ${name} ${label}`, {
          jsKb: median((r) => r.jsKb),
          jsRequests: median((r) => r.jsRequests),
          scriptMs: median((r) => r.scriptMs),
          blockingMs: median((r) => r.blockingMs),
          fcpMs: median((r) => r.fcpMs),
          lcpMs: median((r) => r.lcpMs),
          hydratedMs: hydrated.length > 0 ? medianOf(hydrated) : "n/a",
          liveMs: median((r) => r.liveMs),
        });
        expect(runs).toHaveLength(RUNS);
      });
    }
  }
});
