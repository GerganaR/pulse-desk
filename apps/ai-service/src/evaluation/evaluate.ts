import { AI_ACTIONS, type AIAction } from "@pulsedesk/contracts";
import type { AIProvider } from "../providers/types.ts";
import type { EvalFixture } from "./fixtures.ts";
import { checkGrounding, type CheckedClaim } from "./grounding.ts";

/**
 * Scores answers against the fixtures. Shared by the CI regression suite (mock provider)
 * and `pnpm eval` (any provider), so both apply exactly the same rules.
 */

export interface EvalCase {
  fixture: EvalFixture;
  action: AIAction;
  prompt: string;
}

/** Every quick action for every fixture, plus each fixture's free-form questions. */
export function evalCases(fixtures: readonly EvalFixture[]): EvalCase[] {
  return fixtures.flatMap((fixture) => [
    ...AI_ACTIONS.filter((action) => action !== "ask").map((action) => ({
      fixture,
      action,
      prompt: "",
    })),
    ...fixture.questions.map((prompt) => ({ fixture, action: "ask" as const, prompt })),
  ]);
}

export interface AnswerScore {
  claims: CheckedClaim[];
  /** Claims the checker couldn't verify against the session. */
  unverified: CheckedClaim[];
  /** Claims of a kind the fixture says the session doesn't support (should equal `unverified` asserted claims). */
  forbidden: CheckedClaim[];
  /** `mustNotSay` phrases found in the answer. */
  banned: string[];
  /** `summaryMentions` not found (summaries only). */
  missing: string[];
}

export function scoreAnswer({ fixture, action }: EvalCase, answer: string): AnswerScore {
  const { claims } = checkGrounding(answer, fixture.context);
  return {
    claims,
    unverified: claims.filter((claim) => !claim.supported),
    forbidden: claims.filter(
      (claim) => claim.polarity === "asserted" && !fixture.supports.includes(claim.kind),
    ),
    banned: fixture.mustNotSay.filter((phrase) => phrase.test(answer)).map(String),
    missing:
      action === "summarize"
        ? fixture.summaryMentions.filter((phrase) => !phrase.test(answer)).map(String)
        : [],
  };
}

/** A case passes when nothing in the answer is ungrounded, forbidden or banned. */
export const passed = (score: AnswerScore) =>
  score.unverified.length === 0 && score.forbidden.length === 0 && score.banned.length === 0;

export interface CaseResult extends EvalCase {
  answer: string;
  durationMs: number;
  /** Set when the provider failed; the case counts as failed and isn't scored. */
  error: string | null;
  score: AnswerScore | null;
}

/** Asks the provider one case and scores the complete answer. */
export async function runCase(
  provider: AIProvider,
  evalCase: EvalCase,
  { timeoutMs = 45_000, requestId = "req_eval_00000000" } = {},
): Promise<CaseResult> {
  const started = performance.now();
  let answer = "";
  try {
    const stream = provider.stream(
      {
        requestId,
        action: evalCase.action,
        prompt: evalCase.prompt,
        context: evalCase.fixture.context,
      },
      AbortSignal.timeout(timeoutMs),
    );
    for await (const text of stream) answer += text;
  } catch (error) {
    return {
      ...evalCase,
      answer,
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
      score: null,
    };
  }
  return {
    ...evalCase,
    answer,
    durationMs: performance.now() - started,
    error: null,
    score: scoreAnswer(evalCase, answer),
  };
}
