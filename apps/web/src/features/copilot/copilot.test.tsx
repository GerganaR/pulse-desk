import {
  aiRequestFailed,
  aiRequestStarted,
  aiTextReceived,
  createPulseStore,
  type AIRequest,
} from "@pulsedesk/state";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import CopilotPanel from "./CopilotPanel";
import { CopilotTurn } from "./CopilotTurn";

const base: AIRequest = {
  id: "req_1",
  sessionId: "s1",
  action: "summarize",
  prompt: "",
  status: "streaming",
  text: "",
  error: null,
  startedAt: 1_000,
  firstTokenAt: null,
  finishedAt: null,
  attempt: 1,
  model: null,
  finishReason: null,
};

function renderTurn(overrides: Partial<AIRequest>) {
  const onCancel = vi.fn();
  const onRetry = vi.fn();
  render(
    <ol>
      <CopilotTurn request={{ ...base, ...overrides }} onCancel={onCancel} onRetry={onRetry} />
    </ol>,
  );
  return { onCancel, onRetry, item: screen.getByRole("listitem") };
}

describe("CopilotTurn states", () => {
  it("streaming: shows the question, partial text as busy, and Cancel", async () => {
    const { onCancel, item } = renderTurn({ text: "The visitor" });
    expect(item).toHaveAttribute("data-ai-status", "streaming");
    expect(within(item).getByText("Summarise this session")).toBeInTheDocument();
    expect(item.querySelector("[data-answer]")).toHaveAttribute("aria-busy", "true");
    expect(item.querySelector("[data-answer]")).toHaveTextContent("The visitor");
    await userEvent.click(within(item).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledWith("req_1");
  });

  it("streaming before the first token says it's thinking", () => {
    const { item } = renderTurn({});
    expect(item.querySelector("[data-answer]")).toHaveTextContent("Thinking");
  });

  it("done: shows model and duration, no actions", () => {
    const { item } = renderTurn({
      status: "done",
      text: "Answer.",
      finishedAt: 3_400,
      model: "mock",
      attempt: 2,
    });
    expect(within(item).getByText("mock · 2.4 s · attempt 2")).toBeInTheDocument();
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
  });

  it("failed: keeps the partial answer, explains, and offers Retry", async () => {
    const { onRetry, item } = renderTurn({
      status: "failed",
      text: "Half",
      finishedAt: 2_000,
      error: {
        code: "timeout",
        message: "The copilot didn't start answering in time.",
        retryable: true,
      },
    });
    expect(item.querySelector("[data-answer]")).toHaveTextContent("Half");
    expect(item).toHaveTextContent(
      "The copilot didn't start answering in time. The partial answer is kept above.",
    );
    await userEvent.click(within(item).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("req_1");
  });

  it("failed without a retryable error: no Retry", () => {
    const { item } = renderTurn({
      status: "failed",
      error: { code: "session_not_found", message: "Gone.", retryable: false },
    });
    expect(within(item).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("cancelled: says so and offers Retry", () => {
    const { item } = renderTurn({ status: "cancelled", text: "Some" });
    expect(item).toHaveTextContent("Cancelled. The partial answer is kept above.");
    expect(within(item).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders model output as text, never as markup", () => {
    const { item } = renderTurn({ status: "done", text: '<img src=x onerror="alert(1)">' });
    expect(item.querySelector("img")).toBeNull();
    expect(item).toHaveTextContent('<img src=x onerror="alert(1)">');
  });
});

function makeStore() {
  return createPulseStore({
    extra: {
      api: {
        fetchSessionsSnapshot: () => new Promise(() => {}),
        fetchSessionDetail: () => new Promise(() => {}),
      },
    },
  });
}

/** A fetch whose NDJSON response the test writes line by line. */
function streamingFetch() {
  const encoder = new TextEncoder();
  let push: (line: string) => void = () => {};
  let end: () => void = () => {};
  const fetch = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            push = (line) => controller.enqueue(encoder.encode(`${line}\n`));
            end = () => controller.close();
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
    ),
  );
  return { fetch, push: (line: string) => push(line), end: () => end() };
}

afterEach(() => vi.unstubAllGlobals());

describe("CopilotPanel", () => {
  it("asks via a quick action and renders the answer progressively", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    vi.stubGlobal("fetch", server.fetch);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    expect(screen.getByText(/use only this session.s recorded activity/)).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("group", { name: "Quick actions" })).getByRole("button", {
        name: "Summarise",
      }),
    );
    const turn = await screen.findByRole("listitem");
    const [url, init] = server.fetch.mock.calls[0]!;
    expect(url).toBe("/api/ai/chat");
    expect(JSON.parse(String(init.body))).toMatchObject({
      sessionId: "ses_1",
      action: "summarize",
    });

    server.push(JSON.stringify({ type: "delta", text: "A desktop " }));
    await waitFor(() => expect(turn.querySelector("[data-answer]")).toHaveTextContent("A desktop"));
    server.push(JSON.stringify({ type: "delta", text: "visitor." }));
    server.push(JSON.stringify({ type: "done", finishReason: "stop", model: "mock" }));
    server.end();

    await waitFor(() => expect(turn).toHaveAttribute("data-ai-status", "done"));
    expect(turn.querySelector("[data-answer]")).toHaveTextContent("A desktop visitor.");
    expect(screen.getByRole("status")).toHaveTextContent("Answer ready.");
  });

  it("sends a typed question on Enter, and not an empty one", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    vi.stubGlobal("fetch", server.fetch);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    const input = screen.getByRole("textbox", { name: "Ask about this session" });
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    await user.type(input, "   {Enter}");
    expect(server.fetch).not.toHaveBeenCalled();

    await user.type(input, "Why did checkout fail?{Enter}");
    expect(JSON.parse(String(server.fetch.mock.calls[0]![1].body))).toMatchObject({
      action: "ask",
      prompt: "Why did checkout fail?",
    });
    expect(input).toHaveValue("");
    expect(await screen.findByText("Why did checkout fail?")).toBeInTheDocument();
  });

  it("shows the session's existing conversation and announces a failure", () => {
    const store = makeStore();
    store.dispatch(
      aiRequestStarted({
        id: "r1",
        sessionId: "ses_1",
        action: "blockers",
        prompt: "",
        startedAt: 1,
      }),
    );
    store.dispatch(aiTextReceived({ id: "r1", text: "Partial", at: 2 }));
    store.dispatch(
      aiRequestFailed({
        id: "r1",
        at: 3,
        error: { code: "unavailable", message: "The AI service failed.", retryable: true },
      }),
    );
    render(
      <Provider store={store}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    expect(screen.getByRole("list", { name: "Copilot conversation" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Answer failed: The AI service failed.");
  });
});
