import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { aiServiceHttp, devtoolsWebUrl, gatewayHttp } from "./env.ts";
import { expect, test } from "./fixtures.ts";
import { createSession, ingestPageViews } from "./gateway.ts";

/**
 * AI copilot, end to end: browser → web server (/api/ai/chat) → ai-service (mock provider)
 * and back as a stream. Faults are requested through the reliability panel (devtools
 * build) and enacted by the real ai-service.
 *
 * Streaming states are transient, so progress is recorded in the page as it happens and
 * asserted afterwards. The same goes for the connection: every status the indicator takes
 * is recorded, and the WebSocket must stay Live throughout.
 */

const indicator = (page: Page) => page.locator("[data-status]:visible");

/**
 * Opens a session of the test's own, with a little activity. Not one of the simulator's
 * or another spec's: what the copilot says depends on the session (one created a moment
 * ago has no events to list, and a long one gets "the 10 most recent" instead of "in
 * order"), so borrowing whichever session happened to be active made answers vary by run.
 */
async function openActiveSession(page: Page, request: APIRequestContext) {
  const sessionId = await createSession(request, "copilot");
  await ingestPageViews(request, sessionId, 3);
  const href = `/sessions/${sessionId}`;
  await page.goto(href);
  await expect(indicator(page)).toHaveAttribute("data-status", "live");
  await recordConnectionStatuses(page);

  // Below the `xl` breakpoint the panels are tabs.
  const tab = page.getByRole("tab", { name: "Copilot" });
  if (await tab.isVisible()) await tab.click();
  const copilot = page.getByRole("region", { name: "Copilot" });
  await expect(copilot.getByRole("group", { name: "Quick actions" })).toBeVisible();
  return { copilot, sessionId };
}

/** Records every connection status other than Live from now on. */
async function recordConnectionStatuses(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __statuses: string[] }).__statuses = seen;
    new MutationObserver(() => {
      for (const el of document.querySelectorAll("[data-status]")) {
        const status = el.getAttribute("data-status");
        if (status && status !== "live") seen.push(status);
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-status"],
    });
  });
}

async function expectConnectionStayedLive(page: Page) {
  await expect(indicator(page)).toHaveAttribute("data-status", "live");
  const statuses = await page.evaluate(
    () => (window as unknown as { __statuses: string[] }).__statuses,
  );
  expect(statuses, "the WebSocket never left Live").toEqual([]);
}

