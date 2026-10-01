import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { gatewayHttp } from "./env.ts";
import { expect, test } from "./fixtures.ts";
import { ingestPageViews } from "./gateway.ts";

/**
 * A long timeline is virtualised: only the rows near the viewport exist in the DOM. These
 * tests use a session the test creates itself, with a known number of events, and check
 * what a reader would notice: the newest entry is in view, new entries appear in view,
 * and scrolling up to read is not interrupted.
 */
const HISTORY = 250;

const indicator = (page: Page) => page.locator("[data-status]:visible");

async function createLongSession(request: APIRequestContext) {
  const id = `ses_e2e_long_${process.pid}_${Date.now().toString(36)}`;
  const now = Date.now();
  const response = await request.post(`${gatewayHttp}/ingest`, {
    data: {
      events: [
        {
          type: "session.created",
          eventId: `${id}_created`,
          sessionId: id,
          timestamp: now,
          payload: {
            session: {
              id,
              visitor: {
                id: `vis_${id}`,
                label: "Visitor #4242",
                name: null,
                country: "BG",
                city: "Sofia",
              },
              device: "desktop",
              browser: "Chrome",
              os: "Linux",
              referrer: null,
              landingPath: "/pricing",
              currentPath: "/pricing",
              status: "active",
              startedAt: now - 60_000,
              lastActivityAt: now,
              endedAt: null,
              pageViews: 0,
              eventCount: 0,
            },
          },
        },
      ],
    },
  });
  expect(((await response.json()) as { accepted: number }).accepted).toBe(1);
  await ingestPageViews(request, id, HISTORY);
  return id;
}

const rows = (timeline: Locator) => timeline.getByRole("listitem");

/**
 * How much of a row is inside the timeline's own scroll area (0 to 1). Not Playwright's
 * `toBeInViewport`: that measures against the browser window, and on a short window the
 * bottom of the panel is below the fold even when the timeline is scrolled to its end.
 */
async function visibleInTimeline(row: Locator): Promise<number> {
  if ((await row.count()) === 0) return 0;
  return row.first().evaluate((element) => {
    const scroller = element.closest('[data-testid="timeline-scroll"]');
    if (!scroller) return 0;
    const box = element.getBoundingClientRect();
    const area = scroller.getBoundingClientRect();
    const visible = Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top);
    return Math.max(0, visible) / box.height;
  });
}

/** Whether the last rendered row is the last entry of the whole timeline. */
async function isAtNewest(timeline: Locator) {
  const last = rows(timeline).last();
  const position = await last.getAttribute("aria-posinset");
  return position !== null && position === (await last.getAttribute("aria-setsize"));
}

test.describe("Long timeline (virtualised)", () => {
  test("shows the newest entries, keeps the DOM small, and follows new events", async ({
    page,
    request,
  }) => {
    const sessionId = await createLongSession(request);
    await page.goto(`/sessions/${sessionId}`);
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    const timeline = page.getByRole("list", { name: "Session activity" });

    await expect(timeline).toHaveAttribute("data-virtual", "true");
    await expect
      .poll(async () => Number(await rows(timeline).last().getAttribute("aria-setsize")))
      .toBeGreaterThanOrEqual(HISTORY);
    expect(await rows(timeline).count()).toBeLessThan(60);
    // Following the live edge: the last row is the newest entry, and it is on screen.
    // (Polled: the agent's own "started viewing" entry may still be arriving.)
    await expect.poll(() => isAtNewest(timeline)).toBe(true);
    await expect.poll(() => visibleInTimeline(rows(timeline).last())).toBeGreaterThan(0.99);

    const [, second] = await ingestPageViews(request, sessionId, 2);
    const arrived = timeline.getByRole("listitem").filter({ hasText: `Viewed ${second}` });
    // In view, not merely in the DOM: a row that animates in must end up in its place.
    await expect.poll(() => visibleInTimeline(arrived)).toBeGreaterThan(0.99);
    await page.waitForTimeout(400); // the fade-in (160 ms) has finished
    expect(await visibleInTimeline(arrived)).toBeGreaterThan(0.99);
    await expect(rows(timeline).last()).toContainText(`Viewed ${second}`);
  });

  test("scrolling up is not interrupted; a button counts what arrived and leads back", async ({
    page,
    request,
  }) => {
    const sessionId = await createLongSession(request);
    await page.goto(`/sessions/${sessionId}`);
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    const timeline = page.getByRole("list", { name: "Session activity" });
    await expect.poll(() => isAtNewest(timeline)).toBe(true);
    const scroller = page.getByTestId("timeline-scroll");

    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });
    // The list re-renders for the new position: wait until the rows are the middle ones.
    await expect.poll(() => isAtNewest(timeline)).toBe(false);
    const readingSequence = await timeline.evaluate((list) => {
      const area = list.closest('[data-testid="timeline-scroll"]')?.getBoundingClientRect();
      const inView = [...list.querySelectorAll("li")].filter((row) => {
        const box = row.getBoundingClientRect();
        return area !== undefined && box.top >= area.top && box.bottom <= area.bottom;
      });
      return inView[Math.floor(inView.length / 2)]?.dataset.sequence;
    });
    expect(readingSequence).toBeDefined();
    const reading = timeline.locator(`li[data-sequence="${readingSequence}"]`);
    const positionBefore = await scroller.evaluate((element) => element.scrollTop);

    const titles = await ingestPageViews(request, sessionId, 3);
    const button = page.getByRole("button", { name: "3 new events" });
    await expect(button).toBeVisible();

    // The reader's place didn't move, and the new rows aren't rendered up here.
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(positionBefore);
    expect(await visibleInTimeline(reading)).toBeGreaterThan(0.99);
    await expect(timeline.getByText(`Viewed ${titles[2]}`)).toHaveCount(0);

    await button.click();

    const newest = timeline.getByRole("listitem").filter({ hasText: `Viewed ${titles[2]}` });
    await expect.poll(() => visibleInTimeline(newest)).toBeGreaterThan(0.99);
    await expect(button).toBeHidden();
  });
});
