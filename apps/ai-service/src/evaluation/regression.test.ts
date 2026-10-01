import { describe, expect, it } from "vitest";
import { inventedClaim } from "../faults.ts";
import { createMockProvider } from "../providers/mock.provider.ts";
import { evalCases, passed, runCase, scoreAnswer } from "./evaluate.ts";
import { EVAL_FIXTURES } from "./fixtures.ts";

/**
 * Hallucination regressions: every fixture × every quick action and question, answered by
 * the mock provider (the one that runs in CI), must make no claim its session doesn't
 * support. `pnpm eval` runs the same cases against a real provider.
 *
 * Mutation check: removing the success guard in mock-answers.ts `outcome()` makes the
 * mock claim a purchase for "checkout-declined", and this suite fails.
 */
const provider = createMockProvider({ tokenMs: 0, firstTokenDelayMs: 0 });
const cases = evalCases(EVAL_FIXTURES);
const label = (c: (typeof cases)[number]) =>
  `${c.fixture.id} · ${c.action}${c.prompt ? ` · "${c.prompt}"` : ""}`;

describe("mock provider: no ungrounded claims", () => {
  it.each(cases.map((c) => [label(c), c] as const))("%s", async (_, evalCase) => {
    const result = await runCase(provider, evalCase);
    expect(result.error).toBeNull();
    const score = result.score!;
    const detail = `Answer:\n${result.answer}`;

    expect(
      score.unverified.map(({ kind, quote, reason }) => ({ kind, quote, reason })),
      detail,
    ).toEqual([]);
    expect(
      score.forbidden.map((c) => c.quote),
      detail,
    ).toEqual([]);
    expect(score.banned, detail).toEqual([]);
    expect(score.missing, detail).toEqual([]);
  });

  it("covers every fixture with every quick action and at least one question", () => {
    expect(cases.length).toBeGreaterThanOrEqual(EVAL_FIXTURES.length * 6);
  });
});

describe("the suite catches a provider that invents outcomes", () => {
  // Each fixture with the dev "ungrounded" fault's invention appended: all must fail, so a
  // provider that starts making things up can't pass unnoticed.
  it.each(EVAL_FIXTURES.map((f) => [f.id, f] as const))("%s", (_, fixture) => {
    const evalCase = { fixture, action: "summarize" as const, prompt: "" };
    const answer = `A summary.\n\n${inventedClaim(fixture.context)}`;
    const score = scoreAnswer(evalCase, answer);
    expect(passed(score)).toBe(false);
    expect(score.unverified).toHaveLength(1);
  });
});
