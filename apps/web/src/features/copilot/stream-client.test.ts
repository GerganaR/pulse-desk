// @vitest-environment node
import type { AIChatRequest } from "@pulsedesk/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLines } from "./ndjson";
import { AIStreamError, streamAIChat, type StreamAIChatOptions } from "./stream-client";

const encoder = new TextEncoder();

/** A body whose reads end exactly where the test says (bytes, not characters). */
function bodyOf(parts: (string | Uint8Array)[], { endless = false } = {}) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(typeof part === "string" ? encoder.encode(part) : part);
      if (!endless) controller.close();
    },
  });
}

async function linesOf(parts: (string | Uint8Array)[]) {
  const lines: string[] = [];
  for await (const line of readLines(bodyOf(parts))) lines.push(line);
  return lines;
}

describe("readLines (NDJSON framing)", () => {
  it("reassembles lines split across reads", async () => {
    expect(await linesOf(['{"a":', '1}\n{"b"', ":2}\n"])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("decodes a multi-byte character split between reads", async () => {
    const bytes = encoder.encode('{"text":"café ☕"}\n');
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte ☕
    expect(await linesOf([bytes.slice(0, cut), bytes.slice(cut)])).toEqual(['{"text":"café ☕"}']);
  });

  it("handles CRLF, blank lines and a last line without a newline", async () => {
    expect(await linesOf(["a\r\n\n  \nb"])).toEqual(["a", "b"]);
  });
});

const request: AIChatRequest = {
  requestId: "req_12345678",
  sessionId: "ses_1",
  action: "summarize",
};

function respond(response: Response): StreamAIChatOptions["fetch"] {
  return vi.fn(() => Promise.resolve(response));
}

const ndjson = (...lines: string[]) => lines.map((line) => `${line}\n`);
const delta = (text: string) => JSON.stringify({ type: "delta", text });
const done = JSON.stringify({ type: "done", finishReason: "stop", model: "mock" });

async function collect(options: Partial<StreamAIChatOptions> & Pick<StreamAIChatOptions, "fetch">) {
  const chunks: unknown[] = [];
  try {
    for await (const chunk of streamAIChat(request, {
      signal: new AbortController().signal,
      ...options,
    }))
      chunks.push(chunk);
    return { chunks, error: null };
  } catch (error) {
    return { chunks, error };
  }
}

afterEach(() => vi.useRealTimers());

describe("streamAIChat", () => {
  it("yields deltas then done, and posts the request as JSON", async () => {
    const fetch = respond(new Response(bodyOf(ndjson(delta("Hel"), delta("lo"), done))));
    const { chunks, error } = await collect({ fetch });
    expect(error).toBeNull();
    expect(chunks).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "done", finishReason: "stop", model: "mock" },
    ]);
    const [url, init] = vi.mocked(fetch!).mock.calls[0]!;
    expect(url).toBe("/api/ai/chat");
    expect(JSON.parse(String(init!.body))).toEqual(request);
  });

  it("throws the server's error from an error chunk, after the partial text", async () => {
    const error = { code: "timeout", message: "Too slow", retryable: true };
    const fetch = respond(
      new Response(bodyOf(ndjson(delta("Part"), JSON.stringify({ type: "error", error })))),
    );
    const result = await collect({ fetch });
    expect(result.chunks).toEqual([{ type: "delta", text: "Part" }]);
    expect(result.error).toBeInstanceOf(AIStreamError);
    expect((result.error as AIStreamError).error).toEqual(error);
  });

  it("reports an HTTP error with the body's message when there is one", async () => {
    const error = { code: "session_not_found", message: "Gone", retryable: false };
    const fromBody = await collect({ fetch: respond(Response.json({ error }, { status: 404 })) });
    expect((fromBody.error as AIStreamError).error).toEqual(error);

    const bare = await collect({ fetch: respond(new Response("oops", { status: 502 })) });
    expect((bare.error as AIStreamError).error).toMatchObject({
      code: "unavailable",
      message: "The copilot is unavailable (HTTP 502).",
    });
  });

  it("treats a malformed line as a protocol error", async () => {
    const result = await collect({
      fetch: respond(new Response(bodyOf(ndjson(delta("ok"), "{nope")))),
    });
    expect((result.error as AIStreamError).error.code).toBe("protocol_error");
  });

  it("treats a stream that ends without done or error as cut off", async () => {
    const result = await collect({ fetch: respond(new Response(bodyOf(ndjson(delta("Half"))))) });
    expect(result.chunks).toHaveLength(1);
    expect((result.error as AIStreamError).error).toMatchObject({
      code: "protocol_error",
      message: "The answer was cut off.",
    });
  });

  it("reports a network failure as unavailable", async () => {
    const result = await collect({ fetch: () => Promise.reject(new TypeError("Failed to fetch")) });
    expect((result.error as AIStreamError).error.code).toBe("unavailable");
  });

  it("times out when no token arrives in time, and aborts the request", async () => {
    vi.useFakeTimers();
    let sentSignal: AbortSignal | undefined;
    const fetch: StreamAIChatOptions["fetch"] = (_url, init) => {
      sentSignal = init!.signal!;
      return Promise.resolve(new Response(bodyOf([], { endless: true })));
    };
    const pending = collect({ fetch, firstTokenTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    expect((result.error as AIStreamError).error).toMatchObject({
      code: "timeout",
      message: "The copilot didn't start answering in time.",
    });
    expect(sentSignal?.aborted).toBe(true);
  });

  it("enforces the total limit even while tokens keep coming", async () => {
    vi.useFakeTimers();
    let timer: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => controller.enqueue(encoder.encode(`${delta("x")}\n`)), 100);
      },
      cancel: () => clearInterval(timer),
    });
    const pending = collect({ fetch: respond(new Response(body)), totalTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_050);
    const result = await pending;
    expect(result.chunks.length).toBeGreaterThan(5);
    expect((result.error as AIStreamError).error.message).toBe(
      "The answer took too long and was stopped.",
    );
  });

  it("rethrows the caller's abort (not an AIStreamError) and aborts the fetch", async () => {
    const caller = new AbortController();
    let sentSignal: AbortSignal | undefined;
    const fetch: StreamAIChatOptions["fetch"] = (_url, init) => {
      sentSignal = init!.signal!;
      return Promise.resolve(new Response(bodyOf(ndjson(delta("a")), { endless: true })));
    };
    const chunks: unknown[] = [];
    const error = await (async () => {
      for await (const chunk of streamAIChat(request, { signal: caller.signal, fetch })) {
        chunks.push(chunk);
        caller.abort(new DOMException("Stopped", "AbortError"));
      }
    })().catch((e: unknown) => e);
    expect(chunks).toHaveLength(1);
    expect(error).not.toBeInstanceOf(AIStreamError);
    expect((error as DOMException).name).toBe("AbortError");
    expect(sentSignal?.aborted).toBe(true);
  });
});
