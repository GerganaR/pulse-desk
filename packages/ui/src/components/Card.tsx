import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-xl border border-line bg-surface shadow-card", className)}
      {...props}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls, e.g. a filter or "View all" link. */
  actions?: ReactNode;
  /** Heading level for the title; defaults to h2. Keep the document outline correct. */
  as?: "h2" | "h3";
  className?: string;
}

export function CardHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
}: CardHeaderProps) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <Heading className="text-sm font-semibold text-fg">{title}</Heading>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("px-5 pb-5", className)} {...props} />;
}
