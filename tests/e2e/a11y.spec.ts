import { AxeBuilder } from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { devtoolsWebUrl, outageWebUrl } from "./env.ts";
import { expect, test } from "./fixtures.ts";
import { createSession, ingestPageViews } from "./gateway.ts";

/**
 * Automated accessibility scan (axe) of every page in every state a user can meet:
 * loaded, loading, failed, empty, reconnecting, and with each overlay open. Each state is
 * scanned in the light and the dark theme, because contrast is per theme.
 *
 * States are reached the way a user reaches them: a slow or failing request (intercepted
 * here), a gateway that is down (the `web-outage` server), or a fault from the
 * reliability panel (devtools build). axe finds what a machine can find (contrast, names,
 * roles, structure); it doesn't replace the screen-reader walkthrough in Phase 10.
 */

/** WCAG 2.2 A and AA, plus axe's best practices (landmarks, heading order, …). */
const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const indicator = (page: Page) => page.locator("[data-status]:visible");

async function scan(page: Page, state: string, scheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  // Colours fade between themes and on hover. Measured mid-fade, light text over a
  // background that hasn't changed yet reads as a contrast failure that isn't there.
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((transition) => transition.finished.catch(() => undefined)),
    );
  });
  const { violations } = await new AxeBuilder({ page }).withTags(RULES).analyze();
  const found = violations.map(
    ({ id, impact, help, nodes }) =>
      `${id} (${impact ?? "unknown"}): ${help}\n` +
      nodes.map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary}`).join("\n"),
  );
  // Soft: one run reports every state that fails, not only the first.
  expect.soft(found, `axe violations: ${state}, ${scheme} theme`).toEqual([]);
}

/** Scan what is on screen now, in both themes. */
async function expectAccessible(page: Page, state: string) {
  await scan(page, state, "light");
  await scan(page, state, "dark");
}

/** A session of the test's own, with a little activity. */
async function createActiveSession(request: APIRequestContext, pageViews = 4) {
  const id = await createSession(request, "a11y");
  await ingestPageViews(request, id, pageViews);
  return id;
}

/** True when the element has more content than fits, i.e. it really scrolls. */
const overflows = (locator: Locator) =>
  locator.evaluate((element) => element.scrollHeight > element.clientHeight + 1);

/**
 * Below `xl` the session page shows one panel at a time behind tabs. Returns the panel,
 * after switching to it if it's a tab at this width.
 */
async function showPanel(page: Page, name: "Details" | "Activity" | "Copilot") {
  const tab = page.getByRole("tab", { name });
  if (await tab.isVisible()) await tab.click();
}

test.beforeEach(async ({ page }) => {
  // Animations (skeleton pulse, toast fade-in) would make contrast depend on timing.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.describe("Accessibility: pages with live data", () => {
  test("dashboard, with the chart as a chart, a tooltip and a table", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expectAccessible(page, "dashboard");

    const chart = page.getByRole("group", { name: /Sessions started per 5 minutes/ });
    await chart.getByRole("button").last().focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expectAccessible(page, "dashboard, chart tooltip open");

    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.getByRole("table", { name: /Sessions started per 5 minutes/ })).toBeVisible();
    await expectAccessible(page, "dashboard, chart as a table");
  });

  test("account menu open", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeVisible();
    await expectAccessible(page, "account menu open");
  });

  test("sessions list: all, filtered, and nothing matching", async ({ page }) => {
    await page.goto("/sessions");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expectAccessible(page, "sessions list");

    await page
      .getByRole("navigation", { name: "Filter by status" })
      .getByRole("link", { name: /Active/ })
      .click();
    await expect(page).toHaveURL(/status=active/);
    await expectAccessible(page, "sessions list, filtered by status");

    await page.getByRole("searchbox", { name: "Search sessions" }).fill("zzz-no-such-visitor");
    await expect(page.getByText("No matching sessions")).toBeVisible();
    await expectAccessible(page, "sessions list, nothing matching");
  });

  test("session detail: details, activity and the copilot", async ({ page, request }) => {
    const sessionId = await createActiveSession(request);
    await page.goto(`/sessions/${sessionId}`);
    const timeline = page.getByRole("list", { name: "Session activity" });
    await expect(timeline.getByRole("listitem").first()).toBeVisible();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expectAccessible(page, "session detail, activity");

    await showPanel(page, "Details");
    await expectAccessible(page, "session detail, details");

    await showPanel(page, "Copilot");
    const copilot = page.getByRole("region", { name: "Copilot" });
    const quickActions = copilot.getByRole("group", { name: "Quick actions" });
    await expect(quickActions).toBeVisible();
    await expectAccessible(page, "session detail, copilot before any question");

    await quickActions.getByRole("button", { name: "Summarise" }).click();
    await expect(copilot.locator("[data-request-id]")).toHaveAttribute("data-ai-status", "done", {
      timeout: 20_000,
    });
    await expectAccessible(page, "session detail, copilot with an answer");
  });

  test("session detail with more than fits: scrolling regions work from the keyboard", async ({
    page,
    request,
  }) => {
    // A short timeline doesn't scroll, and a region that doesn't scroll passes whether or
    // not the keyboard can reach it. (Found when a laptop slept through a test run and
    // the timeline filled up with what it had missed.)
    const sessionId = await createActiveSession(request, 60);
    await page.goto(`/sessions/${sessionId}`);
    const timeline = page.getByTestId("timeline-scroll");
    await expect(timeline.getByRole("listitem").first()).toBeVisible();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    expect(await overflows(timeline), "the timeline scrolls").toBe(true);
    await expectAccessible(page, "session detail, long timeline");

    await timeline.focus();
    await expect(timeline).toBeFocused();
    const before = await timeline.evaluate((element) => element.scrollTop);
    await page.keyboard.press("Home");
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeLessThan(before);

    await showPanel(page, "Copilot");
    const copilot = page.getByRole("region", { name: "Copilot" });
    const quickActions = copilot.getByRole("group", { name: "Quick actions" });
    for (const name of ["Summarise", "Key events", "Suggest reply", "Unusual behaviour"])
      await quickActions.getByRole("button", { name }).click();
    const turns = copilot.locator("[data-request-id]");
    await expect(turns).toHaveCount(4);
    for (const turn of await turns.all())
      await expect(turn).toHaveAttribute("data-ai-status", "done", { timeout: 30_000 });
    const conversation = copilot.getByRole("group", { name: "Conversation" });
    expect(await overflows(conversation), "the conversation scrolls").toBe(true);
    await expectAccessible(page, "session detail, long copilot conversation");
  });

  test.describe(() => {
    // The browser logs the failed request itself; that's the state under test.
    test.use({ allowedErrors: [/status of (404|500)/] });

    test("session detail while earlier activity loads, and when it fails to load", async ({
      page,
      request,
    }) => {
      const sessionId = await createActiveSession(request);
      // The list page doesn't have the session's history, so opening it from there loads
      // it in the browser: held open for the loading state, then failed for the error one.
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(`**/api/sessions/${sessionId}`, async (route) => {
        await held;
        await route.fulfill({ status: 500, json: { error: "injected" } });
      });

      await page.goto(`/sessions?q=${sessionId}`);
      await page.locator(`a[href="/sessions/${sessionId}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
      const activity = page.getByRole("region", { name: "Live activity" });
      await expect(activity.locator('[aria-busy="true"]')).toBeVisible();
      await expectAccessible(page, "session detail, activity loading");

      release();
      await expect(activity.getByRole("alert")).toContainText("Couldn't load earlier activity");
      await expectAccessible(page, "session detail, activity failed to load");
    });
    test("not-found pages", async ({ page }) => {
      await page.goto("/definitely-not-a-page");
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
      await expectAccessible(page, "page not found");

      await page.goto("/sessions/ses_does_not_exist");
      await expect(
        page.getByRole("heading", { level: 1, name: "Session not found" }),
      ).toBeVisible();
      await expectAccessible(page, "session not found");
    });
  });
});

