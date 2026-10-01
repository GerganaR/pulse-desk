import {
  aiRequestFailed,
  aiRequestStarted,
  aiTextReceived,
  createPulseStore,
  type AIRequest,
} from "@pulsedesk/state";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Copilot } from "./Copilot";
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
  unverified: [],
};

function renderTurn(overrides: Partial<AIRequest>) {
  const onCancel = vi.fn();
  const onRetry = vi.fn();
  render(
    <ol>
      <CopilotTurn request={{ ...base, ...overrides }} onCancel={onCancel} onRetry={onRetry} />
    </ol>,
  );
  // The turn itself: a flag's claims are list items too.
  const item = screen.getAllByRole("listitem").find((li) => li.dataset.requestId);
  if (!item) throw new Error("No turn rendered");
  return { onCancel, onRetry, item };
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

  it("failed before any text arrived: explains, without mentioning a partial answer", () => {
    const { item } = renderTurn({
      status: "failed",
      error: { code: "unavailable", message: "The AI service failed.", retryable: true },
    });
    expect(item.querySelector("[data-answer]")).toBeEmptyDOMElement();
    expect(item).toHaveTextContent("The AI service failed.");
    expect(item).not.toHaveTextContent("partial answer");
    expect(item.querySelector("[data-answer]")).not.toHaveAttribute("aria-busy");
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

  it("cancelled before any text arrived: just says so", () => {
    const { item } = renderTurn({ status: "cancelled" });
    expect(item).toHaveTextContent("Cancelled.");
    expect(item).not.toHaveTextContent("partial answer");
  });

  it("done but cut short by the output limit: says the answer is incomplete", () => {
    const { item } = renderTurn({
      status: "done",
      text: "The visitor opened pricing and then",
      finishedAt: 1_900,
      model: "mock",
      finishReason: "length",
    });
    expect(within(item).getByText(/mock · 900 ms/)).toHaveTextContent(
      "stopped at the length limit",
    );
  });

  it("a typed question is shown as asked; a quick action as its full question", () => {
    const typed = renderTurn({ action: "ask", prompt: "Why did checkout fail?" });
    expect(within(typed.item).getByText("Why did checkout fail?")).toBeInTheDocument();
    cleanup();
    const quick = renderTurn({ action: "suggest_reply" });
    expect(within(quick.item).getByText("Suggest a reply to the visitor")).toBeInTheDocument();
  });

  it("done with unverified claims: keeps the answer and flags each claim with its reason", () => {
    const { item } = renderTurn({
      status: "done",
      text: "They viewed pricing.\n\nThe visitor completed the payment.",
      finishedAt: 2_000,
      model: "mock",
      unverified: [
        {
          kind: "purchase",
          quote: "The visitor completed the payment",
          reason: "no checkout or payment form was submitted successfully",
        },
      ],
    });
    expect(item.querySelector("[data-answer]")).toHaveTextContent("completed the payment");
    const flag = item.querySelector("[data-unverified-claims]");
    expect(flag).toHaveAttribute("data-unverified-claims", "1");
    expect(flag).toHaveTextContent("Couldn't verify against this session's events:");
    expect(within(flag as HTMLElement).getByRole("listitem")).toHaveTextContent(
      "The visitor completed the payment: no checkout or payment form was submitted successfully.",
    );
  });

  it("done without unverified claims: no flag", () => {
    const { item } = renderTurn({ status: "done", text: "Fine.", finishedAt: 2_000 });
    expect(item.querySelector("[data-unverified-claims]")).toBeNull();
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

  it("flags and announces claims the service couldn't verify", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    vi.stubGlobal("fetch", server.fetch);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Summarise" }));
    const turn = await screen.findByRole("listitem");
    server.push(JSON.stringify({ type: "delta", text: "They upgraded to Pro." }));
    server.push(
      JSON.stringify({
        type: "done",
        finishReason: "stop",
        model: "mock",
        unverified: [
          {
            kind: "purchase",
            quote: "They upgraded to Pro",
            reason: "no checkout or payment form was submitted successfully",
          },
        ],
      }),
    );
    server.end();

    await waitFor(() => expect(turn).toHaveAttribute("data-ai-status", "done"));
    expect(turn.querySelector("[data-unverified-claims]")).toHaveTextContent(
      "They upgraded to Pro",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Answer ready. 1 claim couldn't be verified against the session.",
    );
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

  it("Shift+Enter adds a line instead of sending", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    vi.stubGlobal("fetch", server.fetch);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    const input = screen.getByRole("textbox", { name: "Ask about this session" });
    await user.type(input, "First line{Shift>}{Enter}{/Shift}second line");
    expect(server.fetch).not.toHaveBeenCalled();
    expect(input).toHaveValue("First line\nsecond line");
  });

  it("Cancel stops the request, keeps what arrived and announces it", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    vi.stubGlobal("fetch", server.fetch);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Key events" }));
    const turn = await screen.findByRole("listitem");
    server.push(JSON.stringify({ type: "delta", text: "1. Landed on /pricing" }));
    await waitFor(() => expect(turn.querySelector("[data-answer]")).toHaveTextContent("Landed"));
    expect(screen.getByRole("status")).toBeEmptyDOMElement(); // streaming isn't announced

    await user.click(within(turn).getByRole("button", { name: "Cancel" }));
    expect(turn).toHaveAttribute("data-ai-status", "cancelled");
    expect(turn.querySelector("[data-answer]")).toHaveTextContent("1. Landed on /pricing");
    expect(server.fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Answer cancelled.");
    expect(within(turn).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("Retry asks the same question again and replaces the failed attempt", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    const failing = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: { code: "unavailable", message: "The AI service failed.", retryable: true } },
          { status: 502 },
        ),
      ),
    );
    vi.stubGlobal("fetch", failing);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "What's blocking?" }));
    const failed = await screen.findByRole("listitem");
    await waitFor(() => expect(failed).toHaveAttribute("data-ai-status", "failed"));
    expect(failed).toHaveTextContent("The AI service failed.");

    vi.stubGlobal("fetch", server.fetch);
    await user.click(within(failed).getByRole("button", { name: "Retry" }));
    expect(JSON.parse(String(server.fetch.mock.calls[0]![1].body))).toMatchObject({
      sessionId: "ses_1",
      action: "blockers",
    });
    server.push(JSON.stringify({ type: "delta", text: "Nothing is blocking." }));
    server.push(JSON.stringify({ type: "done", finishReason: "stop", model: "mock" }));
    server.end();

    await waitFor(() =>
      expect(screen.getByRole("listitem")).toHaveAttribute("data-ai-status", "done"),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1); // one turn, not two
    expect(screen.getByRole("listitem")).toHaveTextContent("attempt 2");
    expect(screen.getByRole("status")).toHaveTextContent("Answer ready.");
  });

  it("several unverified claims are announced as a count", async () => {
    const user = userEvent.setup();
    const server = streamingFetch();
    vi.stubGlobal("fetch", server.fetch);
    render(
      <Provider store={makeStore()}>
        <CopilotPanel sessionId="ses_1" />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Summarise" }));
    await screen.findByText("Summarise this session");
    server.push(JSON.stringify({ type: "delta", text: "They paid and signed up." }));
    server.push(
      JSON.stringify({
        type: "done",
        finishReason: "stop",
        model: "mock",
        unverified: [
          { kind: "purchase", quote: "They paid", reason: "no payment form was submitted" },
          { kind: "signup", quote: "signed up", reason: "no signup form was submitted" },
        ],
      }),
    );
    server.end();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Answer ready. 2 claims couldn't be verified against the session.",
      ),
    );
  });
});

describe("Copilot (the session page's column)", () => {
  it("server-renders a placeholder only: no controls that can't work yet", () => {
    const html = renderToString(
      <Provider store={makeStore()}>
        <Copilot sessionId="ses_1" />
      </Provider>,
    );
    const page = document.createElement("div");
    page.innerHTML = html;
    expect(within(page).getByRole("heading", { name: "Copilot" })).toHaveTextContent("Copilot");
    expect(within(page).queryByRole("button")).toBeNull();
    expect(within(page).queryByRole("textbox")).toBeNull();
  });

  it("loads the conversation and composer in the browser", async () => {
    render(
      <Provider store={makeStore()}>
        <Copilot sessionId="ses_1" />
      </Provider>,
    );
    const region = screen.getByRole("region", { name: "Copilot" });
    expect(await within(region).findByRole("group", { name: "Quick actions" })).toBeInTheDocument();
    expect(within(region).getByRole("textbox", { name: "Ask about this session" })).toBeEnabled();
  });
});
