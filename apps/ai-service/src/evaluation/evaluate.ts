import { AI_ACTIONS, type AIAction } from "@pulsedesk/contracts";
import { ProviderError, type AIProvider, type FinishReason } from "../providers/types.ts";
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
  /** Why the model stopped; "length" means the answer was cut at the output limit. */
  finishReason: FinishReason | null;
  /** The successful attempt's duration (or the last failed one's). */
  durationMs: number;
  /** 1, plus one per retry after the provider asked to slow down. */
  attempts: number;
  /** Set when the provider failed; the case counts as failed and isn't scored. */
  error: string | null;
  score: AnswerScore | null;
}

export interface RunOptions {
  timeoutMs?: number;
  requestId?: string;
  /** Retries when the provider rate-limits (429), is overloaded (503) or can't be reached. */
  retries?: number;
  wait?: (ms: number) => Promise<void>;
}

/** Transient failures: rate limit, overload, and no response at all (status 0). */
const RETRYABLE = new Set([0, 429, 503]);

/**
 * Asks the provider one case and scores the complete answer. Rate limits, overload and
 * network failures are retried after the wait the provider asks for (or a doubling one),
 * so a free tier's quota or a dropped connection slows an evaluation down instead of
 * failing it.
 */
export async function runCase(
  provider: AIProvider,
  evalCase: EvalCase,
  {
    timeoutMs = 45_000,
    requestId = "req_eval_00000000",
    retries = 0,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: RunOptions = {},
): Promise<CaseResult> {
  for (let attempt = 1; ; attempt++) {
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
      let next = await stream.next();
      while (!next.done) {
        answer += next.value;
        next = await stream.next();
      }
      return {
        ...evalCase,
        answer,
        finishReason: next.value,
        durationMs: performance.now() - started,
        attempts: attempt,
        error: null,
        score: scoreAnswer(evalCase, answer),
      };
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.status !== null &&
        RETRYABLE.has(error.status) &&
        attempt <= retries
      ) {
        await wait((error.retryAfterMs ?? Math.min(60_000, 5_000 * 2 ** (attempt - 1))) + 1_000);
        continue;
      }
      return {
        ...evalCase,
        answer,
        finishReason: null,
        durationMs: performance.now() - started,
        attempts: attempt,
        error: error instanceof Error ? error.message : String(error),
        score: null,
      };
    }
  }
}
