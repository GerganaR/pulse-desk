import type { AIServiceRequest } from "@pulsedesk/contracts";
import { composeAnswer } from "./mock-answers.ts";
import { sleep, type AIProvider, type FinishReason } from "./types.ts";

/** Words with their trailing whitespace, so the tokens join back to the exact text. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/** Small deterministic PRNG so pacing varies like a real model but repeats exactly. */
function seeded(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic provider for development, tests and demos: the answer is composed from
 * the context alone (see mock-answers.ts), streamed word by word with a realistic delay
 * before the first token and jittered pacing after it.
 */
export function createMockProvider({
  tokenMs,
  firstTokenDelayMs,
}: {
  tokenMs: number;
  firstTokenDelayMs: number;
}): AIProvider {
  return {
    model: "mock",
    async *stream(
      request: AIServiceRequest,
      signal: AbortSignal,
    ): AsyncGenerator<string, FinishReason> {
      const random = seeded(request.requestId);
      await sleep(firstTokenDelayMs, signal);
      const tokens = tokenize(composeAnswer(request.action, request.context, request.prompt));
      for (const [index, token] of tokens.entries()) {
        if (index > 0) await sleep(Math.round(tokenMs * (0.5 + random())), signal);
        yield token;
      }
      return "stop";
    },
  };
}
