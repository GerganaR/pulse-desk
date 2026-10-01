import "#zod-setup";
import * as z from "zod/mini";
import { nonNegativeInt } from "./primitives.ts";
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
    requestId: z.string().check(z.regex(/^[\w-]{8,64}$/)),
    sessionId: z.string().check(z.minLength(1), z.maxLength(128)),
    action: AIActionSchema,
    prompt: z._default(z.string().check(z.trim(), z.maxLength(MAX_AI_PROMPT_LENGTH)), ""),
  })
  .check(
    z.refine((request) => request.action !== "ask" || request.prompt.length > 0, {
      message: "A question is required",
      path: ["prompt"],
    }),
  );
export type AIChatRequest = z.input<typeof AIChatRequestSchema>;

// ─── Context: what the model is allowed to know ─────────────────────────────────

/**
 * One visitor event, reduced to what explains behaviour. Times are offsets from the
 * session start. No ids, sequences or absolute timestamps.
 */
export const AIContextEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page_view"),
    atMs: nonNegativeInt,
    path: z.string(),
    title: z.string(),
  }),
  z.strictObject({
    kind: z.literal("click"),
    atMs: nonNegativeInt,
    path: z.string(),
    label: z.string(),
    element: z.string(),
  }),
  z.strictObject({
    kind: z.literal("form_open"),
    atMs: nonNegativeInt,
    path: z.string(),
    formId: z.string(),
  }),
  z.strictObject({
    kind: z.literal("form_submit"),
    atMs: nonNegativeInt,
    formId: z.string(),
    success: z.boolean(),
    errorCode: z.nullable(z.string()),
  }),
  z.strictObject({
    kind: z.literal("typing"),
    atMs: nonNegativeInt,
    formId: z.string(),
    field: z.string(),
  }),
  z.strictObject({
    kind: z.literal("status"),
    atMs: nonNegativeInt,
    status: SessionStatusSchema,
  }),
  z.strictObject({
    kind: z.literal("closed"),
    atMs: nonNegativeInt,
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
    country: z.string().check(z.length(2)),
    referrer: z.nullable(z.string()),
    landingPath: z.string(),
    currentPath: z.string(),
    durationMs: nonNegativeInt,
    pageViews: nonNegativeInt,
  }),
  events: z.array(AIContextEventSchema).check(z.maxLength(MAX_AI_CONTEXT_EVENTS)),
  /** Events recorded for the session that aren't in `events` (older, or trimmed). */
  omittedEvents: nonNegativeInt,
});
export type AIContext = z.infer<typeof AIContextSchema>;

/** Web server → ai-service. */
export const AIServiceRequestSchema = z.strictObject({
  requestId: z.string().check(z.regex(/^[\w-]{8,64}$/)),
  action: AIActionSchema,
  prompt: z.string().check(z.maxLength(MAX_AI_PROMPT_LENGTH)),
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

// ─── Grounding: claims checked against the session ──────────────────────────────

/**
 * Outcomes an answer can claim that the session's events can confirm or refute. ai-service
 * checks every complete answer for these (see `evaluation/grounding.ts`).
 */
export const GROUNDING_CLAIM_KINDS = [
  "purchase",
  "signup",
  "form_submission",
  "error",
  "contact_request",
] as const;
export const GroundingClaimKindSchema = z.enum(GROUNDING_CLAIM_KINDS);
export type GroundingClaimKind = z.infer<typeof GroundingClaimKindSchema>;

/** A claim in an answer that the session data doesn't back up. */
export const UnverifiedClaimSchema = z.object({
  kind: GroundingClaimKindSchema,
  /** The words in the answer that make the claim (model output: render as text only). */
  quote: z.string().check(z.maxLength(300)),
  /** Why it couldn't be verified, e.g. "no checkout was submitted successfully". */
  reason: z.string().check(z.maxLength(300)),
});
export type UnverifiedClaim = z.infer<typeof UnverifiedClaimSchema>;

export const MAX_UNVERIFIED_CLAIMS = 10;

export const AIChunkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string().check(z.minLength(1)) }),
  z.object({
    type: z.literal("done"),
    finishReason: z.enum(["stop", "length"]),
    /** Which model answered, e.g. "mock" or the provider's model name. */
    model: z.string(),
    /** Claims in the complete answer that the session data doesn't support. */
    unverified: z._default(
      z.array(UnverifiedClaimSchema).check(z.maxLength(MAX_UNVERIFIED_CLAIMS)),
      [],
    ),
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
export const AIFaultSchema = z.enum(["timeout", "http_500", "slow", "ungrounded"]);
export type AIFault = z.infer<typeof AIFaultSchema>;
export const AI_FAULT_HEADER = "x-pulsedesk-ai-fault";
