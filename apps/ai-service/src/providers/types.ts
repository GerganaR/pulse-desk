import type { AIServiceRequest } from "@pulsedesk/contracts";

export type FinishReason = "stop" | "length";

/**
 * A model behind a uniform streaming interface. Yields text deltas as they arrive and
 * returns why it stopped. Must stop promptly when `signal` aborts (the caller also
 * stops pulling, so a provider that ignores it only wastes its own work).
 */
export interface AIProvider {
  /** Reported to the client in the `done` chunk, e.g. "mock" or a model name. */
  readonly model: string;
  stream(request: AIServiceRequest, signal: AbortSignal): AsyncGenerator<string, FinishReason>;
}

/** Thrown by providers for upstream failures; the message is safe to show a user. */
export class ProviderError extends Error {
  /** The provider's HTTP status; 0 when it couldn't be reached at all; null otherwise. */
  readonly status: number | null;
  /** How long the provider asked callers to wait before retrying (429, 503), if it said. */
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Resolves after `ms`, or rejects with the abort reason as soon as `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
