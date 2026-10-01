import "#zod-setup";
import * as z from "zod/mini";
import { nonEmptyString, nonNegativeInt, urlPath } from "./primitives.ts";
import { AgentSchema, SessionSchema, SessionStatusSchema } from "./session.ts";

/**
 * Every realtime event carries the same envelope:
 *
 * - `eventId`   globally unique; used for idempotency (duplicate protection)
 * - `sequence`  monotonically increasing, contiguous position in the gateway's stream;
 *               used for ordering, gap detection and replay cursors
 * - `sessionId` the visitor session the event belongs to
 * - `timestamp` wall-clock time the event occurred (ms since epoch) — for display only,
 *               never for ordering (clocks skew; sequences don't)
 */
const envelope = {
  eventId: nonEmptyString,
  sequence: z.int().check(z.positive()),
  sessionId: nonEmptyString,
  timestamp: nonNegativeInt,
};

function defineEvent<const T extends string, P extends z.ZodMiniType>(type: T, payload: P) {
  return z.object({ ...envelope, type: z.literal(type), payload });
}

export const SessionCreatedEventSchema = defineEvent(
  "session.created",
  z.object({ session: SessionSchema }),
);

export const PageViewEventSchema = defineEvent(
  "session.page_view",
  z.object({
    path: urlPath,
    title: z.string(),
  }),
);

export const ClickEventSchema = defineEvent(
  "session.click",
  z.object({
    /** Stable element identifier, e.g. a data-track attribute. Never raw DOM/HTML. */
    element: nonEmptyString,
    /** Visible label of the clicked element, e.g. "Upgrade to Pro". */
    label: z.string(),
    path: urlPath,
  }),
);

export const FormOpenEventSchema = defineEvent(
  "session.form_open",
  z.object({
    formId: nonEmptyString,
    path: urlPath,
  }),
);

export const FormSubmitEventSchema = defineEvent(
  "session.form_submit",
  z.object({
    formId: nonEmptyString,
    success: z.boolean(),
    /** Present when `success` is false; a validation code, never user input. */
    errorCode: z.nullable(z.string()),
  }),
);

export const TypingEventSchema = defineEvent(
  "session.typing",
  z.object({
    formId: nonEmptyString,
    /** Field name only. Field *values* are never captured. */
    field: nonEmptyString,
    isTyping: z.boolean(),
  }),
);

export const SessionUpdatedEventSchema = defineEvent(
  "session.updated",
  z.object({
    status: SessionStatusSchema,
  }),
);

export const SessionClosedEventSchema = defineEvent(
  "session.closed",
  z.object({
    reason: z.enum(["navigated_away", "inactivity_timeout", "tab_closed"]),
  }),
);

export const PresenceJoinedEventSchema = defineEvent(
  "presence.joined",
  z.object({ agent: AgentSchema }),
);

export const PresenceLeftEventSchema = defineEvent(
  "presence.left",
  z.object({ agent: AgentSchema }),
);

export const RealtimeEventSchema = z.discriminatedUnion("type", [
  SessionCreatedEventSchema,
  PageViewEventSchema,
  ClickEventSchema,
  FormOpenEventSchema,
  FormSubmitEventSchema,
  TypingEventSchema,
  SessionUpdatedEventSchema,
  SessionClosedEventSchema,
  PresenceJoinedEventSchema,
  PresenceLeftEventSchema,
]);

export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
export type RealtimeEventType = RealtimeEvent["type"];
export type RealtimeEventOf<T extends RealtimeEventType> = Extract<RealtimeEvent, { type: T }>;

/**
 * Event shape before the gateway assigns its stream position. Producers (the simulator,
 * in production a browser SDK/collector) send these; only the gateway sets `sequence`.
 */
export const UnsequencedEventSchema = z.discriminatedUnion("type", [
  z.omit(SessionCreatedEventSchema, { sequence: true }),
  z.omit(PageViewEventSchema, { sequence: true }),
  z.omit(ClickEventSchema, { sequence: true }),
  z.omit(FormOpenEventSchema, { sequence: true }),
  z.omit(FormSubmitEventSchema, { sequence: true }),
  z.omit(TypingEventSchema, { sequence: true }),
  z.omit(SessionUpdatedEventSchema, { sequence: true }),
  z.omit(SessionClosedEventSchema, { sequence: true }),
  z.omit(PresenceJoinedEventSchema, { sequence: true }),
  z.omit(PresenceLeftEventSchema, { sequence: true }),
]);

export type UnsequencedEvent = z.infer<typeof UnsequencedEventSchema>;

export const REALTIME_EVENT_TYPES: readonly RealtimeEventType[] =
  RealtimeEventSchema.def.options.flatMap((option) => option.shape.type.def.values);