test.describe("Accessibility: a page that fails to load", () => {
  // The failed chunk request and the route boundary's own report.
  test.use({ allowedErrors: [/Failed to load resource|\[route\] failed to render|chunk/i] });

  test("a page chunk that can't be fetched leaves the shell and an explanation", async ({
    page,
  }) => {
    await page.route(/route-sessions[^/]*\.js$/, (route) => route.abort());
    await page.goto("/dashboard");
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Sessions" })
      .first()
      .click();
    await expect(page.getByRole("alert")).toContainText("This page couldn't be loaded");
    await expectAccessible(page, "page chunk failed to load");
  });
});

test.describe("Accessibility: gateway unreachable", () => {
  test.use({
    baseURL: outageWebUrl,
    // No gateway: the socket can't open, and the data endpoints answer 503.
    allowedErrors: [/WebSocket connection to|status of 503/],
  });

  const loadError = (page: Page) => page.getByRole("alert").filter({ hasText: "Couldn't load" });

  for (const [name, path] of [
    ["dashboard", "/dashboard"],
    ["sessions list", "/sessions"],
    ["session detail", "/sessions/ses_anything"],
  ] as const) {
    test(`${name}: error state while reconnecting`, async ({ page }) => {
      await page.goto(path);
      await expect(loadError(page)).toContainText("Couldn't load sessions");
      await expect(indicator(page)).toHaveAttribute("data-status", "reconnecting");
      await expectAccessible(page, `${name}, load failed, reconnecting`);
    });
  }

  test("sessions list while a retry is loading", async ({ page }) => {
    await page.goto("/sessions");
    await expect(loadError(page)).toBeVisible();
    // Hold the retry open: the page shows its skeleton for as long as it takes.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/sessions", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator('main [aria-busy="true"]')).toBeVisible();
    await expectAccessible(page, "sessions list, loading");
    release();
    await expect(loadError(page)).toBeVisible();
  });

  test("dashboard while a retry is loading", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(loadError(page)).toBeVisible();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/sessions", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
    await expectAccessible(page, "dashboard, loading");
    release();
    await expect(loadError(page)).toBeVisible();
  });

  test("a prolonged outage shows the banner", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/dashboard");
    const banner = page.getByTestId("outage-banner");
    await expect(banner).toContainText("Live updates paused", { timeout: 20_000 });
    await expectAccessible(page, "dashboard, prolonged outage banner");
  });
});

