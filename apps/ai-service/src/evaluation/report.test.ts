import { describe, expect, it } from "vitest";
import { createMockProvider } from "../providers/mock.provider.ts";
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
