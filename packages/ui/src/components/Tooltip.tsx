import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface TooltipTriggerProps {
  "aria-describedby": string;
}

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
  /** Horizontal alignment with the trigger; use "end" for triggers near the right edge. */
  align?: "center" | "start" | "end";
  /** Delay before showing on hover. Keyboard focus shows it immediately. */
  delayMs?: number;
  /**
   * Render the trigger, spreading the given props onto the focusable element so the
   * tooltip becomes its accessible description.
   */
  children: (props: TooltipTriggerProps) => ReactNode;
  /** Layout only. */
  className?: string;
}

/**
 * Supplementary description for a control, following the WAI-ARIA tooltip pattern and
 * WCAG 1.4.13 (content on hover or focus):
 * - shown on hover (after a short delay) and on keyboard focus;
 * - hoverable: moving the pointer onto the tooltip keeps it open;
 * - dismissible with Escape without moving focus;
 * - always in the DOM (hidden when closed), so `aria-describedby` resolves for screen
 *   readers even when it isn't visible.
 * Never put essential information or interactive content in a tooltip.
 */
export function Tooltip({
  content,
  side = "top",
  align = "center",
  delayMs = 400,
  children,
  className,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <span
      className={cx("relative inline-flex", className)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") show(delayMs);
      }}
      onPointerLeave={hide}
      onFocus={(event) => {
        // Only keyboard focus: a click shouldn't pop a tooltip over what was just clicked.
        if (event.target.matches(":focus-visible")) show(0);
      }}
      onBlur={hide}
    >
      {children({ "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        className={cx(
          "absolute z-50 w-max max-w-64 rounded-md bg-fg px-2.5 py-1.5 text-xs leading-snug font-normal text-fg-inverse shadow-overlay",
          "motion-safe:animate-fade-in",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}
