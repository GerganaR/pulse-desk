// @vitest-environment node
import type { SessionDetailSnapshot, SessionsSnapshot } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApiRequest } from "./api";
import type { SessionsSource } from "./data/sessions-source";
import { log } from "./log";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorFields: (error: unknown) => ({ error: String(error) }),
}));

const session = makeSession({ id: "ses_1" });
const snapshot: SessionsSnapshot = { streamId: "s", sequence: 4, sessions: [session] };
const detail: SessionDetailSnapshot = {
  streamId: "s",
  sequence: 4,
  session,
  events: [],
  truncated: false,
  viewers: [],
};

const servers: http.Server[] = [];
async function serve(sessions: SessionsSource) {
  const handled: boolean[] = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const result = handleApiRequest(req, res, pathname, {
      sessions,
      aiServiceUrl: "http://unused",
    });
    handled.push(result);
    if (!result) res.writeHead(418).end("not the API");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, handled };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

const working: SessionsSource = {
  getSnapshot: () => Promise.resolve(snapshot),
  getSessionDetail: (id) => Promise.resolve(id === "ses_1" ? detail : null),
};

describe("same-origin API", () => {
  it("leaves everything outside /api/ to the page handler", async () => {
    const { origin, handled } = await serve(working);
    expect((await fetch(`${origin}/sessions`)).status).toBe(418);
    expect(handled).toEqual([false]);
  });

  it("serves the sessions snapshot, never cached", async () => {
    const { origin } = await serve(working);
    const response = await fetch(`${origin}/api/sessions`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(snapshot);
  });

  it("serves a session's detail, decoding the id from the URL", async () => {
    const asked: string[] = [];
    const { origin } = await serve({
      ...working,
      getSessionDetail: (id) => {
        asked.push(id);
        return Promise.resolve(detail);
      },
    });
    expect((await fetch(`${origin}/api/sessions/ses%201`)).status).toBe(200);
    expect(asked).toEqual(["ses 1"]);
  });

  it("answers 404 for a session that doesn't exist", async () => {
    const { origin } = await serve(working);
    const response = await fetch(`${origin}/api/sessions/ses_gone`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });
  });

  it.each(["/api/sessions", "/api/sessions/ses_1"])(
    "answers 503 for %s when the gateway fails, without leaking why",
    async (path) => {
      const failure = new Error("connect ECONNREFUSED 10.0.0.7:4000");
      const { origin } = await serve({
        getSnapshot: () => Promise.reject(failure),
        getSessionDetail: () => Promise.reject(failure),
      });
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ error: "Session service unavailable" });
      expect(body).not.toContain("10.0.0.7");
      // The detail goes to the log instead.
      expect(log.error).toHaveBeenCalledWith(
        expect.stringMatching(/^api\.session/),
        expect.objectContaining({ error: expect.stringContaining("ECONNREFUSED") }),
      );
    },
  );

  it.each([
    ["an unknown path", "GET", "/api/nope"],
    ["a nested path under a session", "GET", "/api/sessions/ses_1/events"],
    ["a write to the sessions list", "POST", "/api/sessions"],
    ["a delete of a session", "DELETE", "/api/sessions/ses_1"],
    ["a read of the AI endpoint", "GET", "/api/ai/chat"],
  ])("answers 404 for %s", async (_, method, path) => {
    const { origin, handled } = await serve(working);
    const response = await fetch(`${origin}${path}`, { method });
    expect(response.status).toBe(404);
    expect(handled).toEqual([true]);
  });

  it("stops the upstream request when the browser goes away, and logs nothing", async () => {
    let upstream: AbortSignal | undefined;
    const { origin } = await serve({
      ...working,
      getSnapshot: (signal) =>
        new Promise((_, reject) => {
          upstream = signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const controller = new AbortController();
    const request = fetch(`${origin}/api/sessions`, { signal: controller.signal }).catch(() => {});
    await vi.waitFor(() => expect(upstream).toBeDefined());
    controller.abort();
    await request;
    await vi.waitFor(() => expect(upstream?.aborted).toBe(true));
    expect(log.error).not.toHaveBeenCalled();
  });
});
