import type { AIRequest } from "@pulsedesk/state";
import { Button, cx } from "@pulsedesk/ui";
import { RotateCw, ShieldAlert, Sparkles, Square, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { formatLatency } from "@/lib/format";
import { questionFor } from "./quick-actions";

function Caret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-[1px] bg-accent motion-safe:animate-caret-blink"
    />
  );
}

function Meta({ request }: { request: AIRequest }) {
  const parts = [
    request.model,
    request.finishedAt !== null ? formatLatency(request.finishedAt - request.startedAt) : null,
    request.attempt > 1 ? `attempt ${request.attempt}` : null,
  ].filter(Boolean);
  return (
    <p className="mt-1.5 text-xs text-fg-subtle">
      {parts.join(" · ")}
      {request.finishReason === "length" && (
        <span className="text-warning"> · stopped at the length limit</span>
      )}
    </p>
  );
}

/**
 * The runtime grounding guard's verdict: claims ai-service couldn't back with an event.
 * The answer stays visible; the flag says which parts not to rely on, and why.
 */
function UnverifiedClaims({ claims }: { claims: AIRequest["unverified"] }) {
  return (
    <div
      data-unverified-claims={claims.length}
      className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs"
    >
      <p className="flex items-start gap-2 font-medium text-fg">
        <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
        Couldn't verify against this session's events:
      </p>
      <ul className="mt-1.5 space-y-1 pl-5.5">
        {claims.map((claim, index) => (
          <li key={index} className="break-words text-fg-muted">
            <q className="text-fg">{claim.quote}</q>: {claim.reason}.
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CopilotTurnProps {
  request: AIRequest;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

/**
 * One question and its answer. The answer renders as plain text (`pre-wrap`), never as
 * HTML or Markdown: model output is untrusted, and it quotes visitor-supplied strings.
 */
export const CopilotTurn = memo(function CopilotTurn({
  request,
  onCancel,
  onRetry,
}: CopilotTurnProps) {
  const { id, status, text, error } = request;
  const streaming = status === "streaming";
  const retryable = status === "cancelled" || (status === "failed" && error?.retryable !== false);

  return (
    <li data-request-id={id} data-ai-status={status} className="space-y-3">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-sm break-words whitespace-pre-wrap text-fg">
          {questionFor(request.action, request.prompt)}
        </p>
      </div>

      <div className="flex gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
        >
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div
            aria-busy={streaming || undefined}
            data-answer=""
            className={cx(
              "text-sm leading-6 break-words whitespace-pre-wrap",
              status === "done" || streaming ? "text-fg" : "text-fg-muted",
            )}
          >
            {text}
            {streaming && !text && <span className="text-fg-muted">Thinking</span>}
            {streaming && <Caret />}
          </div>

          {streaming && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5 -ml-2"
              leadingIcon={<Square aria-hidden="true" className="size-3 fill-current" />}
              onClick={() => onCancel(id)}
            >
              Cancel
            </Button>
          )}

          {status === "done" && request.unverified.length > 0 && (
            <UnverifiedClaims claims={request.unverified} />
          )}
          {status === "done" && <Meta request={request} />}

          {(status === "failed" || status === "cancelled") && (
            <div
              className={cx(
                "mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2",
                status === "failed"
                  ? "border-danger/25 bg-danger-soft"
                  : "border-line bg-surface-muted",
              )}
            >
              <p className="flex min-w-0 flex-1 items-start gap-2 text-xs">
                {status === "failed" && (
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-px size-3.5 shrink-0 text-danger"
                  />
                )}
                <span className={status === "failed" ? "text-danger" : "text-fg-muted"}>
                  {status === "failed" ? error?.message : "Cancelled."}
                  {text && " The partial answer is kept above."}
                </span>
              </p>
              {retryable && (
                <Button
                  size="sm"
                  leadingIcon={<RotateCw aria-hidden="true" className="size-3" />}
                  onClick={() => onRetry(id)}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
});
