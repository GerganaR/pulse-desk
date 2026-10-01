import type { AIContext, AIFault, AIServiceRequest } from "@pulsedesk/contracts";
import { sleep, type AIProvider, type FinishReason } from "./providers/types.ts";

/**
 * Development fault injection, requested per call by the reliability panel and honoured
 * only when ai-service runs with AI_DEBUG=1. `http_500` is handled by the server before
 * streaming starts; the others change how the provider behaves.
 */
export function withFault(provider: AIProvider, fault: AIFault | null, slowTokenMs: number) {
  switch (fault) {
    case "timeout":
      return hangingProvider(provider.model);
    case "slow":
      return slowProvider(provider, slowTokenMs);
    case "ungrounded":
      return inventingProvider(provider);
    case "http_500":
    case null:
      return provider;
  }
}

/**
 * A claim this session doesn't support: a payment when there was none (the case that
 * matters), otherwise a signup or a form that doesn't exist. Always false for the session,
 * so the grounding guard has something to catch.
 */
export function inventedClaim(context: AIContext): string {
  const succeeded = (pattern: RegExp) =>
    context.events.some(
      (event) => event.kind === "form_submit" && event.success && pattern.test(event.formId),
    );
  if (!succeeded(/checkout/)) return "The visitor completed the payment for the Pro plan.";
  if (!succeeded(/signup/)) return "The visitor also signed up for a free trial.";
  return "The visitor also submitted the newsletter form successfully.";
}

/** A model that makes something up: the real answer, then an unsupported claim. */
function inventingProvider(provider: AIProvider): AIProvider {
  return {
    model: provider.model,
    async *stream(request, signal) {
      const inner = provider.stream(request, signal);
      for (;;) {
        const result = await inner.next();
        if (result.done) {
          yield `\n\n${inventedClaim(request.context)}`;
          return result.value;
        }
        yield result.value;
      }
    },
  };
}

/** Never produces a token: the first-token timeout has to end the stream. */
function hangingProvider(model: string): AIProvider {
  return {
    model,
    // eslint-disable-next-line require-yield -- deliberately yields nothing
    async *stream(
      _request: AIServiceRequest,
      signal: AbortSignal,
    ): AsyncGenerator<string, FinishReason> {
      await new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true }),
      );
      return "stop";
    },
  };
}

/** A congested model: the same answer, with a long pause before every token. */
function slowProvider(provider: AIProvider, tokenMs: number): AIProvider {
  return {
    model: provider.model,
    async *stream(request, signal) {
      const inner = provider.stream(request, signal);
      for (;;) {
        const result = await inner.next();
        if (result.done) return result.value;
        await sleep(tokenMs, signal);
        yield result.value;
      }
    },
  };
}
