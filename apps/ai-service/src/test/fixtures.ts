import type { AIContext, AIServiceRequest } from "@pulsedesk/contracts";
import type { AIProvider, FinishReason } from "../providers/types.ts";

/** Pricing → Upgrade → checkout that fails twice with a declined card, then idle. */
export const checkoutContext: AIContext = {
  session: {
    status: "idle",
    device: "desktop",
    browser: "Firefox",
    os: "Linux",
    country: "BG",
    referrer: "google.com",
    landingPath: "/pricing",
    currentPath: "/checkout",
    durationMs: 95_000,
    pageViews: 2,
  },
  events: [
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
    { kind: "typing", atMs: 20_000, formId: "checkout", field: "card" },
    {
      kind: "form_submit",
      atMs: 40_000,
      formId: "checkout",
      success: false,
      errorCode: "card_declined",
    },
    {
      kind: "form_submit",
      atMs: 52_000,
      formId: "checkout",
      success: false,
      errorCode: "card_declined",
    },
    { kind: "status", atMs: 95_000, status: "idle" },
  ],
  omittedEvents: 0,
};

export function makeRequest(overrides: Partial<AIServiceRequest> = {}): AIServiceRequest {
  return {
    requestId: "req_test_0001",
    action: "summarize",
    prompt: "",
    context: checkoutContext,
    ...overrides,
  };
}

/** A scripted provider that records the signal it was given. */
export function scriptedProvider(
  tokens: string[],
  { delayMs = 0, ignoreAbort = false }: { delayMs?: number; ignoreAbort?: boolean } = {},
) {
  const seen: { signal: AbortSignal | null; finished: boolean } = { signal: null, finished: false };
  const provider: AIProvider = {
    model: "scripted",
    async *stream(_request, signal): AsyncGenerator<string, FinishReason> {
      seen.signal = signal;
      for (const token of tokens) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          if (!ignoreAbort)
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(signal.reason as Error);
            });
        });
        yield token;
      }
      seen.finished = true;
      return "stop";
    },
  };
  return { provider, seen };
}
