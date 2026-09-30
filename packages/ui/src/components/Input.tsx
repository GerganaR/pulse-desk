import type { ComponentProps } from "react";
import { cx } from "../lib/cx.ts";

const fieldBase = cx(
  "w-full rounded-lg border bg-surface text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors duration-150",
  "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/20",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
);

export interface InputProps extends ComponentProps<"input"> {
  invalid?: boolean;
}

/** Bare input. Always associate a <label> (or aria-label) at the call site. */
export function Input({ invalid = false, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(
        fieldBase,
        "h-9 px-3",
        invalid ? "border-danger" : "border-line hover:border-line-strong",
        className,
      )}
      {...props}
    />
  );
}

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

/** Grows with content where `field-sizing` is supported; falls back to `rows`. */
export function Textarea({ invalid = false, className, rows = 2, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(
        fieldBase,
        "field-sizing-content max-h-48 min-h-9 resize-none px-3 py-2 leading-5",
        invalid ? "border-danger" : "border-line hover:border-line-strong",
        className,
      )}
      {...props}
    />
  );
}
