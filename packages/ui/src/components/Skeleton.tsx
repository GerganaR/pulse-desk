import { cx } from "../lib/cx.ts";

export interface SkeletonProps {
  className?: string;
}

/**
 * Placeholder block matching the shape of content that is loading. Decorative: the
 * surrounding region should carry `aria-busy` so assistive tech knows content is pending.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx("rounded-md bg-surface-muted motion-safe:animate-shimmer", className)}
    />
  );
}
