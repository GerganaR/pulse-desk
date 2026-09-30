import { fetchSessionDetail, selectTimeline } from "@pulsedesk/state";
import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";

/**
 * Loads a session's activity history once (SSR usually already did) and returns the
 * timeline, which then grows live as events stream in. Like the sessions snapshot, the
 * fetch isn't aborted on unmount — its result is shared state.
 */
export function useSessionTimeline(sessionId: string) {
  const dispatch = useAppDispatch();
  const timeline = useAppSelector((state) => selectTimeline(state, sessionId));
  const history = timeline?.history ?? "idle";

  useEffect(() => {
    if (sessionId && history === "idle") void dispatch(fetchSessionDetail(sessionId));
  }, [dispatch, sessionId, history]);

  const retry = useCallback(
    () => void dispatch(fetchSessionDetail(sessionId)),
    [dispatch, sessionId],
  );
  return { timeline, history, retry };
}
