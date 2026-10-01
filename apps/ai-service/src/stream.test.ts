import type { AIChunk, UnverifiedClaim } from "@pulsedesk/contracts";
import { describe, expect, it } from "vitest";
import { ProviderError, type AIProvider } from "./providers/types.ts";
import { streamAnswer } from "./stream.ts";
import { makeRequest, scriptedProvider } from "./test/fixtures.ts";

const limits = { firstTokenTimeoutMs: 200, totalTimeoutMs: 1_000 };

async function run(
  provider: AIProvider,
  signal = new AbortController().signal,
  l = limits,
  check?: (answer: string) => UnverifiedClaim[],
) {
  const chunks: AIChunk[] = [];
  const outcome = await streamAnswer({
    provider,
    request: makeRequest(),
    signal,
    write: (chunk) => chunks.push(chunk),
    limits: l,
    check,
  });
  return { chunks, outcome };
}

describe("streamAnswer", () => {
  it("streams deltas, then exactly one done chunk", async () => {
    const { provider } = scriptedProvider(["Hello ", "there."]);
    const { chunks, outcome } = await run(provider);
    expect(chunks).toEqual([
      { type: "delta", text: "Hello " },
      { type: "delta", text: "there." },
      { type: "done", finishReason: "stop", model: "scripted", unverified: [] },
    ]);
    expect(outcome.kind).toBe("completed");
    expect(outcome.firstTokenMs).not.toBeNull();
  });

  it("checks the complete answer and reports unverified claims in the done chunk", async () => {
    const claim: UnverifiedClaim = { kind: "purchase", quote: "They paid", reason: "no payment" };
    const answers: string[] = [];
    const { provider } = scriptedProvider(["They ", "paid."]);
    const { chunks, outcome } = await run(provider, undefined, limits, (answer) => {
      answers.push(answer);
      return [claim];
    });
    expect(answers).toEqual(["They paid."]);
    expect(chunks.at(-1)).toEqual({
      type: "done",
      finishReason: "stop",
      model: "scripted",
      unverified: [claim],
    });
    expect(outcome).toMatchObject({ kind: "completed", unverifiedClaims: 1 });
  });

  it("doesn't check a partial answer", async () => {
    const { provider } = scriptedProvider(["a ", "b ", "c ", "d "], { delayMs: 80 });
    let checked = false;
    const { chunks } = await run(
      provider,
      undefined,
      { firstTokenTimeoutMs: 200, totalTimeoutMs: 200 },
      () => {
        checked = true;
        return [];
      },
    );
    expect(chunks.at(-1)?.type).toBe("error");
    expect(checked).toBe(false);
  });

  it("ends with a timeout error chunk when the first token is late, and stops the provider", async () => {
    const { provider, seen } = scriptedProvider(["late"], { delayMs: 5_000 });
    const { chunks, outcome } = await run(provider);
    expect(chunks).toEqual([
      {
        type: "error",
        error: {
          code: "timeout",
          message: "The AI model didn't start answering in time.",
          retryable: true,
        },
      },
    ]);
    expect(outcome.kind).toBe("failed");
    expect(seen.signal?.aborted).toBe(true);
  });

  it("stops at the total limit even after tokens have started, keeping what was sent", async () => {
    const { provider, seen } = scriptedProvider(["a ", "b ", "c ", "d "], { delayMs: 80 });
    const { chunks } = await run(provider, undefined, {
      firstTokenTimeoutMs: 200,
      totalTimeoutMs: 200,
    });
    expect(chunks.filter((c) => c.type === "delta").length).toBeGreaterThan(0);
    expect(chunks.at(-1)).toMatchObject({ type: "error", error: { code: "timeout" } });
    expect(seen.signal?.aborted).toBe(true);
    expect(seen.finished).toBe(false);
  });

  it("can't be held open by a provider that ignores its abort signal", async () => {
    const { provider } = scriptedProvider(["never"], { delayMs: 10_000, ignoreAbort: true });
    const started = performance.now();
    const { chunks } = await run(provider);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(chunks.at(-1)).toMatchObject({ type: "error", error: { code: "timeout" } });
  });

  it("stops the provider and writes nothing more when the caller aborts", async () => {
    const { provider, seen } = scriptedProvider(["a ", "b ", "c ", "d "], { delayMs: 50 });
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 120);
    const { chunks, outcome } = await run(provider, caller.signal);
    expect(outcome.kind).toBe("aborted");
    expect(chunks.every((c) => c.type === "delta")).toBe(true);
    expect(chunks.length).toBeLessThan(4);
    expect(seen.signal?.aborted).toBe(true);
    expect(seen.finished).toBe(false);
  });

  it("turns provider failures into a provider_error chunk", async () => {
    const provider: AIProvider = {
      model: "broken",
      // eslint-disable-next-line require-yield -- fails before yielding
      async *stream() {
        throw new ProviderError("The AI provider responded 503", 503);
      },
    };
    const { chunks } = await run(provider);
    expect(chunks).toEqual([
      {
        type: "error",
        error: {
          code: "provider_error",
          message: "The AI provider responded 503",
          retryable: true,
        },
      },
    ]);
  });
});
