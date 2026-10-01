// @vitest-environment node
import type { SessionDetailSnapshot, SessionsSnapshot } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import { describe, expect, it } from "vitest";
import type { SessionsSource } from "./data/sessions-source";
import { prefetchForRequest } from "./prefetch";

const session = makeSession({ id: "ses_1" });
const snapshot: SessionsSnapshot = { streamId: "s", sequence: 10, sessions: [session] };
const detail: SessionDetailSnapshot = {
  streamId: "s",
  sequence: 10,
  session,
  events: [
    {
      type: "session.page_view",
      eventId: "evt_1",
      sequence: 9,
      sessionId: "ses_1",
      timestamp: session.startedAt + 1_000,
      payload: { path: "/pricing", title: "Pricing" },
    },
  ],
  truncated: false,
  viewers: [],
};

const ready: SessionsSource = {
  getSnapshot: () => Promise.resolve(snapshot),
  getSessionDetail: (id) => Promise.resolve(id === "ses_1" ? detail : null),
};

/** Never answers; records whether the request was told to stop. */
function hanging() {
  const signals: AbortSignal[] = [];
  const wait = (signal?: AbortSignal) =>
    new Promise<never>((_, reject) => {
      if (signal) {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason as Error));
      }
    });
  const source: SessionsSource = {
    getSnapshot: wait,
    getSessionDetail: (_id, signal) => wait(signal),
  };
  return { source, signals };
}

describe("SSR data prefetch", () => {
  it("loads the sessions list into a fresh store within the budget", async () => {
    const { store, completed } = await prefetchForRequest(ready, 1_000);
    expect(completed).toBe(true);
    expect(store.getState().sessions).toMatchObject({ status: "ready", ids: ["ses_1"] });
    expect(store.getState().timelines.bySession).toEqual({});
  });

  it("also loads the session's history on a session page", async () => {
    const { store, completed } = await prefetchForRequest(ready, 1_000, { sessionId: "ses_1" });
    expect(completed).toBe(true);
    expect(store.getState().timelines.bySession.ses_1).toMatchObject({ history: "ready" });
    expect(store.getState().timelines.bySession.ses_1?.events).toHaveLength(1);
  });

  it("marks an unknown session as missing, which the server turns into a 404", async () => {
    const { store, completed } = await prefetchForRequest(ready, 1_000, { sessionId: "ses_no" });
    expect(completed).toBe(true);
    expect(store.getState().timelines.bySession.ses_no?.history).toBe("missing");
  });

  it("gives up at the budget: requests are aborted and the page loads in the browser", async () => {
    const { source, signals } = hanging();
    const startedAt = performance.now();
    const { store, completed } = await prefetchForRequest(source, 30, { sessionId: "ses_1" });

    expect(completed).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(signals).toHaveLength(2);
    for (const signal of signals) expect(signal.aborted).toBe(true);
    // Idle, not error: the client fetches after hydration and shows skeletons meanwhile.
    expect(store.getState().sessions).toMatchObject({ status: "idle", error: null });
    expect(store.getState().timelines.bySession.ses_1?.history).toBe("idle");
  });

  it("keeps a failure in the state, so the page renders its error UI", async () => {
    const failing: SessionsSource = {
      getSnapshot: () => Promise.reject(new Error("Realtime gateway is unreachable")),
      getSessionDetail: () => Promise.reject(new Error("Realtime gateway is unreachable")),
    };
    const { store, completed } = await prefetchForRequest(failing, 1_000, { sessionId: "ses_1" });
    expect(completed).toBe(true);
    expect(store.getState().sessions.status).toBe("error");
    expect(store.getState().sessions.error).toEqual(expect.any(String));
    expect(store.getState().timelines.bySession.ses_1?.history).toBe("error");
  });

  it("gives every request its own store", async () => {
    const first = await prefetchForRequest(ready, 1_000);
    const second = await prefetchForRequest(ready, 1_000);
    expect(first.store).not.toBe(second.store);
  });
});
