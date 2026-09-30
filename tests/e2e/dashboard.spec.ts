import { expect, test } from "./fixtures.ts";

test.describe("Dashboard", () => {
  test("shows server-rendered live stats, activity and recent sessions", async ({ page }) => {
    await page.goto("/dashboard");

    const stats = page.locator("dl").first();
    await expect(stats.getByText("Active now")).toBeVisible();
    // Values come from SSR data, not a client fetch: no skeletons on first paint.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

    await expect(page.getByRole("group", { name: /Sessions started per 5 minutes/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where visitors are now" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible();
  });

  test("chart bars expose values to keyboard users", async ({ page }) => {
    await page.goto("/dashboard");
    const bars = page
      .getByRole("group", { name: /Sessions started per 5 minutes/ })
      .getByRole("button");
    await expect(bars).toHaveCount(12);

    await bars.last().focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(bars.nth(10)).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText(/sessions?/);
  });

  test("chart has an equivalent table view", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Table" }).click();
    const table = page.getByRole("table", { name: /Sessions started per 5 minutes/ });
    await expect(table.getByRole("row")).toHaveCount(13); // header + 12 buckets
    await page.getByRole("button", { name: "Chart" }).click();
    await expect(table).toHaveCount(0);
  });

  test("opens a session from the recent list", async ({ page }) => {
    await page.goto("/dashboard");
    // The list re-orders live: pin the exact session before clicking, or the locator
    // could re-resolve to a different row between reading and clicking.
    const firstLink = page.locator('a[href^="/sessions/ses_"]').first();
    const href = await firstLink.getAttribute("href");
    const pinned = page.locator(`a[href="${href}"]`).first();
    const name = await pinned.textContent();
    await pinned.click();

    await expect(page).toHaveURL(href!);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name ?? "");
    // Activity is the default panel at every width (below `xl` the others are tabs).
    await expect(page.getByRole("region", { name: "Live activity" })).toBeVisible();
  });
});

test.describe("Theme preference", () => {
  test("persists across reloads and is applied by the server (no flash)", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The server must render the attribute itself, before any JavaScript runs.
    const response = await page.request.get("/dashboard");
    expect(await response.text()).toContain('data-theme="dark"');

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