/** Records the length of each answer's text every time it changes while streaming. */
async function recordAnswerProgress(copilot: Locator) {
  await copilot.evaluate((root) => {
    const progress: Record<string, number[]> = {};
    (window as unknown as { __progress: typeof progress }).__progress = progress;
    new MutationObserver(() => {
      for (const turn of root.querySelectorAll<HTMLElement>("[data-request-id]")) {
        if (turn.dataset.aiStatus !== "streaming") continue;
        const length = turn.querySelector("[data-answer]")?.textContent?.length ?? 0;
        const lengths = (progress[turn.dataset.requestId!] ??= []);
        if (lengths.at(-1) !== length) lengths.push(length);
      }
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

const answerOf = (turn: Locator) => turn.locator("[data-answer]");
const quickAction = (copilot: Locator, name: string) =>
  copilot.getByRole("group", { name: "Quick actions" }).getByRole("button", { name });

test.describe("AI copilot", () => {
  test("streams answers progressively, several at once, while the connection stays live", async ({
    page,
    request,
  }) => {
    const { copilot, sessionId } = await openActiveSession(page, request);
    await recordAnswerProgress(copilot);

    await quickAction(copilot, "Summarise").click();
    await quickAction(copilot, "Key events").click();
    const turns = copilot.getByRole("listitem");
    await expect(turns).toHaveCount(2);
    for (const turn of await turns.all())
      await expect(turn).toHaveAttribute("data-ai-status", "done", { timeout: 20_000 });

    // Rendered progressively: each answer was seen at several lengths before it ended.
    const progress = await page.evaluate(
      () => (window as unknown as { __progress: Record<string, number[]> }).__progress,
    );
    for (const turn of await turns.all()) {
      const id = (await turn.getAttribute("data-request-id"))!;
      expect(progress[id]?.length ?? 0, `partial renders of ${id}`).toBeGreaterThanOrEqual(3);
    }

    // Grounded in this session's own data.
    const response = await request.get(`${gatewayHttp}/sessions/${sessionId}`);
    const { session } = (await response.json()) as { session: { landingPath: string } };
    const summary = turns.first();
    await expect(answerOf(summary)).toContainText(session.landingPath);
    await expect(summary).toContainText(/mock · [\d.]+ (ms|s)/);
    await expect(turns.nth(1)).toContainText("Key events, in order:");

    await expectConnectionStayedLive(page);
  });

  test("the production build ignores fault requests", async ({ request }) => {
    const sessions = (await (await request.get(`${gatewayHttp}/sessions`)).json()) as {
      sessions: { id: string }[];
    };
    const response = await request.post("/api/ai/chat", {
      headers: { "x-pulsedesk-ai-fault": "http_500" },
      data: {
        requestId: "req_prod_fault_1",
        sessionId: sessions.sessions[0]!.id,
        action: "summarize",
      },
    });
    expect(response.status()).toBe(200);
    expect((await response.text()).trim().split("\n").at(-1)).toContain('"type":"done"');
  });

  test("unknown sessions are rejected before any AI call", async ({ request }) => {
    const response = await request.post("/api/ai/chat", {
      data: { requestId: "req_unknown_1", sessionId: "ses_nope", action: "summarize" },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "session_not_found" } });
  });
});

test.describe("AI copilot failures (devtools build)", () => {
  test.use({ baseURL: devtoolsWebUrl });

  async function setAIFault(
    page: Page,
    fault: "Off" | "Timeout" | "Error 500" | "Slow" | "Ungrounded",
  ) {
    await page.getByRole("button", { name: "Reliability" }).click();
    const panel = page.getByRole("dialog", { name: "Reliability panel" });
    await panel
      .getByRole("group", { name: "AI copilot" })
      .getByText(fault, { exact: true })
      .click();
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toBeHidden();
  }

  test("cancel mid-stream keeps the partial answer and stops the model", async ({
    page,
    request,
  }) => {
    const { copilot } = await openActiveSession(page, request);
    await setAIFault(page, "Slow");

    await quickAction(copilot, "Summarise").click();
    const turn = copilot.getByRole("listitem").first();
    await expect(answerOf(turn)).toHaveText(/^\S+ \S+ \S+/); // a few words in
    await turn.getByRole("button", { name: "Cancel" }).click();

    await expect(turn).toHaveAttribute("data-ai-status", "cancelled");
    await expect(turn).toContainText("Cancelled. The partial answer is kept above.");
    const partial = await answerOf(turn).textContent();
    expect(partial!.length).toBeGreaterThan(0);

    // Cancellation reached the provider: ai-service recorded the stream as aborted.
    const requestId = await turn.getAttribute("data-request-id");
    await expect
      .poll(async () => {
        const outcome = await request.get(`${aiServiceHttp}/debug/requests/${requestId}`);
        return ((await outcome.json()) as { outcome?: string }).outcome;
      })
      .toBe("aborted");
    await expect(answerOf(turn)).toHaveText(partial!); // nothing more arrives

    await expectConnectionStayedLive(page);
  });

  test.describe(() => {
    // The browser logs the failed request itself; that's the expected outcome here.
    test.use({ allowedErrors: [/status of 502/] });

    test("a 500 shows the error state, and retry succeeds once the fault is cleared", async ({
      page,
      request,
    }) => {
      const { copilot } = await openActiveSession(page, request);
      await setAIFault(page, "Error 500");

      await quickAction(copilot, "What's blocking?").click();
      const turn = copilot.getByRole("listitem").first();
      await expect(turn).toHaveAttribute("data-ai-status", "failed");
      await expect(turn).toContainText("The AI service failed (injected fault).");

      await setAIFault(page, "Off");
      await turn.getByRole("button", { name: "Retry" }).click();
      const retried = copilot.getByRole("listitem");
      await expect(retried).toHaveCount(1); // the retry replaces the failed attempt
      await expect(retried).toHaveAttribute("data-ai-status", "done", { timeout: 20_000 });
      await expect(retried).toContainText("attempt 2");

      await expectConnectionStayedLive(page);
    });
  });

  test("the grounding guard flags an invented claim, and not a grounded answer", async ({
    page,
    request,
  }) => {
    const { copilot } = await openActiveSession(page, request);

    // The mock's own answer about this live session passes the guard.
    await quickAction(copilot, "Summarise").click();
    const turns = copilot.locator("[data-request-id]"); // flagged claims are list items too
    const grounded = turns.first();
    await expect(grounded).toHaveAttribute("data-ai-status", "done", { timeout: 20_000 });
    await expect(grounded.locator("[data-unverified-claims]")).toHaveCount(0);

    // With the fault, the model appends a claim this session doesn't support.
    await setAIFault(page, "Ungrounded");
    await quickAction(copilot, "Summarise").click();
    const invented = turns.nth(1);
    await expect(invented).toHaveAttribute("data-ai-status", "done", { timeout: 20_000 });
    const claim =
      /The visitor (completed the payment for the Pro plan|also signed up for a free trial|also submitted the newsletter form successfully)/;
    await expect(answerOf(invented)).toContainText(claim);
    const flag = invented.locator("[data-unverified-claims]");
    await expect(flag).toHaveAttribute("data-unverified-claims", "1");
    await expect(flag).toContainText("Couldn't verify against this session's events:");
    await expect(flag).toContainText(claim);
    await expect(copilot.getByRole("status")).toHaveText(
      "Answer ready. 1 claim couldn't be verified against the session.",
    );

    await expectConnectionStayedLive(page);
  });

  test("a model that never answers times out with an explanation", async ({ page, request }) => {
    const { copilot } = await openActiveSession(page, request);
    await setAIFault(page, "Timeout");

    await quickAction(copilot, "Suggest reply").click();
    const turn = copilot.getByRole("listitem").first();
    await expect(turn).toHaveAttribute("data-ai-status", "failed", { timeout: 15_000 });
    await expect(turn).toContainText("The AI model didn't start answering in time.");
    await expect(turn.getByRole("button", { name: "Retry" })).toBeVisible();

    await expectConnectionStayedLive(page);
  });
});
