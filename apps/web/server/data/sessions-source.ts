import type { SessionDetailSnapshot, SessionsSnapshot } from "@pulsedesk/contracts";

/**
 * Where the web server gets session data for SSR and the same-origin `/api/sessions*`
 * endpoints. The UI and store depend only on this interface.
 */
export interface SessionsSource {
  getSnapshot(signal?: AbortSignal): Promise<SessionsSnapshot>;
  /** Resolves null when the session doesn't exist. */
  getSessionDetail(sessionId: string, signal?: AbortSignal): Promise<SessionDetailSnapshot | null>;
}
