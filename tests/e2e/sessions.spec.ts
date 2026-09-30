import { expect, test } from "./fixtures.ts";

test.describe("Sessions list", () => {
  test("filters by status and keeps the filter in the URL", async ({ page }) => {
    await page.goto("/sessions");
    const filters = page.getByRole("navigation", { name: "Filter by status" });
    await filters.getByRole("link", { name: /Idle/ }).click();

    await expect(page).toHaveURL(/status=idle/);
    const statusCells = page.getByRole("table").getByRole("row").locator("td:nth-child(2)");
    await expect(statusCells.first()).toHaveText("Idle");
    for (const text of await statusCells.allTextContents()) expect(text).toBe("Idle");

    // Reload renders the same filtered view on the server.
    await page.reload();
    await expect(filters.getByRole("link", { name: /Idle/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("search narrows results and offers a way back when nothing matches", async ({ page }) => {
    await page.goto("/sessions");
    await page.getByRole("searchbox", { name: "Search sessions" }).fill("zzz-no-such-visitor");
    await expect(page.getByText("No matching sessions")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole("table")).toBeVisible();
  });
});

test.describe("Session detail", () => {
  test.describe(() => {
    test.use({ allowedErrors: [/status of 404/] });

    test("unknown session ids return a real 404 with a helpful page", async ({ page }) => {
      const response = await page.goto("/sessions/ses_does_not_exist");
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { level: 1, name: "Session not found" }),
      ).toBeVisible();
    });
  });
});
