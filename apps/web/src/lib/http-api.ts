import type { PulseApi } from "@pulsedesk/state";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Shares a chunk with the realtime connection: both need the schemas, after hydration. */
const loadDecoders = () => import(/* webpackChunkName: "realtime" */ "./decoders");

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
      const { decodeSessionsSnapshot } = await loadDecoders();
      const result = decodeSessionsSnapshot(await response.json());
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
      const { decodeSessionDetail } = await loadDecoders();
      const result = decodeSessionDetail(await response.json());
      if (!result.ok) throw new Error("Received malformed session data from the server");
      return result.value;
    },
  };
}
