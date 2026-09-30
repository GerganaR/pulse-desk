import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during SSR and hydration, true afterwards. For UI that only makes sense in a
 * running browser: React renders the server value while hydrating (so markup matches),
 * then re-renders with the client value. No effect + setState round trip needed.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
