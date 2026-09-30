import { lazy, Suspense } from "react";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Entry point for developer tooling. The panel is a separate lazy chunk, and the lazy()
 * call sits behind the build-time `__DEVTOOLS__` constant: in a production build this is
 * `null`, so neither the dynamic import nor the chunk exists
 * (verified by `scripts/check-devtools-excluded.ts`).
 */
const ReliabilityPanel = __DEVTOOLS__ ? lazy(() => import("./ReliabilityPanel")) : null;

export function DevTools() {
  // Browser-only tooling: rendering it after hydration keeps SSR markup identical.
  const hydrated = useHydrated();
  if (!ReliabilityPanel || !hydrated) return null;
  return (
    <Suspense fallback={null}>
      <ReliabilityPanel />
    </Suspense>
  );
}
