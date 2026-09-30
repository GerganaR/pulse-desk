// @vitest-environment node
import {
  AI_FAULT_HEADER,
  type AIServiceRequest,
  type SessionDetailSnapshot,
} from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAIChat, type AIProxyDeps } from "./ai-proxy";
import type { SessionsSource } from "./data/sessions-source";

vi.mock("./log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorFields: () => ({}),
}));

const session = makeSession({ id: "ses_1" });
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

const sessions: SessionsSource = {
  getSnapshot: () => Promise.reject(new Error("unused")),
  getSessionDetail: (id) => Promise.resolve(id === "ses_1" ? detail : null),
};

const servers: http.Server[] = [];
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
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

interface Upstream {
  url: string;
  received: { body: AIServiceRequest; headers: http.IncomingHttpHeaders }[];
  closed: Promise<void>;
}

/** A stand-in ai-service that streams `lines` slowly and records what it was sent. */
async function fakeAIService(
  respond: (res: ServerResponse) => void = (res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write('{"type":"delta","text":"Hi"}\n');
    res.end('{"type":"done","finishReason":"stop","model":"mock"}\n');
  },
): Promise<Upstream> {
  const received: Upstream["received"] = [];
  let onClose: () => void = () => {};
  const closed = new Promise<void>((resolve) => (onClose = resolve));
  const url = await listen((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      received.push({ body: JSON.parse(raw) as AIServiceRequest, headers: req.headers });
      res.on("close", onClose);
      respond(res);
    });
  });
  return { url, received, closed };
}

async function proxy(deps: Partial<AIProxyDeps> & { aiServiceUrl: string }) {
  const url = await listen((req, res) => {
    void handleAIChat(req, res, { sessions, forwardFaults: false, ...deps });
  });
  return (body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });
}

const valid = { requestId: "req_12345678", sessionId: "ses_1", action: "summarize" };

describe("POST /api/ai/chat proxy", () => {
  it("builds the context server-side and streams the NDJSON through", async () => {
    const upstream = await fakeAIService();
    const post = await proxy({ aiServiceUrl: upstream.url });
    const response = await post({ ...valid, context: { injected: true } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await response.text()).toBe(
      '{"type":"delta","text":"Hi"}\n{"type":"done","finishReason":"stop","model":"mock"}\n',
    );
    const sent = upstream.received[0]!.body;
    expect(sent).toMatchObject({ requestId: "req_12345678", action: "summarize", prompt: "" });
    expect(sent.context.events).toEqual([
      { kind: "page_view", atMs: 1_000, path: "/pricing", title: "Pricing" },
    ]);
    expect(JSON.stringify(sent)).not.toContain("injected");
    expect(JSON.stringify(sent)).not.toContain(session.visitor.id);
  });

  it.each([
    ["an invalid request", valid, { requestId: "x" }, 400, "bad_request"],
    ["a question without text", valid, { action: "ask", prompt: "" }, 400, "bad_request"],
    ["an unknown session", valid, { sessionId: "ses_missing" }, 404, "session_not_found"],
  ])("rejects %s", async (_name, base, change, status, code) => {
    const upstream = await fakeAIService();
    const post = await proxy({ aiServiceUrl: upstream.url });
    const response = await post({ ...base, ...change });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(upstream.received).toHaveLength(0);
  });

  it("rejects cross-site and non-JSON requests", async () => {
    const upstream = await fakeAIService();
    const post = await proxy({ aiServiceUrl: upstream.url });
    expect((await post(valid, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await post(valid, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post("x".repeat(9_000))).status).toBe(413);
  });

  it("maps an upstream 500 to 502, keeping its error", async () => {
    const upstream = await fakeAIService((res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { code: "unavailable", message: "Injected", retryable: true } }),
      );
    });
    const post = await proxy({ aiServiceUrl: upstream.url });
    const response = await post(valid);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "unavailable", message: "Injected", retryable: true },
    });
  });

  it("answers 503 when ai-service is unreachable", async () => {
    const post = await proxy({ aiServiceUrl: "http://127.0.0.1:9" });
    const response = await post(valid);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
  });

  it("closes the upstream stream when the browser cancels", async () => {
    const upstream = await fakeAIService((res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write('{"type":"delta","text":"Hi"}\n'); // …and never ends
    });
    const post = await proxy({ aiServiceUrl: upstream.url });
    const controller = new AbortController();
    const response = await post(valid, {}, controller.signal);
    await response.body!.getReader().read();
    controller.abort();
    await expect(upstream.closed).resolves.toBeUndefined();
  });

  it("forwards the fault header only when allowed (devtools builds)", async () => {
    const upstream = await fakeAIService();
    const production = await proxy({ aiServiceUrl: upstream.url, forwardFaults: false });
    await (await production(valid, { [AI_FAULT_HEADER]: "http_500" })).text();
    const devtools = await proxy({ aiServiceUrl: upstream.url, forwardFaults: true });
    await (await devtools(valid, { [AI_FAULT_HEADER]: "http_500" })).text();
    await (await devtools(valid, { [AI_FAULT_HEADER]: "rm -rf" })).text();

    expect(upstream.received.map((r) => r.headers[AI_FAULT_HEADER])).toEqual([
      undefined,
      "http_500",
      undefined,
    ]);
  });
});
