import type { AIFault, AIServiceRequest } from "@pulsedesk/contracts";
import { sleep, type AIProvider, type FinishReason } from "./providers/types.ts";

/**
 * Development fault injection, requested per call by the reliability panel and honoured
 * only when ai-service runs with AI_DEBUG=1. `http_500` is handled by the server before
 * streaming starts; the others change how the provider behaves.
 */
export function withFault(provider: AIProvider, fault: AIFault | null, slowTokenMs: number) {
  if (fault === "timeout") return hangingProvider(provider.model);
  if (fault === "slow") return slowProvider(provider, slowTokenMs);
  return provider;
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
