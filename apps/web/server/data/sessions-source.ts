import type { SessionsSnapshot } from "@pulsedesk/contracts";

/**
 * Where the web server gets session data for SSR and `/api/sessions`.
 * Phase 2 uses the mock below; the realtime gateway implementation replaces it without
 * any change to the UI or the store.
 */
export interface SessionsSource {
  getSnapshot(signal?: AbortSignal): Promise<SessionsSnapshot>;
}
