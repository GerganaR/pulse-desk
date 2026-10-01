import {
  AIFaultSchema,
  AIServiceRequestSchema,
  AI_FAULT_HEADER,
  NDJSON_CONTENT_TYPE,
  decode,
  type AIChunk,
  type AIErrorResponse,
  type AIFault,
} from "@pulsedesk/contracts";
import { createMetrics, type Logger, type MetricSink } from "@pulsedesk/observability";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AIServiceConfig } from "./config.ts";
import { checkGrounding } from "./evaluation/grounding.ts";
import { withFault } from "./faults.ts";
import { createMockProvider } from "./providers/mock.provider.ts";
import { createOpenAIProvider } from "./providers/openai.provider.ts";
import type { AIProvider } from "./providers/types.ts";
import { streamAnswer, type StreamOutcome } from "./stream.ts";

export interface AIServiceOptions {
  config: AIServiceConfig;
  logger: Logger;
  /** Overrides the provider from config (tests). */
  provider?: AIProvider;
  metricSink?: MetricSink;
}

export function createProvider(config: AIServiceConfig): AIProvider {
  const provider = config.provider;
  return provider.kind === "mock" ? createMockProvider(provider) : createOpenAIProvider(provider);
}

function sendError(res: ServerResponse, status: number, error: AIErrorResponse["error"]) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error } satisfies AIErrorResponse));
}

class BodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new BodyError(415, "Expected application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new BodyError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BodyError(400, "Body must be JSON");
  }
}

/** Bounded record of recent outcomes, for development diagnostics (AI_DEBUG=1 only). */
function createOutcomeLog(limit = 500) {
  const outcomes = new Map<string, StreamOutcome["kind"] | "streaming">();
  return {
    set(requestId: string, outcome: StreamOutcome["kind"] | "streaming") {
      outcomes.delete(requestId);
      outcomes.set(requestId, outcome);
      const oldest = outcomes.keys().next();
      if (outcomes.size > limit && !oldest.done) outcomes.delete(oldest.value);
    },
    get: (requestId: string) => outcomes.get(requestId),
  };
}

/**
 * HTTP API:
 *   GET  /healthz                   liveness, provider and active streams
 *   POST /chat                      AIServiceRequest → NDJSON AIChunk stream
 *   GET  /debug/requests/:id        outcome of a recent request (AI_DEBUG=1 only)
 *
 * Errors before streaming (bad input, overload, injected 500) are HTTP errors with a JSON
 * body. Once the 200 is sent, every failure is an in-band `error` chunk.
 */
export function createAIService({
  config,
  logger,
  provider = createProvider(config),
  metricSink = { record: () => {} },
}: AIServiceOptions) {
  const metrics = createMetrics(metricSink);
  const outcomes = createOutcomeLog();
  let activeStreams = 0;

  async function handleChat(req: IncomingMessage, res: ServerResponse) {
    let body: unknown;
    try {
      body = await readJson(req, config.maxBodyBytes);
    } catch (error) {
      const status = error instanceof BodyError ? error.status : 400;
      return sendError(res, status, {
        code: "bad_request",
        message: error instanceof Error ? error.message : "Bad request",
        retryable: false,
      });
    }
    const request = decode(AIServiceRequestSchema, body);
    if (!request.ok)
      return sendError(res, 400, {
        code: "bad_request",
        message: "Invalid AI request",
        retryable: false,
      });
    const { requestId, action } = request.value;

    let fault: AIFault | null = null;
    if (config.debug) {
      const header = decode(AIFaultSchema, req.headers[AI_FAULT_HEADER]);
      if (header.ok) fault = header.value;
    }
    if (fault === "http_500") {
      outcomes.set(requestId, "failed");
      logger.warn("ai.fault_injected", { requestId, fault });
      return sendError(res, 500, {
        code: "unavailable",
        message: "The AI service failed (injected fault).",
        retryable: true,
      });
    }
    if (activeStreams >= config.maxConcurrentStreams)
      return sendError(res, 503, {
        code: "unavailable",
        message: "The AI service is busy. Try again in a moment.",
        retryable: true,
      });

    activeStreams++;
    outcomes.set(requestId, "streaming");
    const controller = new AbortController();
    // The response closing before we end it means the caller went away.
    res.on("close", () => {
      if (!res.writableFinished) controller.abort(new Error("Client disconnected"));
    });

    res.writeHead(200, {
      "Content-Type": `${NDJSON_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.flushHeaders();

    const stop = metrics.startTimer("ai.request.duration", { action });
    const outcome = await streamAnswer({
      provider: withFault(provider, fault, config.slowTokenMs),
      request: request.value,
      signal: controller.signal,
      write: (chunk: AIChunk) => res.write(`${JSON.stringify(chunk)}\n`),
      limits: config,
      check: (answer) => checkGrounding(answer, request.value.context).unverified,
    });
    const durationMs = Math.round(stop());
    activeStreams--;
    outcomes.set(requestId, outcome.kind);
    if (outcome.firstTokenMs !== null)
      metrics.histogram("ai.request.first_token", outcome.firstTokenMs, { action });
    if (outcome.kind === "aborted") metrics.increment("ai.request.cancelled", 1, { action });
    if (outcome.kind === "completed")
      metrics.histogram("ai.answer.unverified_claims", outcome.unverifiedClaims, { action });
    if (outcome.kind === "failed")
      metrics.increment("ai.request.failed", 1, { action, code: outcome.error.code });

    logger.info("ai.request", {
      requestId,
      action,
      outcome: outcome.kind,
      error: outcome.kind === "failed" ? outcome.error.code : undefined,
      fault: fault ?? undefined,
      unverifiedClaims:
        outcome.kind === "completed" && outcome.unverifiedClaims > 0
          ? outcome.unverifiedClaims
          : undefined,
      firstTokenMs: outcome.firstTokenMs === null ? undefined : Math.round(outcome.firstTokenMs),
      durationMs,
    });
    if (!res.writableEnded) res.end();
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://ai-service");

    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ status: "ok", model: provider.model, activeStreams }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      handleChat(req, res).catch((error: unknown) => {
        logger.error("ai.unhandled", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent)
          sendError(res, 500, {
            code: "unavailable",
            message: "The AI service failed.",
            retryable: true,
          });
        else res.end();
      });
      return;
    }

    const debug = /^\/debug\/requests\/([\w-]+)$/.exec(url.pathname);
    if (config.debug && req.method === "GET" && debug) {
      const outcome = outcomes.get(debug[1] ?? "");
      res.writeHead(outcome ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(outcome ? { outcome } : { error: "Unknown request" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return {
    server,
    get activeStreams() {
      return activeStreams;
    },
    listen(port = config.port, host = config.host): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
      });
    },
    /** Stops accepting requests; in-flight streams are cut (clients see an early close). */
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type AIService = ReturnType<typeof createAIService>;
