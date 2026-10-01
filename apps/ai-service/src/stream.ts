import type { AIChunk, AIError, AIServiceRequest, UnverifiedClaim } from "@pulsedesk/contracts";
import { ProviderError, type AIProvider } from "./providers/types.ts";

export type StreamOutcome =
  | { kind: "completed"; firstTokenMs: number | null; unverifiedClaims: number }
  | { kind: "failed"; error: AIError; firstTokenMs: number | null }
  /** The caller went away (browser cancelled, proxy aborted): nothing more is written. */
  | { kind: "aborted"; firstTokenMs: number | null };

export interface StreamLimits {
  firstTokenTimeoutMs: number;
  totalTimeoutMs: number;
}

class StreamTimeout extends Error {
  readonly phase: "first_token" | "total";

  constructor(phase: "first_token" | "total") {
    super(`AI stream timed out (${phase})`);
    this.phase = phase;
  }
}

/**
 * Runs one provider stream and writes it as chunks: `delta`… then exactly one `done` or
 * `error`, unless the caller aborts, in which case writing simply stops.
 *
 * Both time limits abort the provider, and the loop races every `next()` against the
 * abort, so a provider that ignores its signal still can't hold the response open.
 *
 * `check` runs on the complete answer and its result goes out in the `done` chunk: the
 * runtime grounding guard. Partial answers (failed, cancelled) aren't checked; they're
 * already shown as incomplete.
 */
export async function streamAnswer({
  provider,
  request,
  signal,
  write,
  limits,
  check = () => [],
  now = () => performance.now(),
}: {
  provider: AIProvider;
  request: AIServiceRequest;
  /** Aborts when the client disconnects. */
  signal: AbortSignal;
  write: (chunk: AIChunk) => void;
  limits: StreamLimits;
  /** Claims in the complete answer the session doesn't support. */
  check?: (answer: string) => UnverifiedClaim[];
  now?: () => number;
}): Promise<StreamOutcome> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abortFromCaller, { once: true });
  if (signal.aborted) controller.abort(signal.reason);

  const started = now();
  let firstTokenMs: number | null = null;
  let answer = "";
  const firstTokenTimer = setTimeout(
    () => controller.abort(new StreamTimeout("first_token")),
    limits.firstTokenTimeoutMs,
  );
  const totalTimer = setTimeout(
    () => controller.abort(new StreamTimeout("total")),
    limits.totalTimeoutMs,
  );
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(controller.signal.reason as Error);
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => {}); // observed below; avoid an unhandled rejection when unused

  const iterator = provider.stream(request, controller.signal);
  try {
    for (;;) {
      const result = await Promise.race([iterator.next(), aborted]);
      if (result.done) {
        const unverified = check(answer);
        write({ type: "done", finishReason: result.value, model: provider.model, unverified });
        return { kind: "completed", firstTokenMs, unverifiedClaims: unverified.length };
      }
      if (!result.value) continue;
      if (firstTokenMs === null) {
        firstTokenMs = now() - started;
        clearTimeout(firstTokenTimer);
      }
      answer += result.value;
      write({ type: "delta", text: result.value });
    }
  } catch (error) {
    const reason = controller.signal.reason as unknown;
    if (controller.signal.aborted && !(reason instanceof StreamTimeout))
      return { kind: "aborted", firstTokenMs };
    const failure = toAIError(reason instanceof StreamTimeout ? reason : error);
    write({ type: "error", error: failure });
    return { kind: "failed", error: failure, firstTokenMs };
  } finally {
    clearTimeout(firstTokenTimer);
    clearTimeout(totalTimer);
    signal.removeEventListener("abort", abortFromCaller);
    controller.abort(); // stop the provider in every case (no-op if already aborted)
    void iterator.return(undefined as never).catch(() => {});
  }
}

function toAIError(error: unknown): AIError {
  if (error instanceof StreamTimeout)
    return {
      code: "timeout",
      message:
        error.phase === "first_token"
          ? "The AI model didn't start answering in time."
          : "The answer took too long and was stopped.",
      retryable: true,
    };
  if (error instanceof ProviderError)
    return { code: "provider_error", message: error.message, retryable: true };
  return { code: "provider_error", message: "The AI model failed to answer.", retryable: true };
}
