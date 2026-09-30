import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface PanelProps {
  title: ReactNode;
  /** Small inline element next to the title (count, status). */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Optional sticky footer, e.g. the copilot prompt input. */
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Id for the heading, used to label the region. */
  headingId: string;
}

/**
 * Full-height column with a fixed header and a scrollable body. Used for the
 * session workspace (details / live activity / copilot). Renders a labelled
 * <section> so each column is a navigable landmark for screen-reader users.
 */
export function Panel({
  title,
  meta,
  actions,
  children,
  footer,
  className,
  bodyClassName,
  headingId,
}: PanelProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate text-sm font-semibold text-fg">
            {title}
          </h2>
          {meta}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={cx("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
      {footer && <div className="shrink-0 border-t border-line">{footer}</div>}
    </section>
  );
}
