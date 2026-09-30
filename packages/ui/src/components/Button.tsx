import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import { Spinner } from "./Spinner.tsx";

const variants = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-sm",
  secondary:
    "bg-surface text-fg border border-line hover:bg-surface-hover hover:border-line-strong shadow-card",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "bg-danger text-fg-inverse hover:opacity-90 shadow-sm",
} as const;

const sizes = {
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
  md: "h-9 gap-2 rounded-lg px-3.5 text-sm",
  icon: "size-8 rounded-lg",
} as const;

export interface ButtonStyleOptions {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
}

/**
 * Button styling for elements that must not be <button>s — typically router links that
 * should look like buttons but keep link semantics (open in new tab, correct role).
 */
export function buttonStyles({
  variant = "secondary",
  size = "md",
  className,
}: ButtonStyleOptions = {}) {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none",
    "transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Shows a spinner, sets aria-busy and blocks clicks while keeping the label readable. */
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  leadingIcon,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : leadingIcon}
      {children}
    </button>
  );
}
