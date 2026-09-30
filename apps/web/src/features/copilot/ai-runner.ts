import type { AIAction, AIError } from "@pulsedesk/contracts";
import { createMemorySink, createMetrics, type Metrics } from "@pulsedesk/observability";
import {
  aiRequestCancelled,
  aiRequestCompleted,
  aiRequestFailed,
  aiRequestStarted,
  aiTextReceived,
  selectAIRequest,
  type AppDispatch,
  type RootState,
} from "@pulsedesk/state";
import { nanoid } from "@reduxjs/toolkit";
import { AIStreamError, streamAIChat } from "./stream-client";

export interface AIRunnerDeps {
  dispatch: AppDispatch;
  getState: () => RootState;
  stream?: typeof streamAIChat;
  /** Per-frame batching; requestAnimationFrame in the browser. */
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  metrics?: Metrics;
  /** Extra request headers, read per request (the dev fault switch). */
  getHeaders?: () => Record<string, string>;
  createId?: () => string;
}

export interface AskInput {
  sessionId: string;
  action: AIAction;
  prompt?: string;
}

export interface AIRunner {
  /** Starts a request; returns its id. */
  ask(input: AskInput): string;
  /** Starts a new attempt for a failed or cancelled request; returns its id. */
  retry(requestId: string): string | null;
  cancel(requestId: string): void;
}

/** In-memory AI metrics for this tab (a dev metrics view is Phase 7). */
export const aiMetricsSink = createMemorySink();

const UNEXPECTED: AIError = {
  code: "unavailable",
  message: "Something went wrong while answering.",
  retryable: true,
};

/**
 * Runs copilot requests and mirrors them into the `ai` slice.
 *
 * Text is buffered and dispatched at most once per animation frame per request, so a
 * fast stream costs one render per frame, not one per token. Anything buffered is
 * flushed before a request ends, so a failed or cancelled answer keeps every character
 * that arrived.
 *
 * AbortControllers aren't serialisable, so they live here rather than in Redux. The
 * runner outlives the panel: leaving the page doesn't stop an answer.
 */
export function createAIRunner({
  dispatch,
  getState,
  stream = streamAIChat,
  scheduleFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
  now = () => Date.now(),
  metrics = createMetrics(aiMetricsSink),
  getHeaders = () => ({}),
  createId = () => `req_${nanoid(16)}`,
}: AIRunnerDeps): AIRunner {
  const running = new Map<string, { controller: AbortController; flush: () => void }>();

  async function run(id: string, { sessionId, action, prompt = "" }: AskInput, startedAt: number) {
    const controller = new AbortController();
    let pending = "";
    let pendingSince = 0;
    let frame: number | null = null;
    let firstToken = true;

    const flush = () => {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      if (!pending) return;
      dispatch(aiTextReceived({ id, text: pending, at: pendingSince }));
      pending = "";
    };
    running.set(id, { controller, flush });
    const tags = { action };

    try {
      for await (const chunk of stream(
        { requestId: id, sessionId, action, prompt },
        { signal: controller.signal, headers: getHeaders() },
      )) {
        if (chunk.type === "delta") {
          if (!pending) pendingSince = now();
          if (firstToken) {
            firstToken = false;
            metrics.histogram("ai.request.first_token", now() - startedAt, tags);
          }
          pending += chunk.text;
          frame ??= scheduleFrame(flush);
        } else {
          flush();
          dispatch(
            aiRequestCompleted({
              id,
              at: now(),
              model: chunk.model,
              finishReason: chunk.finishReason,
            }),
          );
          metrics.histogram("ai.request.duration", now() - startedAt, tags);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return; // cancelled: cancel() already recorded it
      flush();
      const failure = error instanceof AIStreamError ? error.error : UNEXPECTED;
      dispatch(aiRequestFailed({ id, at: now(), error: failure }));
      metrics.increment("ai.request.failed", 1, { ...tags, code: failure.code });
    } finally {
      if (frame !== null) cancelFrame(frame);
      running.delete(id);
    }
  }

  function start(input: AskInput, retryOf?: string): string {
    const id = createId();
    const startedAt = now();
    dispatch(
      aiRequestStarted({
        id,
        sessionId: input.sessionId,
        action: input.action,
        prompt: input.prompt ?? "",
        startedAt,
        retryOf,
      }),
    );
    void run(id, input, startedAt);
    return id;
  }

  return {
    ask: (input) => start(input),
    retry(requestId) {
      const previous = selectAIRequest(getState(), requestId);
      if (!previous || previous.status === "streaming" || previous.status === "done") return null;
      const { sessionId, action, prompt } = previous;
      return start({ sessionId, action, prompt }, requestId);
    },
    cancel(requestId) {
      const request = running.get(requestId);
      if (!request) return;
      request.flush();
      dispatch(aiRequestCancelled({ id: requestId, at: now() }));
      request.controller.abort();
      metrics.increment("ai.request.cancelled", 1, {
        action: selectAIRequest(getState(), requestId)?.action ?? "unknown",
      });
    },
  };
}
