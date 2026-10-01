import { expect, type APIRequestContext } from "@playwright/test";
import { gatewayHttp } from "./env.ts";

let counter = 0;

/**
 * Record visitor activity for a session through the gateway's real ingest endpoint, the
 * way the simulator does. Tests that need "something happens now" use this instead of
 * waiting for the simulator: a simulated visitor may have just taken the last step of
 * their journey, and then nothing more arrives for minutes.
 *
 * Returns the page titles it used. They are unique per call, so a test can wait for
 * exactly its own events even when it (or another test) has used the session before.
 */
export async function ingestPageViews(
  request: APIRequestContext,
  sessionId: string,
  count: number,
): Promise<string[]> {
  const run = `${process.pid}-${Date.now().toString(36)}-${counter++}`;
  const titles = Array.from({ length: count }, (_, i) => `E2E ${run} #${i + 1}`);
  const events = titles.map((title) => ({
    type: "session.page_view",
    eventId: `e2e_${process.pid}_${Date.now()}_${counter++}`,
    sessionId,
    timestamp: Date.now(),
    payload: { path: "/e2e", title },
  }));
  const response = await request.post(`${gatewayHttp}/ingest`, { data: { events } });
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as { accepted: number; rejected: unknown[] };
  expect(result, "the gateway accepted the test's events").toMatchObject({
    accepted: titles.length,
    rejected: [],
  });
  return titles;
}
