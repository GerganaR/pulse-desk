import { AI_ACTIONS, type AIContext } from "@pulsedesk/contracts";
import { describe, expect, it } from "vitest";
import { buildMessages } from "../prompts/system.ts";
import { checkoutContext, makeRequest } from "../test/fixtures.ts";
import { composeAnswer } from "./mock-answers.ts";
import { createMockProvider, tokenize } from "./mock.provider.ts";
import { createOpenAIProvider, retryAfterMs } from "./openai.provider.ts";
import { ProviderError } from "./types.ts";

async function collect(generator: AsyncGenerator<string, unknown>) {
  const tokens: string[] = [];
  for await (const token of generator) tokens.push(token);
  return tokens;
}

const emptyContext: AIContext = {
  ...checkoutContext,
  session: { ...checkoutContext.session, status: "active", pageViews: 0 },
  events: [],
};

describe("mock provider", () => {
  it("streams the composed answer token by token, reproducibly", async () => {
    const provider = createMockProvider({ tokenMs: 1, firstTokenDelayMs: 1 });
    const request = makeRequest({ action: "summarize" });
    const first = await collect(provider.stream(request, new AbortController().signal));
    const second = await collect(provider.stream(request, new AbortController().signal));
    expect(first.length).toBeGreaterThan(10);
    expect(first.join("")).toBe(composeAnswer("summarize", checkoutContext));
    expect(second).toEqual(first);
  });

  it("stops when aborted", async () => {
    const provider = createMockProvider({ tokenMs: 20, firstTokenDelayMs: 1 });
    const controller = new AbortController();
    const tokens: string[] = [];
    await expect(async () => {
      for await (const token of provider.stream(makeRequest(), controller.signal)) {
        tokens.push(token);
        if (tokens.length === 3) controller.abort();
      }
    }).rejects.toThrow();
    expect(tokens).toHaveLength(3);
  });

  it("tokenizes without losing characters", () => {
    const text = "Line one.\n\n• a  b\n";
    expect(tokenize(text).join("")).toBe(text);
  });
});

describe("mock answers are grounded in the context", () => {
  it("summary states what happened and nothing more: a click on Upgrade is not a payment", () => {
    const answer = composeAnswer("summarize", checkoutContext);
    expect(answer).toContain("/pricing");
    expect(answer).toContain("/checkout");
    expect(answer).toContain("without success (the card was declined)");
    expect(answer).not.toMatch(/\b(paid|purchased|payment (went through|succeeded)|upgraded)\b/i);
    expect(answer).not.toMatch(/Sofia|Plovdiv/); // not in the context, never invented
  });

  it("finds the failing form as a blocker, with its latest error and time", () => {
    const answer = composeAnswer("blockers", checkoutContext);
    expect(answer).toContain(
      "The checkout form failed 2 times: the card was declined (last at 0:52)",
    );
    expect(answer).toContain("idle");
  });

  it("drafts a reply about the actual problem and marks it as a draft", () => {
    const answer = composeAnswer("suggest_reply", checkoutContext);
    expect(answer).toContain("the card was declined");
    expect(answer).toContain("Draft: review before sending.");
  });

  it("reports rage clicks and repeated errors as anomalies", () => {
    const rage: AIContext = {
      ...checkoutContext,
      events: [
        ...checkoutContext.events,
        ...[60_000, 61_000, 62_500].map((atMs) => ({
          kind: "click" as const,
          atMs,
          path: "/checkout",
          label: "Pay now",
          element: "pay",
        })),
      ],
    };
    const answer = composeAnswer("anomalies", rage);
    expect(answer).toContain('3 clicks on "Pay now" within 3 s at 1:00');
    expect(answer).toContain("Repeated errors on the checkout form (2 failed submissions)");
  });

  it("lists key events in order with offsets, skipping typing", () => {
    const answer = composeAnswer("key_events", checkoutContext);
    expect(answer.split("\n").slice(1, 4)).toEqual([
      "• 0:00  Viewed /pricing",
      '• 0:12  Clicked "Upgrade to Pro" on /pricing',
      "• 0:13  Viewed /checkout",
    ]);
    expect(answer.split("\n")).toHaveLength(8); // typing is not a key event
  });

  it("says so when there's nothing to report", () => {
    expect(composeAnswer("blockers", emptyContext)).toContain("Nothing in the recorded activity");
    expect(composeAnswer("anomalies", emptyContext)).toContain("No unusual patterns");
    expect(composeAnswer("key_events", emptyContext)).toContain("No key events");
  });

  it("mentions what it couldn't see when events were omitted", () => {
    const answer = composeAnswer("summarize", { ...checkoutContext, omittedEvents: 40 });
    expect(answer).toContain("40 earlier ones aren't included");
  });

  it.each(AI_ACTIONS)("answers %s for an empty session without inventing activity", (action) => {
    const answer = composeAnswer(action, emptyContext, "What happened?");
    expect(answer.length).toBeGreaterThan(20);
    expect(answer).not.toMatch(/submitted|clicked/i);
  });

  it("routes free-form questions by keyword, and admits its limits otherwise", () => {
    expect(composeAnswer("ask", checkoutContext, "Is the visitor stuck?")).toContain(
      "Possible blockers",
    );
    expect(composeAnswer("ask", checkoutContext, "What's the weather?")).toContain(
      "I can only answer from this session's recorded activity",
    );
  });
});

