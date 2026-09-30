import { MAX_AI_CONTEXT_EVENTS, type AIContext, type AIContextEvent } from "./ai.ts";
import { assertNever } from "./decode.ts";
import type { RealtimeEvent } from "./events.ts";
import { isVisitorActivity } from "./projection.ts";
import type { Session } from "./session.ts";

/**
 * The privacy boundary between session data and an AI model.
 *
 * Builds the context field by field from an allowlist; nothing is spread from the input,
 * so a field added to `Session` or an event later can't leak into prompts by accident.
 *
 * Left out on purpose:
 * - identifiers: session, visitor and event ids, stream sequences (no use to a model, and
 *   they'd let answers be joined back to people);
 * - the visitor's name and city (country is kept for context such as time zone);
 * - absolute timestamps (offsets from the session start carry the same behaviour);
 * - agent presence (it describes the support team, not the visitor);
 * - "stopped typing" events (noise; consecutive typing in one field is collapsed).
 *
 * Keeps the most recent `MAX_AI_CONTEXT_EVENTS` events and reports how many it left out.
 */
export function toAIContext(
  session: Session,
  events: readonly RealtimeEvent[],
  { truncated = false }: { truncated?: boolean } = {},
): AIContext {
  const at = (timestamp: number) => Math.max(0, Math.round(timestamp - session.startedAt));

  const mapped: AIContextEvent[] = [];
  for (const event of events) {
    const item = toContextEvent(event, at(event.timestamp));
    if (!item) continue;
    const previous = mapped.at(-1);
    if (
      item.kind === "typing" &&
      previous?.kind === "typing" &&
      previous.formId === item.formId &&
      previous.field === item.field
    )
      continue;
    mapped.push(item);
  }

  const kept = mapped.slice(-MAX_AI_CONTEXT_EVENTS);
  // Events the snapshot itself didn't include (the gateway keeps a bounded timeline).
  const olderEvents = truncated
    ? Math.max(0, session.eventCount - events.filter(isVisitorActivity).length)
    : 0;

  return {
    session: {
      status: session.status,
      device: session.device,
      browser: session.browser,
      os: session.os,
      country: session.visitor.country,
      referrer: session.referrer,
      landingPath: session.landingPath,
      currentPath: session.currentPath,
      durationMs: Math.max(0, (session.endedAt ?? session.lastActivityAt) - session.startedAt),
      pageViews: session.pageViews,
    },
    events: kept,
    omittedEvents: mapped.length - kept.length + olderEvents,
  };
}

function toContextEvent(event: RealtimeEvent, atMs: number): AIContextEvent | null {
  switch (event.type) {
    case "session.page_view":
      return { kind: "page_view", atMs, path: event.payload.path, title: event.payload.title };
    case "session.click":
      return {
        kind: "click",
        atMs,
        path: event.payload.path,
        label: event.payload.label,
        element: event.payload.element,
      };
    case "session.form_open":
      return { kind: "form_open", atMs, path: event.payload.path, formId: event.payload.formId };
    case "session.form_submit":
      return {
        kind: "form_submit",
        atMs,
        formId: event.payload.formId,
        success: event.payload.success,
        errorCode: event.payload.errorCode,
      };
    case "session.typing":
      return event.payload.isTyping
        ? { kind: "typing", atMs, formId: event.payload.formId, field: event.payload.field }
        : null;
    case "session.updated":
      return { kind: "status", atMs, status: event.payload.status };
    case "session.closed":
      return { kind: "closed", atMs, reason: event.payload.reason };
    case "session.created":
    case "presence.joined":
    case "presence.left":
      return null;
    default:
      return assertNever(event, "event type");
  }
}
