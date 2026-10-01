import type { SessionsSnapshot } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, createHttpApi } from "./http-api";

const session = makeSession({ id: "ses_1" });
const snapshot: SessionsSnapshot = { streamId: "s", sequence: 4, sessions: [session] };
const detail = { streamId: "s", sequence: 4, session, events: [], truncated: false, viewers: [] };

function respondWith(body: unknown, status = 200) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(Response.json(body, { status })),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The API always takes the caller's abort signal; these tests never abort. */
const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("browser HTTP API", () => {
  it("loads the sessions snapshot from the same origin", async () => {
    const fetch = respondWith(snapshot);
    await expect(createHttpApi().fetchSessionsSnapshot(signal)).resolves.toEqual(snapshot);
    expect(fetch.mock.calls[0]![0]).toBe("/api/sessions");
  });

  it("passes the abort signal on, so a cancelled load stops the request", async () => {
    const fetch = respondWith(snapshot);
    await createHttpApi().fetchSessionsSnapshot(signal);
    expect(fetch.mock.calls[0]![1]?.signal).toBe(signal);
  });

  it("turns an error response into an HttpError that carries the status", async () => {
    respondWith({ error: "Session service unavailable" }, 503);
    const failure = await createHttpApi()
      .fetchSessionsSnapshot(signal)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ status: 503, message: "Couldn't load sessions (HTTP 503)" });
  });

  it.each([
    ["a list that isn't one", { ...snapshot, sessions: "none" }],
    [
      "a session with an unknown status",
      { ...snapshot, sessions: [{ ...session, status: "zombie" }] },
    ],
    ["an error page served with 200", { error: "oops" }],
  ])("rejects a malformed snapshot instead of storing it: %s", async (_, body) => {
    respondWith(body);
    await expect(createHttpApi().fetchSessionsSnapshot(signal)).rejects.toThrow(
      "Received malformed session data from the server",
    );
  });

  it("loads a session's detail, with the id encoded into the path", async () => {
    const fetch = respondWith(detail);
    await expect(createHttpApi().fetchSessionDetail("ses_1/../x", signal)).resolves.toMatchObject({
      session: { id: "ses_1" },
    });
    expect(fetch.mock.calls[0]![0]).toBe("/api/sessions/ses_1%2F..%2Fx");
  });

  it("answers null for a session that doesn't exist: that's a page state, not an error", async () => {
    respondWith({ error: "Session not found" }, 404);
    await expect(createHttpApi().fetchSessionDetail("ses_gone", signal)).resolves.toBeNull();
  });

  it("fails a detail request on any other error status", async () => {
    respondWith({}, 500);
    await expect(createHttpApi().fetchSessionDetail("ses_1", signal)).rejects.toMatchObject({
      status: 500,
      message: "Couldn't load session activity (HTTP 500)",
    });
  });

  it("rejects malformed session detail", async () => {
    respondWith({ ...detail, events: [{ type: "session.page_view" }] });
    await expect(createHttpApi().fetchSessionDetail("ses_1", signal)).rejects.toThrow(
      "Received malformed session data from the server",
    );
  });
});
