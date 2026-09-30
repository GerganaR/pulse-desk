import {
  AIChatRequestSchema,
  AIErrorResponseSchema,
  AIFaultSchema,
  AI_FAULT_HEADER,
  NDJSON_CONTENT_TYPE,
  decode,
  toAIContext,
  type AIError,
  type AIErrorResponse,
  type AIServiceRequest,
} from "@pulsedesk/contracts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionsSource } from "./data/sessions-source";
import { errorFields, log } from "./log";

export interface AIProxyDeps {
  sessions: SessionsSource;
  aiServiceUrl: string;
  /** Devtools builds only: pass the reliability panel's fault header on to ai-service. */
  forwardFaults: boolean;
  /** How long to wait for ai-service to accept the request (headers), not for the answer. */
  connectTimeoutMs?: number;
  fetch?: typeof fetch;
}

const MAX_BODY_BYTES = 8 * 1024;

function sendError(res: ServerResponse, status: number, error: AIError) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error } satisfies AIErrorResponse));
}

const badRequest = (message: string): AIError => ({
  code: "bad_request",
  message,
  retryable: false,
});
const unavailable = (message: string): AIError => ({
  code: "unavailable",
  message,
  retryable: true,
});

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * `POST /api/ai/chat`: the browser's only way to the AI service.
 *
 * 1. Validates the request (same-origin JSON, schema).
 * 2. Loads the session from the gateway and maps it with `toAIContext()`: the browser
 *    names a session, it never supplies the context.
 * 3. Streams ai-service's NDJSON response through unchanged.
 *
 * Cancellation: the browser aborting its fetch closes this response, which aborts the
 * upstream fetch, which closes ai-service's response, which aborts the provider.
 */
export async function handleAIChat(
  req: IncomingMessage,
  res: ServerResponse,
  {
    sessions,
    aiServiceUrl,
    forwardFaults,
    connectTimeoutMs = 5_000,
    fetch: fetchImpl = fetch,
  }: AIProxyDeps,
): Promise<void> {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  // CSRF: browsers label cross-site requests; a JSON body alone is not a defence.
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none")
    return sendError(res, 403, badRequest("Cross-site requests are not allowed"));
  if (!req.headers["content-type"]?.startsWith("application/json"))
    return sendError(res, 415, badRequest("Expected application/json"));

  const raw = await readBody(req);
  if (raw === null) return sendError(res, 413, badRequest("Request too large"));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return sendError(res, 400, badRequest("Body must be JSON"));
  }
  const parsed = decode(AIChatRequestSchema, json);
  if (!parsed.ok) return sendError(res, 400, badRequest("Invalid AI request"));
  const { requestId, sessionId, action, prompt } = parsed.value;

  let detail;
  try {
    detail = await sessions.getSessionDetail(sessionId, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    log.error("ai.session_unavailable", { requestId, ...errorFields(error) });
    return sendError(res, 503, unavailable("Session data is unavailable right now."));
  }
  if (!detail)
    return sendError(res, 404, {
      code: "session_not_found",
      message: "This session no longer exists.",
      retryable: false,
    });

  const body: AIServiceRequest = {
    requestId,
    action,
    prompt,
    context: toAIContext(detail.session, detail.events, { truncated: detail.truncated }),
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (forwardFaults) {
    const fault = decode(AIFaultSchema, req.headers[AI_FAULT_HEADER]);
    if (fault.ok) headers[AI_FAULT_HEADER] = fault.value;
  }

  const connectTimer = setTimeout(() => controller.abort(), connectTimeoutMs);
  let upstream: Response;
  try {
    upstream = await fetchImpl(`${aiServiceUrl}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (res.destroyed) return; // the browser cancelled first
    log.error("ai.upstream_unreachable", { requestId, ...errorFields(error) });
    return sendError(res, 503, unavailable("The AI service is unreachable."));
  } finally {
    clearTimeout(connectTimer);
  }

  if (!upstream.ok || !upstream.body) {
    const payload = decode(AIErrorResponseSchema, await upstream.json().catch(() => null));
    log.warn("ai.upstream_error", { requestId, status: upstream.status });
    return sendError(
      res,
      upstream.status === 503 ? 503 : 502,
      payload.ok ? payload.value.error : unavailable("The AI service failed."),
    );
  }

  res.writeHead(200, {
    "Content-Type": `${NDJSON_CONTENT_TYPE}; charset=utf-8`,
    "Cache-Control": "no-store",
    // Don't let a buffering reverse proxy turn the stream into one late response.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let endsWithNewline = true;
  try {
    for await (const chunk of upstream.body) {
      endsWithNewline = chunk.at(-1) === 0x0a;
      if (!res.write(chunk))
        await new Promise((resolve) => {
          res.once("drain", resolve);
          res.once("close", resolve);
        });
      if (res.destroyed) return;
    }
    res.end();
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    // ai-service went away mid-answer: finish with an error the client understands.
    log.error("ai.upstream_broken", { requestId, ...errorFields(error) });
    const failure = { type: "error", error: unavailable("The AI service stopped responding.") };
    res.end(endsWithNewline ? `${JSON.stringify(failure)}\n` : undefined);
  }
}
