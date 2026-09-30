import { z } from "zod";
import { RealtimeEventSchema } from "./events.ts";
import { SessionSchema } from "./session.ts";

/**
 * WebSocket wire protocol between the browser and the realtime gateway.
 *
 * Handshake:
 *   client → hello { resumeAfter }         (null on first connect, lastSequence on reconnect)
 *   server → welcome { headSequence, ... }
 *   server → either
 *              sync.started → events[] … → sync.completed   (cursor still in replay buffer)
 *            or
 *              snapshot { sessions, sequence }              (cursor expired / first connect)
 *   server → events …                                        (live)
 *
 * Heartbeat: client sends `ping` every `heartbeatIntervalMs`; a missing `pong` within the
 * timeout marks the connection dead. The server independently terminates sockets that stop
 * answering protocol-level pings.
 */

export const PROTOCOL_VERSION = 1;

// ─── client → server ────────────────────────────────────────────────────────────

export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number().int(),
  /** Last sequence the client fully processed, or null to request a fresh snapshot. */
  resumeAfter: z.number().int().nonnegative().nullable(),
});

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
  nonce: z.number().int(),
  sentAt: z.number(),
});

export const WatchSessionMessageSchema = z.object({
  type: z.literal("session.watch"),
  sessionId: z.string().min(1),
});

export const UnwatchSessionMessageSchema = z.object({
  type: z.literal("session.unwatch"),
  sessionId: z.string().min(1),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  PingMessageSchema,
  WatchSessionMessageSchema,
  UnwatchSessionMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── server → client ────────────────────────────────────────────────────────────

export const WelcomeMessageSchema = z.object({
  type: z.literal("welcome"),
  connectionId: z.string(),
  serverTime: z.number(),
  heartbeatIntervalMs: z.number().int().positive(),
  headSequence: z.number().int().nonnegative(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal("snapshot"),
  /** Stream position the snapshot reflects. Live events continue from sequence + 1. */
  sequence: z.number().int().nonnegative(),
  sessions: z.array(SessionSchema),
});

export const SyncStartedMessageSchema = z.object({
  type: z.literal("sync.started"),
  fromSequence: z.number().int().nonnegative(),
  toSequence: z.number().int().nonnegative(),
});

export const SyncCompletedMessageSchema = z.object({
  type: z.literal("sync.completed"),
  replayedCount: z.number().int().nonnegative(),
  headSequence: z.number().int().nonnegative(),
});

export const EventsMessageSchema = z.object({
  type: z.literal("events"),
  events: z.array(RealtimeEventSchema),
});

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
  nonce: z.number().int(),
  serverTime: z.number(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.enum(["bad_request", "unsupported_protocol", "internal"]),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  WelcomeMessageSchema,
  SnapshotMessageSchema,
  SyncStartedMessageSchema,
  SyncCompletedMessageSchema,
  EventsMessageSchema,
  PongMessageSchema,
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── HTTP ───────────────────────────────────────────────────────────────────────

/** GET /sessions — used by SSR to render real data before the socket connects. */
export const SessionsSnapshotSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sessions: z.array(SessionSchema),
});
export type SessionsSnapshot = z.infer<typeof SessionsSnapshotSchema>;

/** GET /sessions/:id — session detail with its (bounded) recent timeline. */
export const SessionDetailSnapshotSchema = z.object({
  sequence: z.number().int().nonnegative(),
  session: SessionSchema,
  events: z.array(RealtimeEventSchema),
});
export type SessionDetailSnapshot = z.infer<typeof SessionDetailSnapshotSchema>;
