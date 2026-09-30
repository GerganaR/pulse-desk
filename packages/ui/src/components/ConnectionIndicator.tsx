import { cx } from "../lib/cx.ts";
import type { Tone } from "./Badge.tsx";
import { Spinner } from "./Spinner.tsx";
import { StatusDot } from "./StatusDot.tsx";

export type ConnectionStatus = "live" | "connecting" | "reconnecting" | "degraded" | "offline";

const presentation: Record<ConnectionStatus, { label: string; tone: Tone; className: string }> = {
  live: { label: "Live", tone: "live", className: "text-live" },
  connecting: { label: "Connecting", tone: "info", className: "text-info" },
  reconnecting: { label: "Reconnecting", tone: "warning", className: "text-warning" },
  degraded: { label: "Degraded", tone: "warning", className: "text-warning" },
  offline: { label: "Offline", tone: "danger", className: "text-danger" },
};

export interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  /** Secondary context, e.g. "retry in 4s" or "142 ms". Shown muted after the label. */
  detail?: string;
  className?: string;
}

/**
 * Realtime connection status pill.
 *
 * `role="status"` makes changes announce politely without stealing focus. The detail
 * text is excluded from the live region so ticking countdowns/latency don't spam
 * screen readers — only the status transition itself is announced.
 */
export function ConnectionIndicator({ status, detail, className }: ConnectionIndicatorProps) {
  const { label, tone, className: toneClass } = presentation[status];
  const busy = status === "connecting" || status === "reconnecting";

  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-2 rounded-full border border-line bg-surface px-2.5 text-xs font-medium",
        className,
      )}
      data-status={status}
    >
      {busy ? (
        <Spinner size="sm" className={toneClass} />
      ) : (
        <StatusDot tone={tone} pulse={status === "live"} />
      )}
      <span role="status" aria-live="polite" className="text-fg">
        {label}
      </span>
      {detail && (
        <span className="text-fg-subtle tabular-nums" aria-hidden="true">
          {detail}
        </span>
      )}
    </span>
  );
}
