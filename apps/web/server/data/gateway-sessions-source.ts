import {
  SessionDetailSnapshotSchema,
  SessionsSnapshotSchema,
  decode,
  type DecodeResult,
  type SessionDetailSnapshot,
  type SessionsSnapshot,
} from "@pulsedesk/contracts";
import type { SessionsSource } from "./sessions-source";

export class GatewayError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

/**
 * Reads snapshots from the realtime gateway's HTTP API. Responses are validated even
 * though we own both services: they deploy independently, and a schema drift should
 * surface as one clear error here, not as undefined values in rendered HTML.
 */
export function createGatewaySessionsSource({
  baseUrl,
  timeoutMs,
}: {
  baseUrl: string;
  timeoutMs: number;
}): SessionsSource {
  async function get<T>(
    path: string,
    parse: (input: unknown) => DecodeResult<T>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new GatewayError(
        timeout.aborted ? "Realtime gateway timed out" : "Realtime gateway is unreachable",
      );
    }
    if (response.status === 404) return null;
    if (!response.ok)
      throw new GatewayError(`Realtime gateway responded ${response.status}`, response.status);
    const result = parse(await response.json());
    if (!result.ok) throw new GatewayError("Realtime gateway returned malformed data");
    return result.value;
  }

  return {
    async getSnapshot(signal): Promise<SessionsSnapshot> {
      const snapshot = await get(
        "/sessions",
        (input) => decode(SessionsSnapshotSchema, input),
        signal,
      );
      if (!snapshot) throw new GatewayError("Realtime gateway has no sessions endpoint", 404);
      return snapshot;
    },
    getSessionDetail(sessionId, signal): Promise<SessionDetailSnapshot | null> {
      return get(
        `/sessions/${encodeURIComponent(sessionId)}`,
        (input) => decode(SessionDetailSnapshotSchema, input),
        signal,
      );
    },
  };
}
