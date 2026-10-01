import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Modal (default): the page behind is inert, focus stays inside, a backdrop dims it.
   * Non-modal: floats above the page and leaves it usable, for tools you watch the page
   * through (e.g. a debug panel next to a live timeline).
   */
  modal?: boolean;
  /**
   * Non-modal placement. Modal dialogs are always centred. On small screens the corner
   * placements become a short bottom sheet, so the page above stays visible.
   */
  placement?: "center" | "bottom-start" | "bottom-end";
  /** Extra controls in the header, before the close button. */
  headerActions?: ReactNode;
  children: ReactNode;
  /** Layout only, e.g. a width. */
  className?: string;
}

/** Native <dialog> methods, with a fallback for environments without them (jsdom). */
function showDialog(element: HTMLDialogElement, modal: boolean) {
  const method = modal ? element.showModal : element.show;
  if (typeof method === "function") method.call(element);
  else element.setAttribute("open", "");
}

function closeDialog(element: HTMLDialogElement) {
  if (typeof element.close === "function") element.close();
  else element.removeAttribute("open");
}

/**
 * Built on the native <dialog> element: the browser provides the top layer, `inert` on
 * the rest of the page for modals, and Escape handling (via `cancel`). This component adds
 * a controlled `open` prop, labelling, Escape for non-modal dialogs, and returning focus to
 * whatever opened it.
 *
 * Content only mounts while open, so a closed dialog costs nothing and never affects SSR.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  modal = true,
  placement = "center",
  headerActions,
  children,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showDialog(element, modal);
    // Browsers focus the first focusable element; make sure focus lands inside even where
    // they don't (non-modal show() in older engines, jsdom).
    if (!element.contains(document.activeElement)) element.focus();
    return () => {
      closeDialog(element);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, modal]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      onCancel={(event) => {
        // Escape on a modal: keep React as the source of truth for `open`.
        event.preventDefault();
        onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !modal) {
          event.stopPropagation();
          onOpenChange(false);
        }
      }}
      className={cx(
        "fixed z-50 m-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-0 text-fg shadow-overlay outline-none open:flex",
        "motion-safe:animate-fade-in backdrop:bg-black/40",
        modal || placement === "center"
          ? "inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),32rem)]"
          : cx(
              "inset-x-2 top-auto bottom-2 max-h-[55dvh] w-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[26rem]",
              placement === "bottom-start"
                ? "sm:right-auto sm:bottom-4 sm:left-4"
                : "sm:right-4 sm:bottom-4 sm:left-auto",
            ),
        className,
      )}
    >
      {open && (
        <>
          {/* Not <header>: outside sectioning content it would be a second page banner. */}
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-sm font-semibold text-fg">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-0.5 text-xs text-fg-muted">
                  {description}
                </p>
              )}
            </div>
            {headerActions}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </>
      )}
    </dialog>
  );
}
