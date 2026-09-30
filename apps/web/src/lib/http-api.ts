import { SessionDetailSnapshotSchema, SessionsSnapshotSchema, decode } from "@pulsedesk/contracts";
import type { PulseApi } from "@pulsedesk/state";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Browser implementation of the domain API. Responses are validated at the boundary:
 * a shape change on the server becomes a clear error here instead of `undefined`
 * surfacing deep inside a component.
 */
export function createHttpApi(baseUrl = ""): PulseApi {
  return {
    async fetchSessionsSnapshot(signal) {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new HttpError(response.status, `Couldn't load sessions (HTTP ${response.status})`);
      }
      const result = decode(SessionsSnapshotSchema, await response.json());
      if (!result.ok) throw new Error("Received malformed session data from the server");
      return result.value;
    },
    async fetchSessionDetail(sessionId, signal) {
      const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new HttpError(
          response.status,
          `Couldn't load session activity (HTTP ${response.status})`,
        );
      }
      const result = decode(SessionDetailSnapshotSchema, await response.json());
      if (!result.ok) throw new Error("Received malformed session data from the server");
      return result.value;
    },
  };
}
