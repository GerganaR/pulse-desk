import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  /** Typically a retry button. */
  action?: ReactNode;
  /** Compact inline variant for use inside panels and message lists. */
  inline?: boolean;
  className?: string;
}

/** Uses role="alert" so the failure is announced when it appears. */
export function ErrorState({
  title,
  description,
  action,
  inline = false,
  className,
}: ErrorStateProps) {
  if (inline) {
    return (
      <div
        role="alert"
        className={cx(
          "flex items-start gap-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5",
          className,
        )}
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{title}</p>
          {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cx("flex flex-col items-center justify-center px-6 py-10 text-center", className)}
    >
      <div
        aria-hidden="true"
        className="mb-3 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger"
      >
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
