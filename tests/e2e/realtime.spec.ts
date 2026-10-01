import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ingestPageViews } from "./gateway.ts";

const indicator = (page: Page) => page.locator("[data-status]:visible");

async function openActiveSession(page: Page) {
  await page.goto("/sessions?status=active");
  const href = await page.getByRole("table").getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/sessions\/ses_/);
  await page.goto(href!);
  return {
    timeline: page.getByRole("list", { name: "Session activity" }),
    sessionId: href!.split("/").at(-1)!,
  };
}

const sequencesOf = (timeline: ReturnType<Page["getByRole"]>) =>
  timeline
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => Number((item as HTMLElement).dataset.sequence)));

test.describe("Realtime", () => {
  test("connects after hydration and shows Live", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expect(indicator(page)).toContainText("Live");
  });

  test("a session's timeline grows live — in order, without duplicates", async ({
    page,
    request,
  }) => {
    const { timeline, sessionId } = await openActiveSession(page);
    await expect(timeline.getByRole("listitem").first()).toBeVisible();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    const initial = await sequencesOf(timeline);

    // New activity must arrive without a reload. The test records it itself: the
    // simulated visitor may have just finished their journey.
    const titles = await ingestPageViews(request, sessionId, 2);
    await expect(timeline.getByText(`Viewed ${titles[1]}`)).toBeVisible();

    const sequences = await sequencesOf(timeline);
    expect(sequences.length).toBeGreaterThanOrEqual(initial.length + 2);
    expect(Math.max(...sequences)).toBeGreaterThan(Math.max(...initial));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  test("shows the agent as a viewer (presence)", async ({ page }) => {
    await openActiveSession(page);
    await expect(page.getByRole("group", { name: /Viewing now: You/ })).toBeVisible();
  });

  test("new sessions appear on the dashboard without a reload", async ({ page }) => {
    await page.goto("/sessions");
    const total = async () => {
      const text = (await page.getByText(/Showing \d+ of \d+ sessions/).textContent()) ?? "";
      return Number(/of (\d+)/.exec(text)?.[1] ?? 0);
    };
    const before = await total();
    await expect.poll(total, { timeout: 30_000 }).toBeGreaterThan(before);
  });
});
