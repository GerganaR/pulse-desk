import { createMetrics, type Logger, type MetricSink } from "@pulsedesk/observability";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type { GatewayConfig } from "./config.ts";
import { EventPipeline } from "./events/pipeline.ts";
import { SessionStore } from "./events/session-store.ts";
import { handleHttp } from "./http/routes.ts";
import { ConnectionManager } from "./websocket/connection-manager.ts";
import { startHeartbeat } from "./websocket/heartbeat.ts";
import { InMemoryEventLog } from "./websocket/replay-buffer.ts";
import { SessionRooms } from "./websocket/session-room.ts";

export interface GatewayOptions {
  config: GatewayConfig;
  logger: Logger;
  metricSink?: MetricSink;
  /** Injectable clock for the inactivity sweeper (tests). */
  now?: () => number;
}

/**
 * Composition root. Returns handles instead of listening on import, so integration tests
 * can run a real gateway on an ephemeral port.
 */
export function createGateway({
  config,
  logger,
  metricSink = { record: () => {} },
  now = Date.now,
}: GatewayOptions) {
  const metrics = createMetrics(metricSink);
  const log = new InMemoryEventLog(config.replayBufferSize);
  const store = new SessionStore(config);
  const rooms = new SessionRooms();

  // The pipeline broadcasts through the manager, and the manager publishes presence
  // through the pipeline. Each closure only runs after both exist.
  const manager: ConnectionManager = new ConnectionManager({
    log,
    store,
    rooms,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    publish: (events) => pipeline.publish(events),
    logger,
    metrics,
  });
  const pipeline: EventPipeline = new EventPipeline({
    log,
    store,
    broadcast: (events) => {
      const stop = metrics.startTimer("gateway.broadcast.duration");
      manager.broadcast(events);
      stop();
    },
    logger,
    metrics,
  });

  const server = http.createServer((req, res) => {
    handleHttp(req, res, {
      log,
      store,
      rooms,
      pipeline,
      maxIngestBodyBytes: config.maxIngestBodyBytes,
      connectionCount: () => manager.size,
    }).catch((error: unknown) => {
      logger.error("http.unhandled", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxClientFrameBytes });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://gateway").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (manager.size >= config.maxConnections) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => manager.accept(ws));
  });

  const stopHeartbeat = startHeartbeat(() => manager.sockets(), config.heartbeatIntervalMs);
  const sweeper = setInterval(() => pipeline.publish(store.sweep(now())), config.sweepIntervalMs);
  sweeper.unref();

  return {
    log,
    store,
    pipeline,
    server,
    /** Start listening; resolves with the bound port (use port 0 in tests). */
    listen(port = config.port, host = config.host): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
      });
    },
    /** Graceful shutdown: tell clients to reconnect elsewhere, then stop. */
    async close() {
      clearInterval(sweeper);
      stopHeartbeat();
      manager.closeAll();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
