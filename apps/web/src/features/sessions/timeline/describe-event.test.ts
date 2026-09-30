import type { RealtimeEvent } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import { describe, expect, it } from "vitest";
import { currentAgent } from "@/lib/current-agent";
import { describeEvent } from "./describe-event";

const base = { eventId: "e", sequence: 1, sessionId: "s", timestamp: 1_000_000 };

describe("describeEvent", () => {
  it("says a session was joined in progress when monitoring started late", () => {
    const late = {
      ...base,
      type: "session.created",
      payload: { session: makeSession({ startedAt: 900_000 }) },
    } as RealtimeEvent;
    const fresh = {
      ...base,
      type: "session.created",
      payload: { session: makeSession({ startedAt: 999_000 }) },
    } as RealtimeEvent;
    expect(describeEvent(late)?.title).toBe("Joined session in progress");
    expect(describeEvent(fresh)?.title).toBe("Session started");
  });

  it("hides 'stopped typing' noise but shows typing starts without any field values", () => {
    const typing = (isTyping: boolean) =>
      ({
        ...base,
        type: "session.typing",
        payload: { formId: "signup", field: "work_email", isTyping },
      }) as RealtimeEvent;
    expect(describeEvent(typing(false))).toBeNull();
    expect(describeEvent(typing(true))?.title).toBe("Typing in work email");
  });

  it("explains failed submissions with the error code", () => {
    const failed = {
      ...base,
      type: "session.form_submit",
      payload: { formId: "checkout", success: false, errorCode: "card_declined" },
    } as RealtimeEvent;
    expect(describeEvent(failed)).toMatchObject({
      title: "Checkout submission failed",
      detail: "card declined",
      tone: "danger",
    });
  });

  it("refers to the current agent as You", () => {
    const joined = (agent: { id: string; name: string }) =>
      ({ ...base, type: "presence.joined", payload: { agent } }) as RealtimeEvent;
    expect(describeEvent(joined(currentAgent))?.title).toBe("You started viewing");
    expect(describeEvent(joined({ id: "other", name: "Sam" }))?.title).toBe("Sam started viewing");
  });
});
