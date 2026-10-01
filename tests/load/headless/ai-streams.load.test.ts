import type { AIServiceConfig } from "@pulsedesk/ai-service/src/config.ts";
import { createAIService, type AIService } from "@pulsedesk/ai-service/src/server.ts";
import { makeRequest } from "@pulsedesk/ai-service/src/test/fixtures.ts";
import { AIChunkSchema, type AIChunk } from "@pulsedesk/contracts";
import { createLogger, createMemorySink } from "@pulsedesk/observability";
import { afterEach, describe, expect, it } from "vitest";
import { median, report } from "./report.ts";

const STREAMS = 10;

const config: AIServiceConfig = {
  host: "127.0.0.1",
  port: 0,
  // The mock at its normal pace: 400 ms to the first token, about 35 ms per token.
  provider: { kind: "mock", tokenMs: 35, firstTokenDelayMs: 400 },
  firstTokenTimeoutMs: 10_000,
  totalTimeoutMs: 45_000,
  maxConcurrentStreams: STREAMS,
  maxBodyBytes: 256 * 1024,
  debug: false,
  slowTokenMs: 250,
};

let service: AIService | undefined;
afterEach(async () => {
  await service?.close();
  service = undefined;
});

interface StreamResult {
  status: number;
  chunks: AIChunk[];
  firstTokenMs: number | null;
  totalMs: number;
}

/** Read one answer as it streams, timing the first token and the end. */
async function ask(url: string, requestId: string): Promise<StreamResult> {
  const start = performance.now();
  const response = await fetch(`${url}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeRequest({ requestId })),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return { status: response.status, chunks: [], firstTokenMs: null, totalMs: 0 };
  }
  const chunks: AIChunk[] = [];
  let firstTokenMs: number | null = null;
  let buffered = "";
  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    buffered += decoder.decode(bytes, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const chunk = AIChunkSchema.parse(JSON.parse(line));
      if (chunk.type === "delta") firstTokenMs ??= performance.now() - start;
      chunks.push(chunk);
    }
  }
  return { status: response.status, chunks, firstTokenMs, totalMs: performance.now() - start };
}

describe(`${STREAMS} concurrent AI streams`, () => {
  it("all complete with a full, checked answer; one more is turned away, then accepted", async () => {
    const metrics = createMemorySink();
    service = createAIService({
      config,
      logger: createLogger({ sink: { write: () => {} } }),
      metricSink: metrics,
    });
    const url = `http://127.0.0.1:${await service.listen(0, "127.0.0.1")}`;

    const running = Array.from({ length: STREAMS }, (_, i) => ask(url, `req_load_${i}_0000`));
    // While all ten are streaming, the service is at its limit: an eleventh gets a clear,
    // retryable 503 instead of slowing the others down.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const extra = await ask(url, "req_load_extra_0000");
    const results = await Promise.all(running);

    const text = (result: StreamResult) =>
      result.chunks.map((chunk) => (chunk.type === "delta" ? chunk.text : "")).join("");
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.chunks.at(-1)).toMatchObject({
        type: "done",
        finishReason: "stop",
        unverified: [],
      });
      expect(result.chunks.filter((chunk) => chunk.type === "done")).toHaveLength(1);
    }
    // Deterministic provider, same request: every stream carries the same complete answer.
    expect(new Set(results.map(text)).size).toBe(1);
    expect(text(results[0] as StreamResult).length).toBeGreaterThan(100);
    expect(extra.status).toBe(503);

    // Slots are released when streams end.
    const after = await ask(url, "req_load_after_0000");
    expect(after.status).toBe(200);
    expect(after.chunks.at(-1)?.type).toBe("done");

    const firstTokens = results.map((r) => r.firstTokenMs as number);
    const totals = results.map((r) => r.totalMs);
    report(`ai ${STREAMS} concurrent streams`, {
      firstTokenMedianMs: median(firstTokens),
      firstTokenMaxMs: Math.max(...firstTokens),
      totalMedianMs: median(totals),
      totalMaxMs: Math.max(...totals),
      aloneTotalMs: after.totalMs,
      failed: metrics.get("ai.request.failed")?.sum ?? 0,
    });

    // Ten at once shouldn't be meaningfully slower than one alone (they only wait on timers).
    expect(Math.max(...totals)).toBeLessThan(after.totalMs * 1.5 + 500);
    expect(metrics.get("ai.request.failed")).toBeUndefined();
    expect(metrics.get("ai.request.duration")?.count).toBe(STREAMS + 1);
  });
});
