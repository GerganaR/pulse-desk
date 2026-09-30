import { Check } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "../lib/cx.ts";

/**
 * Menu button following the WAI-ARIA APG pattern:
 * - Enter / Space / ↓ on the trigger opens and focuses the first item; ↑ focuses the last.
 * - ↑ ↓ Home End move focus between items (roving, items are not in the tab order).
 * - Escape closes and returns focus to the trigger; Tab closes and lets focus move on.
 * - A pointer press outside closes without stealing focus.
 * The menu is only rendered while open, so server and client markup always agree.
 */

interface MenuContextValue {
  close: (options?: { restoreFocus?: boolean }) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenu() {
  const context = use(MenuContext);
  if (!context) throw new Error("DropdownMenu items must be rendered inside <DropdownMenu>");
  return context;
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([aria-disabled="true"])';

export interface DropdownMenuProps {
  /** Visible content of the trigger button. */
  trigger: ReactNode;
  /** Accessible name for the trigger when its content isn't descriptive text. */
  triggerLabel?: string;
  triggerClassName?: string;
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
}

export function DropdownMenu({
  trigger,
  triggerLabel,
  triggerClassName,
  align = "end",
  children,
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const focusOnOpen = useRef<"first" | "last">("first");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];

  const close = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openWith = (target: "first" | "last") => {
    focusOnOpen.current = target;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOnOpen.current === "first" ? list[0] : list.at(-1))?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openWith(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close({ restoreFocus: false });
        break;
    }
  };

  return (
    <MenuContext value={{ close }}>
      <div ref={rootRef} className={cx("relative inline-flex", className)}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={triggerLabel}
          onClick={() => (open ? close() : openWith("first"))}
          onKeyDown={onTriggerKeyDown}
          className={triggerClassName}
        >
          {trigger}
        </button>
        {open && (
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-label={triggerLabel}
            onKeyDown={onMenuKeyDown}
            className={cx(
              "absolute top-full z-50 mt-2 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-overlay",
              "motion-safe:animate-fade-in",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            {children}
          </div>
        )}
      </div>
    </MenuContext>
  );
}

const itemClass = cx(
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg outline-none",
  "hover:bg-surface-hover focus-visible:bg-surface-hover focus:bg-surface-hover",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
);

export interface DropdownMenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

export function DropdownMenuItem({
  onSelect,
  icon,
  disabled = false,
  children,
}: DropdownMenuItemProps) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={itemClass}
      onClick={() => {
        if (disabled) return;
        onSelect();
        close();
      }}
    >
      {icon && (
        <span aria-hidden="true" className="text-fg-muted [&>svg]:size-4">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

interface RadioGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface DropdownMenuRadioGroupProps<V extends string> {
  label: string;
  value: V;
  onValueChange: (value: V) => void;
  children: ReactNode;
}

export function DropdownMenuRadioGroup<V extends string>({
  label,
  value,
  onValueChange,
  children,
}: DropdownMenuRadioGroupProps<V>) {
  const labelId = useId();
  return (
    <RadioGroupContext value={{ value, onValueChange: onValueChange as (value: string) => void }}>
      <div role="group" aria-labelledby={labelId}>
        <DropdownMenuLabel id={labelId}>{label}</DropdownMenuLabel>
        {children}
      </div>
    </RadioGroupContext>
  );
}

export interface DropdownMenuRadioItemProps {
  value: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function DropdownMenuRadioItem({ value, icon, children }: DropdownMenuRadioItemProps) {
  const { close } = useMenu();
  const group = use(RadioGroupContext);
  if (!group) throw new Error("DropdownMenuRadioItem must be inside DropdownMenuRadioGroup");
  const checked = group.value === value;

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={itemClass}
      onClick={() => {
        group.onValueChange(value);
        close();
      }}
    >
      {icon && (
        <span aria-hidden="true" className="text-fg-muted [&>svg]:size-4">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      <Check aria-hidden="true" className={cx("size-4 text-accent", !checked && "invisible")} />
    </button>
  );
}

export function DropdownMenuLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-subtle">
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line" />;
}
