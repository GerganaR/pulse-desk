import { SessionDetailSnapshotSchema, SessionsSnapshotSchema, decode } from "@pulsedesk/contracts";

/**
 * Response validation for the HTTP API. Its own module so the schemas (and the validation
 * library under them) load with the realtime chunk, after hydration: the first render
 * uses data the server already validated.
 */
export const decodeSessionsSnapshot = (input: unknown) => decode(SessionsSnapshotSchema, input);
export const decodeSessionDetail = (input: unknown) => decode(SessionDetailSnapshotSchema, input);
