import { MAX_AI_PROMPT_LENGTH } from "@pulsedesk/contracts";
import { selectConversation, type AIRequest } from "@pulsedesk/state";
import { Button, Textarea } from "@pulsedesk/ui";
import { ArrowUp, Sparkles } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useAppSelector } from "@/app/hooks";
import { CopilotTurn } from "./CopilotTurn";
import { QUICK_ACTIONS } from "./quick-actions";
import { useAIRunner } from "./use-ai-runner";

/** What screen readers hear when an answer ends (streaming text itself isn't announced). */
function announcementFor(conversation: readonly AIRequest[]): string {
  const latest = conversation
    .filter((request) => request.finishedAt !== null)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
  if (!latest) return "";
  switch (latest.status) {
    case "done":
      return "Answer ready.";
    case "failed":
      return `Answer failed: ${latest.error?.message ?? ""}`;
    case "cancelled":
      return "Answer cancelled.";
    case "streaming":
      return "";
  }
}

function EmptyConversation() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Sparkles aria-hidden="true" className="size-5" />
      </span>
      <p className="text-sm font-medium text-fg">Ask about this session</p>
      <p className="mt-1 max-w-64 text-sm text-fg-muted">
        Answers use only this session's recorded activity. Start with a quick action or ask a
        question.
      </p>
    </div>
  );
}

/**
 * The copilot's body: the conversation and the composer. Loaded lazily, after hydration,
 * so neither the dashboard nor the server render pays for it.
 */
export default function CopilotPanel({ sessionId }: { sessionId: string }) {
  const conversation = useAppSelector((state) => selectConversation(state, sessionId));
  const runner = useAIRunner();
  const [prompt, setPrompt] = useState("");
  const promptId = useId();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [conversation]);

  const ask = (input: Parameters<typeof runner.ask>[0]) => {
    stickToBottom.current = true;
    runner.ask(input);
  };

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const question = prompt.trim();
    if (!question) return;
    ask({ sessionId, action: "ask", prompt: question });
    setPrompt("");
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {conversation.length === 0 ? (
          <EmptyConversation />
        ) : (
          <ol aria-label="Copilot conversation" className="space-y-6">
            {conversation.map((request) => (
              <CopilotTurn
                key={request.id}
                request={request}
                onCancel={runner.cancel}
                onRetry={(id) => {
                  stickToBottom.current = true;
                  runner.retry(id);
                }}
              />
            ))}
          </ol>
        )}
        <p role="status" className="sr-only">
          {announcementFor(conversation)}
        </p>
      </div>

      <div className="shrink-0 border-t border-line">
        <div
          role="group"
          aria-label="Quick actions"
          className="flex flex-wrap gap-1.5 px-3 pt-3 pb-1"
        >
          {QUICK_ACTIONS.map(({ action, label, icon: Icon }) => (
            <Button
              key={action}
              size="sm"
              className="rounded-full"
              leadingIcon={<Icon aria-hidden="true" className="size-3.5 text-fg-muted" />}
              onClick={() => ask({ sessionId, action })}
            >
              {label}
            </Button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2 p-3">
          <label htmlFor={promptId} className="sr-only">
            Ask about this session
          </label>
          <Textarea
            id={promptId}
            rows={1}
            value={prompt}
            maxLength={MAX_AI_PROMPT_LENGTH}
            placeholder="Ask about this session…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            size="icon"
            aria-label="Send question"
            disabled={!prompt.trim()}
            className="size-9"
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
