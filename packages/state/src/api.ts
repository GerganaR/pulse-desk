import type { SessionDetailSnapshot, SessionsSnapshot } from "@pulsedesk/contracts";

/**
 * Network boundary the domain layer depends on, injected as the thunk `extra` argument.
 * The state package never knows about URLs or fetch; the web app provides a
 * validating HTTP implementation and tests provide fakes.
 */
export interface PulseApi {
  fetchSessionsSnapshot(signal: AbortSignal): Promise<SessionsSnapshot>;
  /** Resolves null when the session doesn't exist (HTTP 404). */
  fetchSessionDetail(sessionId: string, signal: AbortSignal): Promise<SessionDetailSnapshot | null>;
}

export interface ThunkExtra {
  api: PulseApi;
}
