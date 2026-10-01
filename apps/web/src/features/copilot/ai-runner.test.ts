// @vitest-environment node
import type { AIChatRequest, AIChunk } from "@pulsedesk/contracts";
import { createMemorySink, createMetrics } from "@pulsedesk/observability";
import { createPulseStore, selectAIRequest, selectConversation } from "@pulsedesk/state";
import { describe, expect, it } from "vitest";
import { createAIRunner } from "./ai-runner";
import { AIStreamError, type StreamAIChatOptions } from "./stream-client";

type Chunk = Extract<AIChunk, { type: "delta" | "done" }>;

/** A controllable stream: the test pushes chunks, ends or fails it. */
function controllableStream() {
  const calls: { request: AIChatRequest; options: StreamAIChatOptions }[] = [];
  const queues: {
    push: (chunk: Chunk) => void;
    fail: (error: unknown) => void;
  }[] = [];

  async function* stream(request: AIChatRequest, options: StreamAIChatOptions) {
    calls.push({ request, options });
    const buffer: (Chunk | { error: unknown })[] = [];
    let wake: (() => void) | null = null;
    queues.push({
      push: (chunk) => {
        buffer.push(chunk);
        wake?.();
      },
      fail: (error) => {
        buffer.push({ error });
        wake?.();
      },
    });
    options.signal.addEventListener("abort", () => {
      buffer.push({ error: options.signal.reason });
      wake?.();
    });
    for (;;) {
      while (buffer.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const next = buffer.shift()!;
      if ("error" in next) throw next.error;
      yield next;
      if (next.type === "done") return;
    }
  }
  return { stream, calls, queues };
}

function setup() {
  const store = createPulseStore({
    extra: {
      api: {
        fetchSessionsSnapshot: () => Promise.reject(new Error("unused")),
        fetchSessionDetail: () => Promise.reject(new Error("unused")),
      },
    },
  });
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  let clock = 1_000;
  let nextId = 1;
  const { stream, calls, queues } = controllableStream();
  const sink = createMemorySink();
  const runner = createAIRunner({
    dispatch: store.dispatch,
    getState: store.getState,
    stream,
    scheduleFrame: (callback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    },
    cancelFrame: (handle) => frames.delete(handle),
    now: () => clock,
    metrics: createMetrics(sink),
    getHeaders: () => ({ "x-pulsedesk-ai-fault": "slow" }),
    createId: () => `req_${nextId++}`,
  });
  const runFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    store,
    runner,
    calls,
    queues,
    sink,
    runFrame,
    settle,
    frames,
    tick: (ms: number) => (clock += ms),
    get: (id: string) => selectAIRequest(store.getState(), id),
  };
}

const done: Chunk = { type: "done", finishReason: "stop", model: "mock", unverified: [] };

