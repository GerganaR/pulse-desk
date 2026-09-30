import {
  createPulseStore,
  fetchSessionDetail,
  fetchSessionsSnapshot,
  type PulseApi,
  type PulseStore,
} from "@pulsedesk/state";
import type { SessionsSource } from "./data/sessions-source";

export interface PrefetchResult {
  store: PulseStore;
  /** False when the budget expired: the page streams with skeletons and loads client-side. */
  completed: boolean;
}

/** Server-side PulseApi: calls the data source directly, no HTTP loopback. */
export const serverApi = (source: SessionsSource): PulseApi => ({
  fetchSessionsSnapshot: (signal) => source.getSnapshot(signal),
  fetchSessionDetail: (sessionId, signal) => source.getSessionDetail(sessionId, signal),
});

/**
 * Load the data a page needs into a fresh per-request store, within a time budget.
 *
 * SSR must not make time-to-first-byte hostage to a slow backend. If data isn't ready
 * within `budgetMs`, requests are aborted, the store stays `idle`, and the client loads
 * after hydration (showing skeletons meanwhile). A *failed* fetch is kept in the state,
 * so the page renders its error UI with retry.
 */
export async function prefetchForRequest(
  source: SessionsSource,
  budgetMs: number,
  { sessionId }: { sessionId?: string } = {},
): Promise<PrefetchResult> {
  const store = createPulseStore({ extra: { api: serverApi(source) } });

  const requests = [
    store.dispatch(fetchSessionsSnapshot()),
    ...(sessionId ? [store.dispatch(fetchSessionDetail(sessionId))] : []),
  ];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budgetMs);
  });

  const outcome = await Promise.race([Promise.all(requests).then(() => "done" as const), timedOut]);
  clearTimeout(timer);

  if (outcome === "timeout") {
    requests.forEach((request) => request.abort());
    await Promise.allSettled(requests); // let aborted actions settle so the state is consistent
    return { store, completed: false };
  }
  return { store, completed: true };
}
