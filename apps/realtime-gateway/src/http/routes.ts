import {
  IngestRequestSchema,
  decode,
  type SessionDetailSnapshot,
  type SessionsSnapshot,
} from "@pulsedesk/contracts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventPipeline } from "../events/pipeline.ts";
import type { SessionStore } from "../events/session-store.ts";
import type { EventLog } from "../websocket/replay-buffer.ts";
import type { SessionRooms } from "../websocket/session-room.ts";

export interface HttpDeps {
  log: EventLog;
  store: SessionStore;
  rooms: SessionRooms;
  pipeline: EventPipeline;
  maxIngestBodyBytes: number;
  connectionCount: () => number;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

class BodyTooLargeError extends Error {}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new BodyTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * HTTP API:
 *   GET  /healthz          liveness + basic stats
 *   GET  /sessions         snapshot of all sessions at the current stream position
 *   GET  /sessions/:id     one session, its recent timeline and current viewers
 *   POST /ingest           producer batches (the event simulator)
 *
 * Snapshots are read and the head sequence captured synchronously, so the sequence
 * always matches the data it's returned with.
 */
export async function handleHttp(req: IncomingMessage, res: ServerResponse, deps: HttpDeps) {
  const url = new URL(req.url ?? "/", "http://gateway");
  const { log, store } = deps;

  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJson(res, 200, {
      status: "ok",
      streamId: log.streamId,
      headSequence: log.headSequence(),
      sessions: store.size,
      connections: deps.connectionCount(),
    });
  }

  if (req.method === "GET" && url.pathname === "/sessions") {
    const body: SessionsSnapshot = {
      streamId: log.streamId,
      sequence: log.headSequence(),
      sessions: store.list(),
    };
    return sendJson(res, 200, body);
  }

  const detailMatch = /^\/sessions\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && detailMatch) {
    const sessionId = decodeURIComponent(detailMatch[1] ?? "");
    const detail = store.detail(sessionId);
    if (!detail) return sendJson(res, 404, { error: "Session not found" });
    const body: SessionDetailSnapshot = {
      streamId: log.streamId,
      sequence: log.headSequence(),
      ...detail,
      viewers: deps.rooms.viewers(sessionId),
    };
    return sendJson(res, 200, body);
  }

  if (req.method === "POST" && url.pathname === "/ingest") {
    let body: unknown;
    try {
      body = await readJson(req, deps.maxIngestBodyBytes);
    } catch (error) {
      return error instanceof BodyTooLargeError
        ? sendJson(res, 413, { error: "Batch too large" })
        : sendJson(res, 400, { error: "Body must be JSON" });
    }
    const request = decode(IngestRequestSchema, body);
    if (!request.ok)
      return sendJson(res, 400, { error: "Expected { events: [...] } (max 500 events)" });
    return sendJson(res, 200, deps.pipeline.ingest(request.value.events));
  }

  sendJson(res, 404, { error: "Not found" });
}
