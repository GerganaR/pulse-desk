import { cx } from "../lib/cx.ts";
import type { Tone } from "./Badge.tsx";

const dotTones: Record<Tone, string> = {
  neutral: "bg-fg-subtle",
  accent: "bg-accent",
  live: "bg-live",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export interface StatusDotProps {
  tone: Tone;
  /** Animated ring to signal "live" activity. Disabled automatically for reduced motion. */
  pulse?: boolean;
  className?: string;
}

/** Decorative dot. Always pair with a visible or screen-reader text label. */
export function StatusDot({ tone, pulse = false, className }: StatusDotProps) {
  return (
    <span aria-hidden="true" className={cx("relative inline-flex size-2 shrink-0", className)}>
      {pulse && (
        <span
          className={cx(
            "absolute inset-0 rounded-full motion-safe:animate-pulse-ring",
            dotTones[tone],
          )}
        />
      )}
      <span className={cx("relative inline-flex size-2 rounded-full", dotTones[tone])} />
    </span>
  );
}
