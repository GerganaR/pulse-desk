import { fetchSessionsSnapshot, selectSessionsError, selectSessionsStatus } from "@pulsedesk/state";
import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";

/**
 * Ensures the sessions snapshot is loaded and exposes its load state.
 *
 * Usually a no-op: SSR preloads the data. It only fetches when SSR skipped it (data
 * budget exceeded). The request is intentionally *not* aborted on unmount: the result
 * lands in a shared store that other components (and the next page) use, and under
 * StrictMode an abort-on-cleanup would cancel the first request while the thunk's
 * dedupe condition skips the second — leaving nothing loaded.
 */
export function useSessionsSnapshot() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectSessionsStatus);
  const error = useAppSelector(selectSessionsError);

  useEffect(() => {
    if (status === "idle") void dispatch(fetchSessionsSnapshot());
  }, [dispatch, status]);

  const retry = useCallback(() => void dispatch(fetchSessionsSnapshot()), [dispatch]);

  return {
    status,
    error,
    /** True until the first snapshot arrives (show skeletons, not empty states). */
    isLoading: status === "idle" || status === "loading",
    retry,
  };
}
