import { describe, expect, it } from "vitest";
import { createMockProvider } from "../providers/mock.provider.ts";
import { ProviderError } from "../providers/types.ts";
import { evalCases, runCase } from "./evaluate.ts";
import { EVAL_FIXTURES } from "./fixtures.ts";
import { renderMarkdown, summarise } from "./report.ts";

const info = {
  model: "mock",
  provider: "mock" as const,
  startedAt: "2026-09-30T00:00:00Z",
  repeat: 1,
};

describe("evaluation report", () => {
  it("summarises a clean run and lists no failures", async () => {
    const provider = createMockProvider({ tokenMs: 0, firstTokenDelayMs: 0 });
    const results = await Promise.all(
      evalCases(EVAL_FIXTURES.slice(0, 2)).map((c) => runCase(provider, c)),
    );
    const summary = summarise(results);
    expect(summary).toMatchObject({ cases: results.length, passed: results.length, errors: 0 });
    expect(summary.claims).toBeGreaterThan(0);
    const report = renderMarkdown(info, results);
    expect(report).toContain(`| ${results.length} / ${results.length} |`);
    expect(report).toContain("## Failures\n\nNone.");
  });

  it("shows each failure with its claim, reason and answer", async () => {
    const fixture = EVAL_FIXTURES.find((f) => f.id === "hesitant-buyer")!;
    const result = await runCase(
      {
        model: "liar",
        async *stream() {
          yield "They upgraded to Pro.";
          return "stop";
        },
      },
      { fixture, action: "summarize", prompt: "" },
    );
    const report = renderMarkdown(info, [result]);
    expect(summarise([result]).unverifiedClaims).toBe(1);
    expect(report).toContain(
      '- **Unverified purchase** (asserted): "They upgraded to Pro": no checkout or payment form was submitted successfully',
    );
    expect(report).toContain("    They upgraded to Pro.");
  });

  it("retries a rate-limited case after the wait the provider asks for", async () => {
    const fixture = EVAL_FIXTURES[0]!;
    const waits: number[] = [];
    let calls = 0;
    const result = await runCase(
      {
        model: "limited",
        async *stream() {
          calls++;
          if (calls === 1) throw new ProviderError("rate limited", 429, 18_996);
          if (calls === 2) throw new ProviderError("overloaded", 503);
          yield "They viewed pricing.";
          return "length";
        },
      },
      { fixture, action: "summarize", prompt: "" },
      { retries: 3, wait: (ms) => Promise.resolve(void waits.push(ms)) },
    );
    expect(waits).toEqual([19_996, 11_000]); // the provider's wait, then a doubling default
    expect(result).toMatchObject({ error: null, attempts: 3, finishReason: "length" });
    expect(summarise([result])).toMatchObject({ retries: 2, truncated: 1, errors: 0 });
    expect(renderMarkdown(info, [result])).toContain("## Answers cut at the output limit");
  });

  it("gives up after its retries, and never retries other failures", async () => {
    const fixture = EVAL_FIXTURES[0]!;
    const failing = (status: number) => ({
      model: "down",
      // eslint-disable-next-line require-yield -- fails before answering
      async *stream(): AsyncGenerator<string, "stop"> {
        throw new ProviderError("nope", status);
      },
    });
    const evalCase = { fixture, action: "summarize" as const, prompt: "" };
    const wait = () => Promise.resolve();
    expect(await runCase(failing(429), evalCase, { retries: 2, wait })).toMatchObject({
      error: "nope",
      attempts: 3,
    });
    expect(await runCase(failing(401), evalCase, { retries: 2, wait })).toMatchObject({
      error: "nope",
      attempts: 1,
    });
    // 0 = no response at all (a dropped connection): transient, so retried.
    expect(await runCase(failing(0), evalCase, { retries: 2, wait })).toMatchObject({
      attempts: 3,
    });
  });

  it("records provider errors without scoring them", async () => {
    const fixture = EVAL_FIXTURES[0]!;
    const result = await runCase(
      {
        model: "broken",
        // eslint-disable-next-line require-yield -- fails before answering
        async *stream() {
          throw new Error("rate limited");
        },
      },
      { fixture, action: "summarize", prompt: "" },
    );
    expect(result).toMatchObject({ error: "rate limited", score: null });
    expect(renderMarkdown(info, [result])).toContain("Provider error: rate limited");
  });
});
