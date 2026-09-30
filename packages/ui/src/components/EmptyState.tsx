import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx("flex flex-col items-center justify-center px-6 py-10 text-center", className)}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-muted text-fg-subtle"
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