describe("prompts", () => {
  it("puts session data in a delimited block, separate from the task", () => {
    const [system, user] = buildMessages(makeRequest({ action: "ask", prompt: "Why no signup?" }));
    expect(system!.content).toContain("Use only the session data provided");
    expect(user!.content).toMatch(
      /<session>\n\{.*\}\n<\/session>\n\nTask: Answer the agent's question: Why no signup\?$/s,
    );
  });
});

function sseBody(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

describe("OpenAI-compatible provider", () => {
  const options = { apiKey: "sk-test", model: "test-model", baseUrl: "https://llm.test/v1" };

  it("sends the prompt with the key server-side and yields content deltas across split reads", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const provider = createOpenAIProvider({
      ...options,
      fetch: (url, init) => {
        sent = { url: String(url), init: init! };
        return Promise.resolve(
          new Response(
            sseBody([
              ': keep-alive\n\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"Hel',
              'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"},"finish_reason":"length"}]}\r\n\r\n',
              "data: [DONE]\n\n",
            ]),
            { status: 200 },
          ),
        );
      },
    });
    const generator = provider.stream(makeRequest(), new AbortController().signal);
    const tokens: string[] = [];
    let result = await generator.next();
    while (!result.done) {
      tokens.push(result.value);
      result = await generator.next();
    }
    expect(tokens).toEqual(["Hello", " there"]);
    expect(result.value).toBe("length");
    expect(sent!.url).toBe("https://llm.test/v1/chat/completions");
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(sent!.init.body)) as { model: string; stream: boolean };
    expect(body).toMatchObject({ model: "test-model", stream: true });
  });

  it("reports HTTP failures as provider errors with a safe message", async () => {
    const provider = createOpenAIProvider({
      ...options,
      fetch: () => Promise.resolve(new Response('{"error":"secret details"}', { status: 429 })),
    });
    const error = await collect(provider.stream(makeRequest(), new AbortController().signal)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toBe("The AI provider is rate limiting requests");
  });

  it("reads how long a rate-limiting provider asks callers to wait", async () => {
    // Gemini's OpenAI-compatible endpoint puts the wait in the error text, not a header.
    const geminiBody =
      '[{"error":{"code":429,"message":"Quota exceeded ... limit: 5\\nPlease retry in 18.995681632s."}}]';
    const provider = createOpenAIProvider({
      ...options,
      fetch: () => Promise.resolve(new Response(geminiBody, { status: 429 })),
    });
    const error = await collect(provider.stream(makeRequest(), new AbortController().signal)).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 429, retryAfterMs: 18_996 });
    expect((error as ProviderError).message).not.toContain("Quota"); // details stay private

    expect(retryAfterMs("7", "")).toBe(7_000);
    expect(retryAfterMs(null, "try later")).toBeNull();
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", "")).toBeNull();
  });

  it("rejects a malformed stream", async () => {
    const provider = createOpenAIProvider({
      ...options,
      fetch: () => Promise.resolve(new Response(sseBody(["data: {oops\n\n"]), { status: 200 })),
    });
    await expect(
      collect(provider.stream(makeRequest(), new AbortController().signal)),
    ).rejects.toThrow("malformed stream");
  });
});
