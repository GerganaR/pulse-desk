import { describe, expect, it } from "vitest";
import {
  AIChatRequestSchema,
  AIChunkSchema,
  AIContextSchema,
  MAX_AI_CONTEXT_EVENTS,
  toAIContext,
  type RealtimeEvent,
  type RealtimeEventOf,
  type RealtimeEventType,
  type Session,
} from "./index.ts";

const T0 = 1_760_000_000_000;

const session: Session = {
  id: "ses_secret_session_id",
  visitor: {
    id: "vis_secret_visitor_id",
    label: "Visitor #3291",
    name: "Sofia Ivanova",
    country: "BG",
    city: "Plovdiv",
  },
  device: "desktop",
  browser: "Firefox",
  os: "Linux",
  referrer: "google.com",
  landingPath: "/pricing",
  currentPath: "/checkout",
  status: "active",
  startedAt: T0,
  lastActivityAt: T0 + 95_000,
  endedAt: null,
  pageViews: 3,
  eventCount: 9,
};

let seq = 1_000;
function event<T extends RealtimeEventType>(
  type: T,
  payload: RealtimeEventOf<T>["payload"],
  offsetMs: number,
): RealtimeEvent {
  seq++;
  return {
    type,
    payload,
    eventId: `evt_secret_${seq}`,
    sequence: seq,
    sessionId: session.id,
    timestamp: T0 + offsetMs,
  } as RealtimeEvent;
}

const events: RealtimeEvent[] = [
  event("session.created", { session }, 0),
  event("session.page_view", { path: "/pricing", title: "Pricing" }, 0),
  event("presence.joined", { agent: { id: "agt_secret", name: "Jordan Agent" } }, 2_000),
  event(
    "session.click",
    { element: "cta_upgrade_pro", label: "Upgrade to Pro", path: "/pricing" },
    12_000,
  ),
  event("session.page_view", { path: "/checkout", title: "Checkout" }, 13_000),
  event("session.form_open", { formId: "checkout", path: "/checkout" }, 14_000),
  event("session.typing", { formId: "checkout", field: "card", isTyping: true }, 20_000),
  event("session.typing", { formId: "checkout", field: "card", isTyping: false }, 22_000),
  event("session.typing", { formId: "checkout", field: "card", isTyping: true }, 23_000),
  event(
    "session.form_submit",
    { formId: "checkout", success: false, errorCode: "card_declined" },
    40_000,
  ),
  event("session.updated", { status: "idle" }, 95_000),
];