test.describe("Accessibility: faults from the reliability panel (devtools build)", () => {
  test.use({ baseURL: devtoolsWebUrl });

  async function openSession(page: Page, request: APIRequestContext) {
    const sessionId = await createActiveSession(request);
    await page.goto(`/sessions/${sessionId}`);
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
  }

  async function openPanel(page: Page): Promise<Locator> {
    await page.getByRole("button", { name: "Reliability" }).click();
    const panel = page.getByRole("dialog", { name: "Reliability panel" });
    await expect(panel).toBeVisible();
    return panel;
  }

  test("reconnecting, then catching up to live with a recovery notice", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await openSession(page, request);
    const panel = await openPanel(page);
    await expectAccessible(page, "reliability panel open, live");

    await panel.getByRole("button", { name: "Disconnect" }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "reconnecting");
    await expectAccessible(page, "session detail, reconnecting");

    // Long enough for the outage banner, so that recovery is announced with a toast.
    await expect(page.getByTestId("outage-banner")).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, "session detail, prolonged outage banner");

    await panel.getByRole("button", { name: "Reconnect" }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expect(
      page.getByRole("region", { name: "Notifications" }).getByText("Live updates restored"),
    ).toBeVisible();
    await expectAccessible(page, "session detail, recovery notice");
  });

  test("degraded connection", async ({ page, request }) => {
    await openSession(page, request);
    const panel = await openPanel(page);
    await panel.getByRole("group", { name: "Latency" }).getByText("1.5 s", { exact: true }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "degraded", { timeout: 10_000 });
    await expectAccessible(page, "session detail, degraded");
  });

  test("metrics view", async ({ page, request }) => {
    await openSession(page, request);
    const panel = await openPanel(page);
    await panel.getByRole("tab", { name: "Metrics" }).click();
    await expectAccessible(page, "reliability panel, metrics");
  });

  test.describe(() => {
    test.use({ allowedErrors: [/status of 502/] });

    test("copilot: a failed answer and an answer with an unverified claim", async ({
      page,
      request,
    }) => {
      await openSession(page, request);
      const setAIFault = async (fault: "Error 500" | "Ungrounded") => {
        const panel = await openPanel(page);
        await panel
          .getByRole("group", { name: "AI copilot" })
          .getByText(fault, { exact: true })
          .click();
        await panel.getByRole("button", { name: "Close" }).click();
        await expect(panel).toBeHidden();
      };
      await showPanel(page, "Copilot");
      const copilot = page.getByRole("region", { name: "Copilot" });
      const quickActions = copilot.getByRole("group", { name: "Quick actions" });
      const turns = copilot.locator("[data-request-id]");

      await setAIFault("Error 500");
      await quickActions.getByRole("button", { name: "Summarise" }).click();
      await expect(turns.first()).toHaveAttribute("data-ai-status", "failed");
      await expectAccessible(page, "copilot, answer failed");

      await setAIFault("Ungrounded");
      await quickActions.getByRole("button", { name: "Key events" }).click();
      await expect(turns.nth(1)).toHaveAttribute("data-ai-status", "done", { timeout: 20_000 });
      await expect(turns.nth(1).locator("[data-unverified-claims]")).toBeVisible();
      await expectAccessible(page, "copilot, unverified claim flagged");
    });
  });
});
