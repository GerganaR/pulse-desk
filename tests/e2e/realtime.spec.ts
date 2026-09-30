import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const indicator = (page: Page) => page.locator("[data-status]:visible");

async function openActiveSession(page: Page) {
  await page.goto("/sessions?status=active");
  const href = await page.getByRole("table").getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/sessions\/ses_/);
  await page.goto(href!);
  return page.getByRole("list", { name: "Session activity" });
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

  test("a session's timeline grows live — in order, without duplicates", async ({ page }) => {
    const timeline = await openActiveSession(page);
    await expect(timeline.getByRole("listitem").first()).toBeVisible();
    const initial = (await sequencesOf(timeline)).length;

    // The simulator keeps this visitor busy; new events must arrive without a reload.
    await expect
      .poll(async () => (await sequencesOf(timeline)).length, { timeout: 20_000 })
      .toBeGreaterThan(initial);

    const sequences = await sequencesOf(timeline);
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
