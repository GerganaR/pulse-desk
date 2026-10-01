import type { CDPSession } from "@playwright/test";
import { CPU_THROTTLE, webUrl } from "./env.ts";
import {
  expect,
  expectSmooth,
  test,
  activity,
  cpuDelta,
  cpuTime,
  createSessions,
  ingest,
  liveIndicator,
  report,
  sendBurst,
  startRecording,
  stopRecording,
  throttleCpu,
} from "./harness.ts";

const EVENTS = 10_000;

/** Live JavaScript heap after a forced collection, in bytes. */
async function heapAfterGc(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
}

/**
 * One session watched while it accumulates 10,000 events: the DOM must stay the size of
 * a screenful, scrolling through all of it must stay smooth, and new events must still
 * cost a normal flush.
 */
test.describe(`10,000-event timeline, ${CPU_THROTTLE}x CPU throttle`, () => {
  test("stays a screenful of DOM, scrolls smoothly, and keeps up with new events", async ({
    page,
    request,
  }) => {
    const [session] = await createSessions(request, 1);
    const sessionId = session!.id;
    await page.goto(`${webUrl()}/sessions/${sessionId}`);
    await expect(liveIndicator(page)).toBeVisible();
    const cdp = await throttleCpu(page, 1); // measuring first; the throttle comes later
    const heapBefore = await heapAfterGc(cdp);

    // Fill the timeline live, 500 events at a time (the ingest limit per request).
    const filled = performance.now();
    for (let sent = 0; sent < EVENTS; sent += 500)
      await ingest(request, activity([sessionId], 500));
    const timeline = page.getByRole("list", { name: "Session activity" });
    const lastRow = timeline.getByRole("listitem").last();
    await expect
      .poll(async () => Number(await lastRow.getAttribute("aria-setsize")), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(EVENTS);
    const fillMs = performance.now() - filled;

    const heapAfter = await heapAfterGc(cdp);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    const rowsInDom = await timeline.getByRole("listitem").count();
    const domNodes = await page.evaluate(() => document.querySelectorAll("*").length);

    /** Scroll up by `distance` px over `frames` frames, then back down, one step a frame. */
    const scrollThere = (distance: number | "all", frames: number) =>
      page.evaluate(
        async ({ distance, frames }) => {
          const scroller = document.querySelector<HTMLElement>('[data-testid="timeline-scroll"]');
          if (!scroller) throw new Error("no timeline scroller");
          const bottom = scroller.scrollHeight - scroller.clientHeight;
          const span = distance === "all" ? bottom : distance;
          const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
          for (let step = 1; step <= frames; step++) {
            scroller.scrollTop = bottom - (span * step) / frames;
            await frame();
          }
          for (let step = frames - 1; step >= 0; step--) {
            scroller.scrollTop = bottom - (span * step) / frames;
            await frame();
          }
        },
        { distance, frames },
      );

    // Reading speed: about four screens a second (40 px a frame), up and back.
    await startRecording(page);
    const beforeScroll = await cpuTime(cdp);
    await scrollThere(4_800, 120);
    const scroll = await stopRecording(page);
    report("timeline-10000 scroll 4 screens/s", {
      ...scroll,
      ...cpuDelta(beforeScroll, await cpuTime(cdp)),
    });

    // Stress: the whole list in a second (dragging the scrollbar end to end). Every frame
    // replaces every row in the window.
    await startRecording(page);
    const beforeFling = await cpuTime(cdp);
    await scrollThere("all", 60);
    const fling = await stopRecording(page);
    report("stress timeline-10000 scroll all of it in 1 s", {
      ...fling,
      ...cpuDelta(beforeFling, await cpuTime(cdp)),
    });

    // Back at the bottom: 200 more events in a second.
    await expect(timeline.getByRole("listitem").last()).toHaveAttribute(
      "aria-posinset",
      String(await lastRow.getAttribute("aria-setsize")),
    );
    await startRecording(page);
    const beforeAppend = await cpuTime(cdp);
    await sendBurst(request, [sessionId], { total: 200, batches: 100, durationMs: 1_000 });
    await page.waitForTimeout(1_000);
    const append = await stopRecording(page);
    const appendCpu = cpuDelta(beforeAppend, await cpuTime(cdp));
    report("timeline-10000 append 200 events/s", { ...append, ...appendCpu });

    report("timeline-10000 size", {
      entries: Number(await lastRow.getAttribute("aria-setsize")),
      rowsInDom,
      domNodesInPage: domNodes,
      heapGrowthMb: (heapAfter - heapBefore) / 1024 / 1024,
      fillSeconds: fillMs / 1_000,
    });

    expect(rowsInDom).toBeLessThan(60);
    expectSmooth(scroll);
    expectSmooth(fling);
    expectSmooth(append);
    // Still following: the newest event is the last row.
    await expect(timeline.getByRole("listitem").last()).toHaveAttribute(
      "aria-posinset",
      String(await timeline.getByRole("listitem").last().getAttribute("aria-setsize")),
    );
  });
});
