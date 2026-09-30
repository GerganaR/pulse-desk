import type { RealtimeEvent, SessionsSnapshot } from "@pulsedesk/contracts";
import { createAction } from "@reduxjs/toolkit";

/**
 * Shared actions that several slices react to. A whole batch of realtime events is one
 * action: sessions, timelines and presence update in a single dispatch and a single
 * render pass, however many events arrived.
 */
export const eventsReceived = createAction<RealtimeEvent[]>("realtime/eventsReceived");

/**
 * A complete, authoritative view of all sessions at a stream position — from the HTTP
 * snapshot (SSR / first load) or from the socket (first connect, expired cursor, new
 * stream epoch).
 */
export const snapshotReceived = createAction<SessionsSnapshot>("realtime/snapshotReceived");
