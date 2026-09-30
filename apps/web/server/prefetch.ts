import { createPulseStore, fetchSessionsSnapshot, type PulseStore } from "@pulsedesk/state";
import type { SessionsSource } from "./data/sessions-source";

export interface PrefetchResult {
  store: PulseStore;
  /** False when the budget expired: the page streams with skeletons and loads client-side. */
  completed: boolean;
}

/**
 * Load the data a page needs into a fresh per-request store, within a time budget.
 *
 * SSR must not make time-to-first-byte hostage to a slow backend. If the snapshot
 * isn't ready within `budgetMs`, the request is aborted, the store stays in its
 * `idle` state, and the client fetches after hydration (showing skeletons meanwhile).
 * A failed fetch is *kept* in the state, so the page renders its error UI with retry.
 */
export async function prefetchForRequest(
  source: SessionsSource,
  budgetMs: number,
): Promise<PrefetchResult> {
  const store = createPulseStore({
    extra: { api: { fetchSessionsSnapshot: (signal) => source.getSnapshot(signal) } },
  });

  const request = store.dispatch(fetchSessionsSnapshot());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budgetMs);
  });

  const outcome = await Promise.race([request.then(() => "done" as const), timedOut]);
  clearTimeout(timer);

  if (outcome === "timeout") {
    request.abort();
    await request; // let the aborted action settle so the serialised state is consistent
    return { store, completed: false };
  }
  return { store, completed: true };
}
