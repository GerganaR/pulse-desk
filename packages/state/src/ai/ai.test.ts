import { describe, expect, it } from "vitest";
import { createPulseStore } from "../store.ts";
import {
  MAX_CONVERSATION_TURNS,
  aiRequestCancelled,
  aiRequestCompleted,
  aiRequestFailed,
  aiRequestStarted,
  aiTextReceived,
  selectAIAnswersGenerated,
  selectAIRequest,
  selectConversation,
  type AIRequestStartedPayload,
} from "./ai.slice.ts";

const api = {
  fetchSessionsSnapshot: () => Promise.reject(new Error("unused")),
  fetchSessionDetail: () => Promise.reject(new Error("unused")),
};

function setup() {
  const store = createPulseStore({ extra: { api } });
  const start = (overrides: Partial<AIRequestStartedPayload> = {}) =>
    store.dispatch(
      aiRequestStarted({
        id: "r1",
        sessionId: "s1",
        action: "summarize",
        prompt: "",
        startedAt: 1_000,
        ...overrides,
      }),
    );
  return { store, start, get: (id = "r1") => selectAIRequest(store.getState(), id) };
}

const timeout = { code: "timeout", message: "Too slow", retryable: true } as const;

describe("ai slice", () => {
  it("runs the lifecycle: streaming → text → done, with timings", () => {
    const { store, start, get } = setup();
    start();
    expect(get()).toMatchObject({ status: "streaming", text: "", attempt: 1 });

    store.dispatch(aiTextReceived({ id: "r1", text: "Hello ", at: 1_400 }));
    store.dispatch(aiTextReceived({ id: "r1", text: "there.", at: 1_450 }));
    store.dispatch(
      aiRequestCompleted({ id: "r1", at: 2_000, model: "mock", finishReason: "stop" }),
    );

    expect(get()).toMatchObject({
      status: "done",
      text: "Hello there.",
      firstTokenAt: 1_400,
      finishedAt: 2_000,
      model: "mock",
    });
    expect(selectAIAnswersGenerated(store.getState())).toBe(1);
  });

  it("keeps the partial answer when the request fails or is cancelled", () => {
    const { store, start, get } = setup();
    start();
    start({ id: "r2" });
    store.dispatch(aiTextReceived({ id: "r1", text: "Partial", at: 1_100 }));
    store.dispatch(aiTextReceived({ id: "r2", text: "Also partial", at: 1_100 }));
    store.dispatch(aiRequestFailed({ id: "r1", at: 1_500, error: timeout }));
    store.dispatch(aiRequestCancelled({ id: "r2", at: 1_600 }));

    expect(get("r1")).toMatchObject({ status: "failed", text: "Partial", error: timeout });
    expect(get("r2")).toMatchObject({ status: "cancelled", text: "Also partial" });
    expect(selectAIAnswersGenerated(store.getState())).toBe(0);
  });

  it("ignores chunks that arrive after the request ended", () => {
    const { store, start, get } = setup();
    start();
    store.dispatch(aiTextReceived({ id: "r1", text: "Kept", at: 1_100 }));
    store.dispatch(aiRequestCancelled({ id: "r1", at: 1_200 }));
    store.dispatch(aiTextReceived({ id: "r1", text: " late", at: 1_300 }));
    store.dispatch(
      aiRequestCompleted({ id: "r1", at: 1_400, model: "mock", finishReason: "stop" }),
    );
    store.dispatch(aiRequestFailed({ id: "r1", at: 1_500, error: timeout }));
    expect(get()).toMatchObject({ status: "cancelled", text: "Kept", finishedAt: 1_200 });
  });

  it("retry creates a new attempt in the same place in the conversation", () => {
    const { store, start, get } = setup();
    start({ id: "r1" });
    start({ id: "r2", action: "ask", prompt: "Why?" });
    store.dispatch(aiRequestFailed({ id: "r1", at: 1_500, error: timeout }));

    start({ id: "r3", retryOf: "r1", startedAt: 2_000 });

    expect(get("r3")).toMatchObject({
      status: "streaming",
      attempt: 2,
      action: "summarize",
      text: "",
      startedAt: 2_000,
    });
    expect(get("r1")).toBeUndefined();
    expect(selectConversation(store.getState(), "s1").map((r) => r.id)).toEqual(["r3", "r2"]);
  });

  it("doesn't retry a request that is still streaming", () => {
    const { store, start } = setup();
    start({ id: "r1" });
    start({ id: "r2", retryOf: "r1" });
    expect(selectConversation(store.getState(), "s1").map((r) => r.id)).toEqual(["r1"]);
  });

  it("keeps conversations per session, with several requests in flight", () => {
    const { store, start } = setup();
    start({ id: "a1", sessionId: "a" });
    start({ id: "b1", sessionId: "b" });
    start({ id: "a2", sessionId: "a" });
    const state = store.getState();
    expect(selectConversation(state, "a").map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(selectConversation(state, "b").map((r) => r.id)).toEqual(["b1"]);
    expect(selectConversation(state, "none")).toBe(selectConversation(state, "other"));
  });

  it("drops the oldest finished turns past the limit, never a streaming one", () => {
    const { store, start } = setup();
    start({ id: "keep-streaming" });
    for (let i = 0; i < MAX_CONVERSATION_TURNS; i++) {
      start({ id: `r${i}` });
      store.dispatch(aiRequestCancelled({ id: `r${i}`, at: 2_000 }));
    }
    const ids = selectConversation(store.getState(), "s1").map((r) => r.id);
    expect(ids).toHaveLength(MAX_CONVERSATION_TURNS);
    expect(ids[0]).toBe("keep-streaming");
    expect(ids).not.toContain("r0");
    expect(selectAIRequest(store.getState(), "r0")).toBeUndefined();
  });
});