describe("AI runner", () => {
  it("batches streamed text into one update per frame", async () => {
    const t = setup();
    const id = t.runner.ask({ sessionId: "s1", action: "summarize" });
    expect(t.get(id)).toMatchObject({ status: "streaming", startedAt: 1_000 });
    await t.settle();

    t.tick(300);
    t.queues[0]!.push({ type: "delta", text: "One " });
    t.queues[0]!.push({ type: "delta", text: "two " });
    t.queues[0]!.push({ type: "delta", text: "three" });
    await t.settle();
    expect(t.get(id)!.text).toBe(""); // nothing rendered until the frame
    expect(t.frames.size).toBe(1); // one frame scheduled for all three

    t.runFrame();
    expect(t.get(id)).toMatchObject({ text: "One two three", firstTokenAt: 1_300 });

    t.queues[0]!.push({ type: "delta", text: "." });
    t.queues[0]!.push(done);
    await t.settle();
    // `done` flushes without waiting for a frame
    expect(t.get(id)).toMatchObject({ status: "done", text: "One two three.", model: "mock" });
    expect(t.frames.size).toBe(0);
    expect(t.sink.get("ai.request.first_token")?.last).toBe(300);
    expect(t.sink.get("ai.request.duration")?.count).toBe(1);
  });

  it("stores the claims the service couldn't verify with the finished answer", async () => {
    const t = setup();
    const id = t.runner.ask({ sessionId: "s1", action: "summarize" });
    await t.settle();
    const claim = { kind: "purchase", quote: "They paid", reason: "no payment" } as const;
    t.queues[0]!.push({ type: "delta", text: "They paid." });
    t.queues[0]!.push({ ...done, unverified: [claim] });
    await t.settle();
    expect(t.get(id)).toMatchObject({ status: "done", unverified: [claim] });
  });

  it("sends the request with the session, action and extra headers", async () => {
    const t = setup();
    t.runner.ask({ sessionId: "s1", action: "ask", prompt: "Why?" });
    await t.settle();
    expect(t.calls[0]!.request).toEqual({
      requestId: "req_1",
      sessionId: "s1",
      action: "ask",
      prompt: "Why?",
    });
    expect(t.calls[0]!.options.headers).toEqual({ "x-pulsedesk-ai-fault": "slow" });
  });

  it("cancel keeps everything that arrived and aborts the stream", async () => {
    const t = setup();
    const id = t.runner.ask({ sessionId: "s1", action: "summarize" });
    await t.settle();
    t.queues[0]!.push({ type: "delta", text: "Partial" });
    await t.settle();

    t.runner.cancel(id); // before the frame: the buffered text must not be lost
    expect(t.get(id)).toMatchObject({ status: "cancelled", text: "Partial" });
    expect(t.calls[0]!.options.signal.aborted).toBe(true);
    await t.settle();
    t.runFrame();
    expect(t.get(id)).toMatchObject({ status: "cancelled", text: "Partial" });
    expect(t.sink.get("ai.request.cancelled")?.count).toBe(1);
    expect(t.sink.get("ai.request.failed")).toBeUndefined();
  });

  it("a failure keeps the partial answer and records the error", async () => {
    const t = setup();
    const id = t.runner.ask({ sessionId: "s1", action: "summarize" });
    await t.settle();
    t.queues[0]!.push({ type: "delta", text: "Half an" });
    t.queues[0]!.fail(new AIStreamError({ code: "timeout", message: "Too slow", retryable: true }));
    await t.settle();
    expect(t.get(id)).toMatchObject({
      status: "failed",
      text: "Half an",
      error: { code: "timeout", message: "Too slow" },
    });
    expect(t.sink.get("ai.request.failed")?.count).toBe(1);
  });

  it("retry starts a new attempt of the same question in place", async () => {
    const t = setup();
    const first = t.runner.ask({ sessionId: "s1", action: "blockers" });
    await t.settle();
    t.queues[0]!.fail(new AIStreamError({ code: "unavailable", message: "Down", retryable: true }));
    await t.settle();

    const second = t.runner.retry(first)!;
    await t.settle();
    expect(t.get(second)).toMatchObject({ status: "streaming", attempt: 2, action: "blockers" });
    expect(t.calls[1]!.request).toMatchObject({ requestId: second, action: "blockers" });
    expect(selectConversation(t.store.getState(), "s1").map((r) => r.id)).toEqual([second]);

    t.queues[1]!.push({ type: "delta", text: "Fine now." });
    t.queues[1]!.push(done);
    await t.settle();
    expect(t.get(second)).toMatchObject({ status: "done", text: "Fine now." });
    expect(t.runner.retry(second)).toBeNull(); // nothing to retry
  });

  it("runs several requests at once, independently", async () => {
    const t = setup();
    const a = t.runner.ask({ sessionId: "s1", action: "summarize" });
    const b = t.runner.ask({ sessionId: "s1", action: "key_events" });
    await t.settle();
    t.queues[1]!.push({ type: "delta", text: "B" });
    t.queues[1]!.push(done);
    t.queues[0]!.push({ type: "delta", text: "A" });
    await t.settle();
    t.runner.cancel(a);
    expect(t.get(a)).toMatchObject({ status: "cancelled", text: "A" });
    expect(t.get(b)).toMatchObject({ status: "done", text: "B" });
  });

  it("treats unexpected errors as retryable failures", async () => {
    const t = setup();
    const id = t.runner.ask({ sessionId: "s1", action: "summarize" });
    await t.settle();
    t.queues[0]!.fail(new Error("boom"));
    await t.settle();
    expect(t.get(id)!.error).toMatchObject({ code: "unavailable", retryable: true });
  });
});
