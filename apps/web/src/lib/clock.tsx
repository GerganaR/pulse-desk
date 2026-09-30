import { createContext, use, useCallback, useSyncExternalStore, type ReactNode } from "react";

/**
 * One app-wide 1 Hz clock for time-relative UI ("8s ago", live session duration).
 *
 * - During SSR and hydration, `useNow()` returns the server's render time (from
 *   context), so the markup matches exactly. After hydration React switches to the
 *   browser clock automatically — that's what `getServerSnapshot` is for.
 * - A single interval serves every subscriber and stops when none remain.
 * - Not Redux: a tick every second is UI plumbing, not domain state, and would spam
 *   the action log and every selector subscription.
 *
 * Subscribe in *leaf* components (e.g. <RelativeTime>) so a tick re-renders a text
 * node, not a whole table row. Pass a coarser `granularityMs` when second precision
 * isn't needed: the snapshot is floored to it, and React skips re-rendering while the
 * floored value is unchanged.
 */

const ServerNowContext = createContext<number | null>(null);

export function ClockProvider({ now, children }: { now: number; children: ReactNode }) {
  return <ServerNowContext value={now}>{children}</ServerNowContext>;
}

const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const floorTo = (time: number, granularityMs: number) =>
  Math.floor(time / granularityMs) * granularityMs;

export function useNow(granularityMs = 1_000): number {
  const serverNow = use(ServerNowContext);
  if (serverNow === null) throw new Error("useNow() requires <ClockProvider>");
  const getSnapshot = useCallback(() => floorTo(current, granularityMs), [granularityMs]);
  const getServerSnapshot = useCallback(
    () => floorTo(serverNow, granularityMs),
    [serverNow, granularityMs],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
