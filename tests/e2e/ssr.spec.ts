import { expect, test } from "./fixtures.ts";

test.describe("SSR and hydration", () => {
  test("serves fully rendered HTML before any JavaScript runs", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const response = await page.goto("/dashboard");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Dashboard · PulseDesk");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await context.close();
  });

  test("hydrates and navigates client-side without a full reload", async ({ page }) => {
    await page.goto("/dashboard");
    // Marker survives only if navigation is handled by the client router.
    await page.evaluate(() => {
      (window as unknown as { __marker: boolean }).__marker = true;
    });

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Sessions" })
      .first()
      .click();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
    await expect(page).toHaveTitle("Sessions · PulseDesk");
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(
      true,
    );
  });

  test("redirects / to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test.describe(() => {
    // The browser logs the document's own 404 status; that's the behaviour under test.
    test.use({ allowedErrors: [/status of 404/] });

    test("returns 404 with a helpful page for unknown routes", async ({ page }) => {
      const response = await page.goto("/definitely-not-a-page");
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
      await page.getByRole("link", { name: "Go to dashboard" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  });
});
