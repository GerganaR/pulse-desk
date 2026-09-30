import { z } from "zod";
import { RealtimeEventSchema } from "./events.ts";
import { AgentSchema, SessionSchema } from "./session.ts";

/**
 * WebSocket wire protocol between the browser and the realtime gateway.
 *
 * Handshake:
 *   client → hello { agent, resumeFrom }   (null on first connect, else the last cursor)
 *   server → welcome { streamId, headSequence, ... }
 *   server → either
 *              sync.started → events[] … → sync.completed   (cursor still replayable)
 *            or
 *              snapshot { streamId, sequence, sessions }    (no cursor, cursor expired,
 *                                                            or a different stream epoch)
 *   server → events …                                        (live)
 *
 * Stream epochs: the demo gateway keeps its log in memory, so a restart begins a new
 * stream whose sequences restart at 1. Every cursor carries the `streamId` it belongs to;
 * a cursor from another epoch can't be resumed and gets a fresh snapshot instead of
 * silently skipping events.
 */

export const PROTOCOL_VERSION = 1;

/** A position in a specific event stream. */
export const StreamCursorSchema = z.object({
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
});
export type StreamCursor = z.infer<typeof StreamCursorSchema>;

// ─── client → server ────────────────────────────────────────────────────────────

export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number().int(),
  /** The support agent this connection belongs to (used for presence). */
  agent: AgentSchema,
  /** Last cursor the client fully processed, or null to request a fresh snapshot. */
  resumeFrom: StreamCursorSchema.nullable(),
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
  streamId: z.string().min(1),
  serverTime: z.number(),
  heartbeatIntervalMs: z.number().int().positive(),
  headSequence: z.number().int().nonnegative(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal("snapshot"),
  streamId: z.string().min(1),
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

// ─── HTTP: snapshots ────────────────────────────────────────────────────────────

/** GET /sessions — used by SSR to render real data before the socket connects. */
export const SessionsSnapshotSchema = z.object({
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  sessions: z.array(SessionSchema),
});
export type SessionsSnapshot = z.infer<typeof SessionsSnapshotSchema>;

/** GET /sessions/:id — session detail with its (bounded) recent timeline and viewers. */
export const SessionDetailSnapshotSchema = z.object({
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  session: SessionSchema,
  /** Most recent events, oldest first. May be truncated for long sessions. */
  events: z.array(RealtimeEventSchema),
  /** True when older events exist beyond `events`. */
  truncated: z.boolean(),
  viewers: z.array(AgentSchema),
});
export type SessionDetailSnapshot = z.infer<typeof SessionDetailSnapshotSchema>;

// ─── HTTP: ingest (producers → gateway) ─────────────────────────────────────────

export const MAX_INGEST_BATCH = 500;

/**
 * POST /ingest body. Events are validated individually on the server so that one bad
 * event doesn't reject a whole batch.
 */
export const IngestRequestSchema = z.object({
  events: z.array(z.unknown()).max(MAX_INGEST_BATCH),
});

export const IngestRejectionReasonSchema = z.enum([
  "invalid",
  /** Activity for a session the gateway doesn't know — producer should re-announce it. */
  "unknown_session",
  "duplicate_event",
]);
export type IngestRejectionReason = z.infer<typeof IngestRejectionReasonSchema>;

export const IngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      reason: IngestRejectionReasonSchema,
      sessionId: z.string().nullable(),
    }),
  ),
  headSequence: z.number().int().nonnegative(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
