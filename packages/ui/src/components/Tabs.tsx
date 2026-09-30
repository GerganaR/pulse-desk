import { createContext, use, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../lib/cx.ts";

interface TabsContextValue {
  value: string;
  select: (value: string) => void;
  idFor: (kind: "tab" | "panel", value: string) => string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = use(TabsContext);
  if (!context) throw new Error(`<${component}> must be used inside <Tabs>`);
  return context;
}

export interface TabsProps {
  /** Controlled selected tab. */
  value?: string;
  /** Initially selected tab when uncontrolled. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

/**
 * WAI-ARIA tabs with automatic activation: arrow keys move focus and select, Home/End
 * jump to the ends, and only the selected tab is in the tab order (roving tabindex).
 */
export function Tabs({ value, defaultValue = "", onValueChange, children, className }: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const selected = value ?? uncontrolled;
  const baseId = useId();

  const context: TabsContextValue = {
    value: selected,
    select: (next) => {
      if (value === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    idFor: (kind, tab) => `${baseId}-${kind}-${tab}`,
  };

  return (
    <TabsContext value={context}>
      <div className={className}>{children}</div>
    </TabsContext>
  );
}

export interface TabListProps {
  /** Names the set of tabs for screen readers, e.g. "Session views". */
  "aria-label": string;
  children: ReactNode;
  className?: string;
}

export function TabList({ children, className, ...props }: TabListProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      aria-label={props["aria-label"]}
      className={cx(
        "flex gap-1 rounded-lg border border-line bg-surface-muted p-1 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Arrow keys, Home and End move between the enabled tabs of the same list, wrapping. */
function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, select: (value: string) => void) {
  const list = event.currentTarget.closest('[role="tablist"]');
  const tabs = [
    ...(list?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []),
  ];
  const current = tabs.indexOf(event.currentTarget);
  const target = {
    ArrowRight: tabs[(current + 1) % tabs.length],
    ArrowLeft: tabs[(current - 1 + tabs.length) % tabs.length],
    Home: tabs[0],
    End: tabs.at(-1),
  }[event.key];
  if (!target || current === -1) return;
  event.preventDefault();
  target.focus();
  select(target.dataset.value ?? "");
}

export interface TabProps {
  value: string;
  children: ReactNode;
  /** Small trailing element, e.g. a count or activity dot. */
  meta?: ReactNode;
  disabled?: boolean;
}

export function Tab({ value, children, meta, disabled }: TabProps) {
  const { value: selectedValue, select, idFor } = useTabs("Tab");
  const selected = selectedValue === value;
  return (
    <button
      type="button"
      role="tab"
      id={idFor("tab", value)}
      aria-selected={selected}
      aria-controls={idFor("panel", value)}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      data-value={value}
      data-state={selected ? "active" : "inactive"}
      onClick={() => select(value)}
      onKeyDown={(event) => onTabKeyDown(event, select)}
      className={cx(
        "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap",
        "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        selected ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
      {meta}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  /**
   * Keep the panel rendered while inactive, with `data-state="inactive"`, and leave
   * hiding it to `className`. Use it to keep state (scroll position, streams) across tab
   * switches, or to show every panel side by side on wide screens.
   */
  forceMount?: boolean;
  className?: string;
}

export function TabPanel({ value, children, forceMount = false, className }: TabPanelProps) {
  const { value: selectedValue, idFor } = useTabs("TabPanel");
  const selected = selectedValue === value;
  if (!selected && !forceMount) return null;
  return (
    <div
      role="tabpanel"
      id={idFor("panel", value)}
      aria-labelledby={idFor("tab", value)}
      data-state={selected ? "active" : "inactive"}
      className={className}
    >
      {children}
    </div>
  );
}