describe("toAIContext (privacy boundary)", () => {
  const context = toAIContext(session, events);
  const serialised = JSON.stringify(context);

  it.each([
    ["session id", session.id],
    ["visitor id", session.visitor.id],
    ["visitor name", "Sofia"],
    ["visitor label", "3291"],
    ["city", "Plovdiv"],
    ["event ids", "evt_secret"],
    ["agent presence", "Jordan"],
    ["agent id", "agt_secret"],
  ])("never includes the %s", (_what, value) => {
    expect(serialised).not.toContain(value);
  });

  it("contains no sequence numbers or absolute timestamps", () => {
    for (const item of context.events) {
      expect(item).not.toHaveProperty("sequence");
      expect(item).not.toHaveProperty("timestamp");
    }
    expect(serialised).not.toContain(String(T0).slice(0, 6));
    expect(serialised).not.toMatch(/"sequence"|"eventId"|"sessionId"/);
  });

  it("keeps the facts that explain behaviour, with times relative to the session start", () => {
    expect(context.session).toEqual({
      status: "active",
      device: "desktop",
      browser: "Firefox",
      os: "Linux",
      country: "BG",
      referrer: "google.com",
      landingPath: "/pricing",
      currentPath: "/checkout",
      durationMs: 95_000,
      pageViews: 3,
    });
    expect(context.events).toEqual([
      { kind: "page_view", atMs: 0, path: "/pricing", title: "Pricing" },
      {
        kind: "click",
        atMs: 12_000,
        path: "/pricing",
        label: "Upgrade to Pro",
        element: "cta_upgrade_pro",
      },
      { kind: "page_view", atMs: 13_000, path: "/checkout", title: "Checkout" },
      { kind: "form_open", atMs: 14_000, path: "/checkout", formId: "checkout" },
      // "stopped typing" dropped, and the repeat in the same field collapsed
      { kind: "typing", atMs: 20_000, formId: "checkout", field: "card" },
      {
        kind: "form_submit",
        atMs: 40_000,
        formId: "checkout",
        success: false,
        errorCode: "card_declined",
      },
      { kind: "status", atMs: 95_000, status: "idle" },
    ]);
    expect(context.omittedEvents).toBe(0);
  });

  it("produces exactly the shape ai-service accepts (strict: no extra fields)", () => {
    expect(AIContextSchema.safeParse(context).success).toBe(true);
    const leaky = { ...context, session: { ...context.session, city: "Plovdiv" } };
    expect(AIContextSchema.safeParse(leaky).success).toBe(false);
    const leakyEvent = { ...context, events: [{ ...context.events[0], sequence: 7 }] };
    expect(AIContextSchema.safeParse(leakyEvent).success).toBe(false);
  });

  it("ignores fields added to the input later (allowlist, not spread)", () => {
    const extended = { ...session, visitor: { ...session.visitor, email: "sofia@example.com" } };
    expect(JSON.stringify(toAIContext(extended, events))).not.toContain("sofia@example.com");
  });

  it("keeps the most recent events and counts what it left out", () => {
    const many = Array.from({ length: MAX_AI_CONTEXT_EVENTS + 25 }, (_, i) =>
      event("session.page_view", { path: `/p${i}`, title: `Page ${i}` }, i * 1_000),
    );
    const trimmed = toAIContext({ ...session, eventCount: many.length }, many);
    expect(trimmed.events).toHaveLength(MAX_AI_CONTEXT_EVENTS);
    expect(trimmed.events.at(-1)).toMatchObject({ path: `/p${MAX_AI_CONTEXT_EVENTS + 24}` });
    expect(trimmed.omittedEvents).toBe(25);
  });

  it("counts older events the snapshot didn't include when it was truncated", () => {
    const truncated = toAIContext({ ...session, eventCount: 40 }, events, { truncated: true });
    // 40 recorded visitor events, 8 of them in the snapshot
    expect(truncated.omittedEvents).toBe(32);
  });
});

describe("AI request and chunk schemas", () => {
  it("requires a question for free-form requests only", () => {
    const base = { requestId: "req_12345678", sessionId: "ses_1" };
    expect(AIChatRequestSchema.safeParse({ ...base, action: "summarize" }).success).toBe(true);
    expect(AIChatRequestSchema.safeParse({ ...base, action: "ask", prompt: "  " }).success).toBe(
      false,
    );
    expect(AIChatRequestSchema.safeParse({ ...base, action: "ask", prompt: "Why?" }).success).toBe(
      true,
    );
  });

  it("rejects request ids that could be abused in headers or logs", () => {
    expect(
      AIChatRequestSchema.safeParse({
        requestId: "bad id\nX-Injected: 1",
        sessionId: "ses_1",
        action: "summarize",
      }).success,
    ).toBe(false);
  });

  it("accepts each chunk type and rejects empty deltas", () => {
    expect(AIChunkSchema.safeParse({ type: "delta", text: "Hi" }).success).toBe(true);
    expect(AIChunkSchema.safeParse({ type: "delta", text: "" }).success).toBe(false);
    expect(
      AIChunkSchema.safeParse({ type: "done", finishReason: "stop", model: "mock" }).success,
    ).toBe(true);
    expect(
      AIChunkSchema.safeParse({
        type: "error",
        error: { code: "timeout", message: "Too slow", retryable: true },
      }).success,
    ).toBe(true);
  });
});
