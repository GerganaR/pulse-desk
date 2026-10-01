import "#zod-setup";
import * as z from "zod/mini";
import { RealtimeEventSchema } from "./events.ts";
import { nonEmptyString, nonNegativeInt } from "./primitives.ts";
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
 * Resync: a client that detects a gap it can't fill (a lost frame) sends `hello` again on
 * the same socket with its last applied cursor. The server answers with the same
 * welcome → sync/snapshot sequence; nothing about the socket is torn down.
 *
 * Stream epochs: the demo gateway keeps its log in memory, so a restart begins a new
 * stream whose sequences restart at 1. Every cursor carries the `streamId` it belongs to;
 * a cursor from another epoch can't be resumed and gets a fresh snapshot instead of
 * silently skipping events.
 */

export const PROTOCOL_VERSION = 1;

/** A position in a specific event stream. */
export const StreamCursorSchema = z.object({
  streamId: nonEmptyString,
  sequence: nonNegativeInt,
});
export type StreamCursor = z.infer<typeof StreamCursorSchema>;

// ─── client → server ────────────────────────────────────────────────────────────

export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.int(),
  /** The support agent this connection belongs to (used for presence). */
  agent: AgentSchema,
  /** Last cursor the client fully processed, or null to request a fresh snapshot. */
  resumeFrom: z.nullable(StreamCursorSchema),
});

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
  nonce: z.int(),
  sentAt: z.number(),
});

export const WatchSessionMessageSchema = z.object({
  type: z.literal("session.watch"),
  sessionId: nonEmptyString,
});

export const UnwatchSessionMessageSchema = z.object({
  type: z.literal("session.unwatch"),
  sessionId: nonEmptyString,
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
  streamId: nonEmptyString,
  serverTime: z.number(),
  heartbeatIntervalMs: z.int().check(z.positive()),
  headSequence: nonNegativeInt,
});

export const SnapshotMessageSchema = z.object({
  type: z.literal("snapshot"),
  streamId: nonEmptyString,
  /** Stream position the snapshot reflects. Live events continue from sequence + 1. */
  sequence: nonNegativeInt,
  sessions: z.array(SessionSchema),
});

export const SyncStartedMessageSchema = z.object({
  type: z.literal("sync.started"),
  fromSequence: nonNegativeInt,
  toSequence: nonNegativeInt,
});

export const SyncCompletedMessageSchema = z.object({
  type: z.literal("sync.completed"),
  replayedCount: nonNegativeInt,
  headSequence: nonNegativeInt,
});

export const EventsMessageSchema = z.object({
  type: z.literal("events"),
  events: z.array(RealtimeEventSchema),
});

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
  nonce: z.int(),
  serverTime: z.number(),
  /**
   * Stream head when the pong was sent. Frames on a socket arrive in order, so by the time
   * the pong arrives every event up to this sequence should have too. If one hasn't, the
   * client has a gap, even when the stream has since gone quiet and no later event would
   * reveal it.
   */
  headSequence: nonNegativeInt,
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
  streamId: nonEmptyString,
  sequence: nonNegativeInt,
  sessions: z.array(SessionSchema),
});
export type SessionsSnapshot = z.infer<typeof SessionsSnapshotSchema>;

/** GET /sessions/:id — session detail with its (bounded) recent timeline and viewers. */
export const SessionDetailSnapshotSchema = z.object({
  streamId: nonEmptyString,
  sequence: nonNegativeInt,
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
  events: z.array(z.unknown()).check(z.maxLength(MAX_INGEST_BATCH)),
});

export const IngestRejectionReasonSchema = z.enum([
  "invalid",
  /** Activity for a session the gateway doesn't know — producer should re-announce it. */
  "unknown_session",
  "duplicate_event",
]);
export type IngestRejectionReason = z.infer<typeof IngestRejectionReasonSchema>;

export const IngestResponseSchema = z.object({
  accepted: nonNegativeInt,
  rejected: z.array(
    z.object({
      index: nonNegativeInt,
      reason: IngestRejectionReasonSchema,
      sessionId: z.nullable(z.string()),
    }),
  ),
  headSequence: nonNegativeInt,
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
