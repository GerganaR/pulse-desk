import type { SessionsSnapshot } from "@pulsedesk/contracts";

/**
 * Network boundary the domain layer depends on, injected as the thunk `extra` argument.
 * The state package never knows about URLs or fetch; the web app provides a
 * validating HTTP implementation and tests provide fakes.
 */
export interface PulseApi {
  fetchSessionsSnapshot(signal: AbortSignal): Promise<SessionsSnapshot>;
}

export interface ThunkExtra {
  api: PulseApi;
}
