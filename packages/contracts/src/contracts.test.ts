import { describe, expect, it } from "vitest";
import {
  REALTIME_EVENT_TYPES,
  RealtimeEventSchema,
  decodeServerMessage,
  type RealtimeEvent,
} from "./index.ts";

const pageView = {
  type: "session.page_view",
  eventId: "evt_1",
  sequence: 1843,
  sessionId: "ses_1",
  timestamp: 1_760_000_000_000,
  payload: { path: "/pricing", title: "Pricing" },
} satisfies RealtimeEvent;

describe("RealtimeEventSchema", () => {
  it("accepts a well-formed event and narrows on `type`", () => {
    const event = RealtimeEventSchema.parse(pageView);
    if (event.type !== "session.page_view") throw new Error("expected page view");
    expect(event.payload.path).toBe("/pricing");
  });

  it("rejects unknown event types", () => {
    expect(RealtimeEventSchema.safeParse({ ...pageView, type: "session.teleport" }).success).toBe(
      false,
    );
  });

  it("rejects payloads that don't match the event type", () => {
    const wrong = { ...pageView, payload: { formId: "signup" } };
    expect(RealtimeEventSchema.safeParse(wrong).success).toBe(false);
  });

  it.each([0, -1, 1.5])("rejects invalid sequence %s", (sequence) => {
    expect(RealtimeEventSchema.safeParse({ ...pageView, sequence }).success).toBe(false);
  });

  it("exposes every event type for exhaustive tooling", () => {
    expect(REALTIME_EVENT_TYPES).toContain("session.page_view");
    expect(REALTIME_EVENT_TYPES).toContain("presence.left");
    expect(new Set(REALTIME_EVENT_TYPES).size).toBe(REALTIME_EVENT_TYPES.length);
  });
});

describe("decodeServerMessage", () => {
  it("decodes an events batch", () => {
    const result = decodeServerMessage(JSON.stringify({ type: "events", events: [pageView] }));
    expect(result).toEqual({ ok: true, value: { type: "events", events: [pageView] } });
  });

  it("returns invalid_json instead of throwing on malformed frames", () => {
    const result = decodeServerMessage("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_json");
  });

  it("returns invalid_shape when a batch contains a malformed event", () => {
    const result = decodeServerMessage(
      JSON.stringify({ type: "events", events: [{ ...pageView, eventId: "" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_shape");
  });
});
