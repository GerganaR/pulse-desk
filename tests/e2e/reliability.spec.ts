import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { devtoolsWebUrl, gatewayHttp } from "./env.ts";
import { expect, test } from "./fixtures.ts";

/**
 * Reliability, end to end: faults are injected through the dev reliability panel into
 * the real connection (devtools build), and the timeline is checked against the
 * gateway's own record of the session. Assertions are on sequence numbers in the DOM,
 * never on timing.
 */
test.use({ baseURL: devtoolsWebUrl });

interface GatewayEvent {
  sequence: number;
  type: string;
  payload: { isTyping?: boolean };
}

const indicator = (page: Page) => page.locator("[data-status]:visible");

/** What the gateway says happened in the session, limited to events the timeline shows. */
async function gatewaySequences(request: APIRequestContext, sessionId: string) {
  const response = await request.get(`${gatewayHttp}/sessions/${sessionId}`);
  expect(response.ok()).toBe(true);
  const { events } = (await response.json()) as { events: GatewayEvent[] };
  return events
    .filter((e) => !(e.type === "session.typing" && e.payload.isTyping === false))
    .map((e) => e.sequence);
}

const sequencesOf = (timeline: Locator) =>
  timeline
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => Number((item as HTMLElement).dataset.sequence)));

async function openActiveSession(page: Page) {
  await page.goto("/sessions?status=active");
  const href = await page.getByRole("table").getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/sessions\/ses_/);
  await page.goto(href!);
  const timeline = page.getByRole("list", { name: "Session activity" });
  await expect(timeline.getByRole("listitem").first()).toBeVisible();
  await expect(indicator(page)).toHaveAttribute("data-status", "live");
  return { timeline, sessionId: href!.split("/").at(-1)! };
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Reliability" }).click();
  const panel = page.getByRole("dialog", { name: "Reliability panel" });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The timeline shows every event the gateway has for the session (from where the
 * timeline starts), exactly once and in order, and nothing the gateway doesn't have.
 */
async function expectTimelineMatchesGateway(
  request: APIRequestContext,
  timeline: Locator,
  sessionId: string,
) {
  let shown: number[] = [];
  await expect
    .poll(
      async () => {
        shown = await sequencesOf(timeline);
        const expected = (await gatewaySequences(request, sessionId)).filter(
          (s) => s >= shown[0]! && s <= shown.at(-1)!,
        );
        return shown.filter((s) => expected.includes(s)).length === expected.length &&
          shown.length === expected.length
          ? "match"
          : { shown, expected };
      },
      { timeout: 15_000 },
    )
    .toBe("match");
  expect(new Set(shown).size, "no duplicates").toBe(shown.length);
  expect(shown, "in sequence order").toEqual([...shown].sort((a, b) => a - b));
}

test.describe("Reliability", () => {
  test("missed events appear exactly once and in order after a disconnect", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { timeline, sessionId } = await openActiveSession(page);
    const panel = await openPanel(page);

    await panel.getByRole("button", { name: "Disconnect" }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "reconnecting");
    const beforeDisconnect = await sequencesOf(timeline);
    const lastSeen = Math.max(...beforeDisconnect);

    // The simulator keeps this visitor busy; wait until the gateway has recorded
    // activity for the session that this tab has not seen.
    await expect
      .poll(async () => (await gatewaySequences(request, sessionId)).filter((s) => s > lastSeen), {
        timeout: 30_000,
      })
      .not.toHaveLength(0);
    const missed = (await gatewaySequences(request, sessionId)).filter((s) => s > lastSeen);
    expect(await sequencesOf(timeline), "nothing arrives while disconnected").toEqual(
      beforeDisconnect,
    );

    await panel.getByRole("button", { name: "Reconnect" }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");

    // Every missed event is now in the timeline, marked as replayed.
    await expect
      .poll(async () => (await sequencesOf(timeline)).filter((s) => missed.includes(s)))
      .toEqual(missed);
    for (const sequence of missed)
      await expect(timeline.locator(`li[data-sequence="${sequence}"]`)).toHaveAttribute(
        "data-replayed",
        "true",
      );
    await expectTimelineMatchesGateway(request, timeline, sessionId);
  });

  test("a prolonged outage shows the banner, then a single recovery notice", async ({ page }) => {
    test.setTimeout(60_000);
    await openActiveSession(page);
    const panel = await openPanel(page);
    await panel.getByRole("button", { name: "Disconnect" }).click();

    const banner = page.getByTestId("outage-banner");
    await expect(banner).toBeHidden();
    await expect(banner).toContainText("Live updates paused", { timeout: 15_000 });

    await banner.getByRole("button", { name: /Retry now/ }).click(); // still cut: retry fails
    await expect(indicator(page)).toHaveAttribute("data-status", "reconnecting");

    await panel.getByRole("button", { name: "Reconnect" }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expect(banner).toBeHidden();
    const notifications = page.getByRole("region", { name: "Notifications" });
    await expect(notifications.getByText("Live updates restored")).toHaveCount(1);
  });

  test("dropped, duplicated and reordered events leave the timeline correct", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { timeline, sessionId } = await openActiveSession(page);
    const panel = await openPanel(page);
    const stat = (label: string) =>
      panel.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");

    // Drop: a gap, detected and filled by a resync on the same connection.
    await panel.getByRole("spinbutton", { name: "Events to drop" }).fill("3");
    await panel.getByRole("button", { name: "Drop" }).click();
    // (The "armed" badge can be consumed before we look; the fault log persists.)
    await expect(
      panel
        .getByRole("log")
        .getByText(/^Dropped \d+ events?/)
        .first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(panel.getByText(/armed/)).toBeHidden({ timeout: 20_000 });
    await expect(stat("Gaps / resyncs")).toHaveText(/^[1-9]\d* \/ [1-9]/, { timeout: 15_000 });
    await expect(stat("Reorder buffer")).toHaveText("0");
    await expect(stat("Reconnect attempts")).toHaveText("0");

    // Duplicate: dropped by the client.
    await panel.getByRole("button", { name: "Duplicate" }).click();
    await expect(panel.getByText(/armed/)).toBeHidden({ timeout: 20_000 });
    await expect(stat("Duplicates dropped")).not.toHaveText("0");

    // Reorder: held in the reorder buffer, then released in order.
    await panel.getByRole("button", { name: "Reorder" }).click();
    await expect(panel.getByText(/armed/)).toBeHidden({ timeout: 20_000 });
    await expect(stat("Reorder buffer")).toHaveText("0", { timeout: 5_000 });

    await expect(indicator(page)).toHaveAttribute("data-status", "live");
    await expectTimelineMatchesGateway(request, timeline, sessionId);
  });

  test("added latency shows Degraded, and removing it recovers", async ({ page }) => {
    await openActiveSession(page);
    const panel = await openPanel(page);
    const latency = panel.getByRole("group", { name: "Latency" });
    await latency.getByText("1.5 s", { exact: true }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "degraded", { timeout: 10_000 });
    await latency.getByText("Off", { exact: true }).click();
    await expect(indicator(page)).toHaveAttribute("data-status", "live", { timeout: 10_000 });
  });
});
