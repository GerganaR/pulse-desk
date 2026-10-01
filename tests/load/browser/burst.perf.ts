import type { APIRequestContext, Page } from "@playwright/test";
import { BATCH_VARIANTS, CPU_THROTTLE, DEFAULT_BATCH_MS, webUrl } from "./env.ts";
import {
  expect,
  expectSmooth,
  test,
  cpuDelta,
  cpuTime,
  createSessions,
  liveIndicator,
  report,
  sendBurst,
  startRecording,
  stopRecording,
  throttleCpu,
} from "./harness.ts";

/**
 * Bursts of visitor activity over 100 live sessions, with the CPU throttled, measured on
 * each page that reacts to them and across batching windows.
 *
 * The acceptance line (docs/roadmap.md, Phase 7): a 1,000-event burst in one second stays
 * smooth on every page that reacts to it (`expectSmooth` in harness.ts says what that
 * means in numbers).
 */
const SETTLE_MS = 1_000;

/**
 * One measured second of traffic. Events go out as many small requests, so the browser
 * receives one WebSocket frame per request: that is what batching exists for (a few
 * large requests would arrive already coalesced).
 *
 * A short unmeasured burst comes first. The first flush after a page load runs cold code
 * and is several times slower than the rest; it is real, but it would be the only thing
 * these numbers show.
 */
async function measureBurst(
  page: Page,
  request: APIRequestContext,
  sessionIds: string[],
  eventsPerSecond: number,
) {
  const cdp = await throttleCpu(page);
  await page.waitForTimeout(1_000); // idle-time chunk preloads finish
  await sendBurst(request, sessionIds, { total: 100, batches: 10, durationMs: 300 });
  await page.waitForTimeout(700);

  await startRecording(page);
  const before = await cpuTime(cdp);
  await sendBurst(request, sessionIds, {
    total: eventsPerSecond,
    batches: Math.min(200, eventsPerSecond),
    durationMs: 1_000,
  });
  await page.waitForTimeout(SETTLE_MS);
  const cpu = cpuDelta(before, await cpuTime(cdp));
  return { ...(await stopRecording(page)), ...cpu };
}

test.describe(`bursts over 100 sessions, ${CPU_THROTTLE}x CPU throttle`, () => {
  test("cold: the first burst right after page load (reported, not asserted)", async ({
    page,
    request,
  }) => {
    const sessions = await createSessions(request, 100);
    await page.goto(`${webUrl()}/sessions?status=active`);
    await expect(liveIndicator(page)).toBeVisible();
    await throttleCpu(page);

    await startRecording(page);
    await sendBurst(
      request,
      sessions.map((s) => s.id),
      { total: 1_000, batches: 200, durationMs: 1_000 },
    );
    await page.waitForTimeout(SETTLE_MS);

    report("sessions-list cold first burst 1000/s", { ...(await stopRecording(page)) });
  });

  for (const eventsPerSecond of [50, 200, 1_000]) {
    for (const batchMs of BATCH_VARIANTS) {
      test(`sessions list, ${eventsPerSecond} events/s, ${batchMs} ms window`, async ({
        page,
        request,
      }) => {
        const sessions = await createSessions(request, 100);
        await page.goto(`${webUrl(batchMs)}/sessions?status=active`);
        await expect(liveIndicator(page)).toBeVisible();

        const stats = await measureBurst(
          page,
          request,
          sessions.map((s) => s.id),
          eventsPerSecond,
        );

        report(`sessions-list rate=${eventsPerSecond}/s window=${batchMs}ms`, { ...stats });
        expect(stats.frames).toBeGreaterThan(60);
        if (batchMs === DEFAULT_BATCH_MS) expectSmooth(stats);
      });
    }
  }

  test("dashboard, 1000 events/s", async ({ page, request }) => {
    const sessions = await createSessions(request, 100);
    await page.goto(`${webUrl()}/dashboard`);
    await expect(liveIndicator(page)).toBeVisible();

    const stats = await measureBurst(
      page,
      request,
      sessions.map((s) => s.id),
      1_000,
    );

    report("dashboard rate=1000/s", { ...stats });
    expectSmooth(stats);
  });

  test("session page while 1000 events/s arrive across 100 sessions", async ({ page, request }) => {
    const sessions = await createSessions(request, 100);
    await page.goto(`${webUrl()}/sessions/${sessions[0]!.id}`);
    await expect(liveIndicator(page)).toBeVisible();

    const stats = await measureBurst(
      page,
      request,
      sessions.map((s) => s.id),
      1_000,
    );

    report("session-page rate=1000/s over 100 sessions", { ...stats });
    expectSmooth(stats);
  });

  test("stress: all 1000 events/s into the one open timeline", async ({ page, request }) => {
    const [session] = await createSessions(request, 1);
    const sessionId = session!.id;
    await page.goto(`${webUrl()}/sessions/${sessionId}`);
    await expect(liveIndicator(page)).toBeVisible();

    const stats = await measureBurst(page, request, [sessionId], 1_000);

    const timeline = page.getByRole("list", { name: "Session activity" });
    const rendered = await timeline.getByRole("listitem").count();
    const total = Number(await timeline.getByRole("listitem").last().getAttribute("aria-setsize"));
    report("stress session-page 1000/s into one timeline", {
      ...stats,
      rowsInDom: rendered,
      timelineEntries: total,
    });

    // The page views and clicks all show (plus "session started" and presence).
    expect(total).toBeGreaterThanOrEqual(1_100);
    expect(rendered).toBeLessThan(60);
    // No visitor produces 1,000 events a second: every flush replaces the whole visible
    // window. It still has to stay smooth.
    expectSmooth(stats);
  });
});
