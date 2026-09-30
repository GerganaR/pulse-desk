import { z } from "zod";
import { DeviceTypeSchema, SessionStatusSchema } from "./session.ts";

/**
 * AI copilot contracts.
 *
 *   browser ──AIChatRequest──► web (/api/ai/chat) ──AIServiceRequest──► ai-service
 *   browser ◄──── NDJSON AIChunk lines, streamed straight through ◄──────────┘
 *
 * The browser only names the session. The web server loads it from the gateway and maps
 * it with `toAIContext()`, so the browser can neither forge the context nor widen it.
 */

export const AI_ACTIONS = [
  "summarize",
  "blockers",
  "suggest_reply",
  "anomalies",
  "key_events",
  "ask",
] as const;
export const AIActionSchema = z.enum(AI_ACTIONS);
/** A quick action, or `ask` for a free-form prompt. */
export type AIAction = z.infer<typeof AIActionSchema>;

export const MAX_AI_PROMPT_LENGTH = 1_000;

/** Browser → web server. */
export const AIChatRequestSchema = z
  .object({
    /** Client-generated, so the browser can correlate the stream before any response. */
    requestId: z.string().regex(/^[\w-]{8,64}$/),
    sessionId: z.string().min(1).max(128),
    action: AIActionSchema,
    prompt: z.string().trim().max(MAX_AI_PROMPT_LENGTH).default(""),
  })
  .refine((request) => request.action !== "ask" || request.prompt.length > 0, {
    message: "A question is required",
    path: ["prompt"],
  });
export type AIChatRequest = z.input<typeof AIChatRequestSchema>;

// ─── Context: what the model is allowed to know ─────────────────────────────────

/**
 * One visitor event, reduced to what explains behaviour. Times are offsets from the
 * session start. No ids, sequences or absolute timestamps.
 */
export const AIContextEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page_view"),
    atMs: z.number().int().nonnegative(),
    path: z.string(),
    title: z.string(),
  }),
  z.strictObject({
    kind: z.literal("click"),
    atMs: z.number().int().nonnegative(),
    path: z.string(),
    label: z.string(),
    element: z.string(),
  }),
  z.strictObject({
    kind: z.literal("form_open"),
    atMs: z.number().int().nonnegative(),
    path: z.string(),
    formId: z.string(),
  }),
  z.strictObject({
    kind: z.literal("form_submit"),
    atMs: z.number().int().nonnegative(),
    formId: z.string(),
    success: z.boolean(),
    errorCode: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("typing"),
    atMs: z.number().int().nonnegative(),
    formId: z.string(),
    field: z.string(),
  }),
  z.strictObject({
    kind: z.literal("status"),
    atMs: z.number().int().nonnegative(),
    status: SessionStatusSchema,
  }),
  z.strictObject({
    kind: z.literal("closed"),
    atMs: z.number().int().nonnegative(),
    reason: z.enum(["navigated_away", "inactivity_timeout", "tab_closed"]),
  }),
]);
export type AIContextEvent = z.infer<typeof AIContextEventSchema>;

export const MAX_AI_CONTEXT_EVENTS = 200;

/**
 * Strict objects: an unexpected field is rejected by ai-service, not passed to a model.
 * That makes the service a second check on the privacy boundary, after `toAIContext()`.
 */
export const AIContextSchema = z.strictObject({
  session: z.strictObject({
    status: SessionStatusSchema,
    device: DeviceTypeSchema,
    browser: z.string(),
    os: z.string(),
    /** Country code only; never city, name or visitor id. */
    country: z.string().length(2),
    referrer: z.string().nullable(),
    landingPath: z.string(),
    currentPath: z.string(),
    durationMs: z.number().int().nonnegative(),
    pageViews: z.number().int().nonnegative(),
  }),
  events: z.array(AIContextEventSchema).max(MAX_AI_CONTEXT_EVENTS),
  /** Events recorded for the session that aren't in `events` (older, or trimmed). */
  omittedEvents: z.number().int().nonnegative(),
});
export type AIContext = z.infer<typeof AIContextSchema>;

/** Web server → ai-service. */
export const AIServiceRequestSchema = z.strictObject({
  requestId: z.string().regex(/^[\w-]{8,64}$/),
  action: AIActionSchema,
  prompt: z.string().max(MAX_AI_PROMPT_LENGTH),
  context: AIContextSchema,
});
export type AIServiceRequest = z.infer<typeof AIServiceRequestSchema>;

// ─── Stream: NDJSON chunks ──────────────────────────────────────────────────────

export const AIErrorCodeSchema = z.enum([
  /** No first token, or no end, within the time limit. */
  "timeout",
  /** The model provider failed or returned something unusable. */
  "provider_error",
  /** ai-service (or the proxy in front of it) couldn't be reached or failed. */
  "unavailable",
  "bad_request",
  "session_not_found",
  /** The stream broke: malformed line, or ended without `done`/`error`. */
  "protocol_error",
]);
export type AIErrorCode = z.infer<typeof AIErrorCodeSchema>;

export const AIErrorSchema = z.object({
  code: AIErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});
export type AIError = z.infer<typeof AIErrorSchema>;

export const AIChunkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string().min(1) }),
  z.object({
    type: z.literal("done"),
    finishReason: z.enum(["stop", "length"]),
    /** Which model answered, e.g. "mock" or the provider's model name. */
    model: z.string(),
  }),
  z.object({ type: z.literal("error"), error: AIErrorSchema }),
]);
export type AIChunk = z.infer<typeof AIChunkSchema>;

/** JSON body of a non-2xx response from /api/ai/chat or ai-service, before any streaming. */
export const AIErrorResponseSchema = z.object({ error: AIErrorSchema });
export type AIErrorResponse = z.infer<typeof AIErrorResponseSchema>;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

// ─── Development fault injection ────────────────────────────────────────────────

/**
 * Faults the dev reliability panel can request for AI calls. Forwarded only by devtools
 * web builds, and honoured only by an ai-service started with AI_DEBUG=1.
 */
export const AIFaultSchema = z.enum(["timeout", "http_500", "slow"]);
export type AIFault = z.infer<typeof AIFaultSchema>;
export const AI_FAULT_HEADER = "x-pulsedesk-ai-fault";
