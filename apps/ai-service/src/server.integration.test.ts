import { AIChunkSchema, AI_FAULT_HEADER, type AIChunk } from "@pulsedesk/contracts";
import { createLogger, createMemorySink } from "@pulsedesk/observability";
import { afterEach, describe, expect, it } from "vitest";
import type { AIServiceConfig } from "./config.ts";
import { createAIService, type AIService } from "./server.ts";
import { makeRequest, scriptedProvider } from "./test/fixtures.ts";

const baseConfig: AIServiceConfig = {
  host: "127.0.0.1",
  port: 0,
  provider: { kind: "mock", tokenMs: 1, firstTokenDelayMs: 1 },
  firstTokenTimeoutMs: 300,
  totalTimeoutMs: 5_000,
  maxConcurrentStreams: 10,
  maxBodyBytes: 256 * 1024,
  debug: false,
  slowTokenMs: 20,
};

const logger = createLogger({ sink: { write: () => {} } });
let service: AIService | null = null;

async function start(
  overrides: Partial<AIServiceConfig> = {},
  provider?: Parameters<typeof createAIService>[0]["provider"],
) {
  const metrics = createMemorySink();
  service = createAIService({
    config: { ...baseConfig, ...overrides },
    logger,
    provider,
    metricSink: metrics,
  });
  const port = await service.listen(0, "127.0.0.1");
  return { url: `http://127.0.0.1:${port}`, metrics, service };
}

afterEach(async () => {
  await service?.close();
  service = null;
});

function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return fetch(`${url}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

async function readChunks(response: Response): Promise<AIChunk[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => AIChunkSchema.parse(JSON.parse(line)));
}

describe("ai-service HTTP", () => {
  it("streams an NDJSON answer that ends with done", async () => {
    const { url, metrics } = await start();
    const response = await post(url, makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const chunks = await readChunks(response);
    expect(chunks.at(-1)).toEqual({
      type: "done",
      finishReason: "stop",
      model: "mock",
      unverified: [],
    });
    expect(chunks.filter((c) => c.type === "delta").length).toBeGreaterThan(10);
    expect(metrics.get("ai.request.first_token")?.count).toBe(1);
  });

  it("rejects invalid requests before streaming", async () => {
    const { url } = await start();
    const leaky = makeRequest();
    const response = await post(url, {
      ...leaky,
      context: { ...leaky.context, session: { ...leaky.context.session, city: "Plovdiv" } },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "bad_request" } });

    const wrongType = await fetch(`${url}/chat`, { method: "POST", body: "hello" });
    expect(wrongType.status).toBe(415);
  });

  it("stops the provider when the client disconnects mid-stream", async () => {
    const { provider, seen } = scriptedProvider(
      Array.from({ length: 50 }, (_, i) => `t${i} `),
      {
        delayMs: 20,
      },
    );
    const { url, metrics, service } = await start({}, provider);
    const controller = new AbortController();
    const response = await post(url, makeRequest(), {}, controller.signal);
    const reader = response.body!.getReader();
    await reader.read(); // first delta has arrived
    controller.abort();
    await expect.poll(() => seen.signal?.aborted).toBe(true);
    await expect.poll(() => service.activeStreams).toBe(0);
    expect(seen.finished).toBe(false);
    expect(metrics.get("ai.request.cancelled")?.count).toBe(1);
  });

  describe("fault injection", () => {
    it("ignores the fault header unless AI_DEBUG is on", async () => {
      const { url } = await start({ debug: false });
      const response = await post(url, makeRequest(), { [AI_FAULT_HEADER]: "http_500" });
      expect(response.status).toBe(200);
      expect((await readChunks(response)).at(-1)?.type).toBe("done");
      expect((await fetch(`${url}/debug/requests/req_test_0001`)).status).toBe(404);
    });

    it("http_500 fails before streaming", async () => {
      const { url } = await start({ debug: true });
      const response = await post(url, makeRequest(), { [AI_FAULT_HEADER]: "http_500" });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        error: { code: "unavailable", retryable: true },
      });
    });

    it("timeout ends the stream with a timeout error chunk", async () => {
      const { url } = await start({ debug: true });
      const response = await post(url, makeRequest(), { [AI_FAULT_HEADER]: "timeout" });
      expect(response.status).toBe(200);
      expect(await readChunks(response)).toEqual([
        {
          type: "error",
          error: {
            code: "timeout",
            message: "The AI model didn't start answering in time.",
            retryable: true,
          },
        },
      ]);
      const outcome = await fetch(`${url}/debug/requests/req_test_0001`);
      expect(await outcome.json()).toEqual({ outcome: "failed" });
    });

    it("slow still completes with the same answer", async () => {
      const { url } = await start({ debug: true, totalTimeoutMs: 20_000 });
      const normal = await readChunks(await post(url, makeRequest({ action: "key_events" })));
      const started = performance.now();
      const slow = await readChunks(
        await post(url, makeRequest({ action: "key_events" }), { [AI_FAULT_HEADER]: "slow" }),
      );
      expect(slow).toEqual(normal);
      expect(performance.now() - started).toBeGreaterThan(normal.length * 15);
    });

    it("ungrounded: the invented payment is streamed, then flagged by the grounding guard", async () => {
      const { url, metrics } = await start({ debug: true });
      const chunks = await readChunks(
        await post(url, makeRequest(), { [AI_FAULT_HEADER]: "ungrounded" }),
      );
      const text = chunks.flatMap((c) => (c.type === "delta" ? [c.text] : [])).join("");
      expect(text).toContain("The visitor completed the payment for the Pro plan.");
      expect(chunks.at(-1)).toEqual({
        type: "done",
        finishReason: "stop",
        model: "mock",
        unverified: [
          {
            kind: "purchase",
            quote: "The visitor completed the payment for the Pro plan",
            reason: "no checkout or payment form was submitted successfully",
          },
        ],
      });
      expect(metrics.get("ai.answer.unverified_claims")?.sum).toBe(1);
    });
  });
});
