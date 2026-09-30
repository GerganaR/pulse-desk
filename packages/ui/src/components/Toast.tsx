import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export type ToastTone = "info" | "success" | "warning" | "danger";

const tones: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "text-info" },
  success: { icon: CheckCircle2, className: "text-live" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  danger: { icon: XCircle, className: "text-danger" },
};

export interface ToastViewportProps {
  /** Accessible name of the landmark. */
  label?: string;
  children: ReactNode;
}

/**
 * Fixed stack for toasts. The live region is always rendered (even when empty), because
 * screen readers only announce changes to regions that already existed.
 */
export function ToastViewport({ label = "Notifications", children }: ToastViewportProps) {
  return (
    <section
      aria-label={label}
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] sm:inset-x-auto sm:right-4 sm:w-96"
    >
      <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2">
        {children}
      </ol>
    </section>
  );
}

export interface ToastProps {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  onDismiss: () => void;
  /**
   * Called with true while the pointer or focus is inside the toast, so auto-dismiss can
   * pause: nobody should lose a message they are reading or about to click.
   */
  onPauseChange?: (paused: boolean) => void;
}

/** A transient, non-blocking message. Place inside <ToastViewport>. */
export function Toast({ tone = "info", title, description, onDismiss, onPauseChange }: ToastProps) {
  const { icon: Icon, className } = tones[tone];
  return (
    <li
      className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3 pr-2 shadow-overlay motion-safe:animate-fade-in"
      onPointerEnter={() => onPauseChange?.(true)}
      onPointerLeave={() => onPauseChange?.(false)}
      onFocus={() => onPauseChange?.(true)}
      onBlur={() => onPauseChange?.(false)}
    >
      <Icon aria-hidden="true" className={cx("mt-0.5 size-4 shrink-0", className)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  );
}
