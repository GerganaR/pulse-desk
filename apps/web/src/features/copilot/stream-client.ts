import {
  AIChunkSchema,
  AIErrorResponseSchema,
  decode,
  decodeJson,
  type AIChatRequest,
  type AIChunk,
  type AIError,
} from "@pulsedesk/contracts";
import { readLines } from "./ndjson";

/** A failed AI request, described in terms the UI can show. */
export class AIStreamError extends Error {
  readonly error: AIError;

  constructor(error: AIError) {
    super(error.message);
    this.name = "AIStreamError";
    this.error = error;
  }
}

class Timeout extends Error {
  readonly phase: "first_token" | "total";

  constructor(phase: "first_token" | "total") {
    super(`AI request timed out (${phase})`);
    this.phase = phase;
  }
}

export interface StreamAIChatOptions {
  /** Aborting it cancels the request end to end (browser → web server → ai-service). */
  signal: AbortSignal;
  /**
   * Browser-side limits. They're backstops, longer than ai-service's own (10 s / 45 s),
   * which normally report a timeout first, in the stream.
   */
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
  headers?: Record<string, string>;
  url?: string;
  fetch?: typeof fetch;
}

const unavailable = (message: string): AIError => ({
  code: "unavailable",
  message,
  retryable: true,
});
const protocolError = (message: string): AIError => ({
  code: "protocol_error",
  message,
  retryable: true,
});

/**
 * Posts a question and yields the answer as it streams: `delta` chunks, then one `done`.
 * Every failure (HTTP error, `error` chunk, timeout, broken or malformed stream) throws
 * an `AIStreamError`. Cancellation through `signal` rethrows the abort reason instead,
 * so callers can tell "the user stopped it" from "it failed".
 */
export async function* streamAIChat(
  request: AIChatRequest,
  {
    signal,
    firstTokenTimeoutMs = 15_000,
    totalTimeoutMs = 60_000,
    headers = {},
    url = "/api/ai/chat",
    fetch: fetchImpl = fetch,
  }: StreamAIChatOptions,
): AsyncGenerator<Extract<AIChunk, { type: "delta" | "done" }>> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  const firstTokenTimer = setTimeout(
    () => controller.abort(new Timeout("first_token")),
    firstTokenTimeoutMs,
  );
  const totalTimer = setTimeout(() => controller.abort(new Timeout("total")), totalTimeoutMs);

  /** Translates whatever interrupted us into the error the caller should see. */
  const interruption = (error: unknown, fallback: AIError): unknown => {
    if (signal.aborted) return signal.reason ?? error;
    const reason: unknown = controller.signal.reason;
    if (controller.signal.aborted && reason instanceof Timeout)
      return new AIStreamError({
        code: "timeout",
        message:
          reason.phase === "first_token"
            ? "The copilot didn't start answering in time."
            : "The answer took too long and was stopped.",
        retryable: true,
      });
    return error instanceof AIStreamError ? error : new AIStreamError(fallback);
  };

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...headers },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      throw interruption(error, unavailable("Couldn't reach PulseDesk. Check your connection."));
    }

    if (!response.ok || !response.body) {
      const body = decode(AIErrorResponseSchema, await response.json().catch(() => null));
      throw new AIStreamError(
        body.ok
          ? body.value.error
          : unavailable(`The copilot is unavailable (HTTP ${response.status}).`),
      );
    }

    try {
      for await (const line of readLines(response.body, controller.signal)) {
        const chunk = decodeJson(AIChunkSchema, line);
        if (!chunk.ok) throw new AIStreamError(protocolError("The answer arrived malformed."));
        switch (chunk.value.type) {
          case "delta":
            clearTimeout(firstTokenTimer);
            yield chunk.value;
            break;
          case "done":
            yield chunk.value;
            return;
          case "error":
            throw new AIStreamError(chunk.value.error);
        }
      }
    } catch (error) {
      throw interruption(error, unavailable("The connection dropped while answering."));
    }
    throw new AIStreamError(protocolError("The answer was cut off."));
  } finally {
    clearTimeout(firstTokenTimer);
    clearTimeout(totalTimer);
    signal.removeEventListener("abort", cancel);
    controller.abort(); // release the connection however we got here
  }
}
