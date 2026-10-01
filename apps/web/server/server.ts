import http, { type IncomingMessage, type ServerResponse } from "node:http";
import sirv from "sirv";
import { serverConfig as config } from "./config";
import { handleApiRequest } from "./api";
import { createGatewaySessionsSource } from "./data/gateway-sessions-source";
import { errorFields, log } from "./log";
import { ManifestNotReadyError, createManifestLoader } from "./manifest";
import { handlePageRequest } from "./ssr";

const getManifest = createManifestLoader(
  config.isProd
    ? { kind: "file", clientDist: config.clientDist }
    : { kind: "dev-server", origin: config.clientDevOrigin },
  { cache: config.isProd },
);

// Hashed client assets: cache forever. Only served by this process in production;
// in development the Rspack dev server serves them (with HMR).
const serveAssets = config.isProd
  ? sirv(config.clientDist, { immutable: true, maxAge: 31_536_000, etag: true })
  : undefined;
const servePublic = sirv(config.publicDir, {
  maxAge: config.isProd ? 3600 : 0,
  dev: !config.isProd,
});

const assetOrigins = config.isProd ? [] : [config.clientDevOrigin];
// Development only: the asset server over HTTP (hot-update manifests, and the source
// maps DevTools fetches) and over WebSocket (the HMR socket).
const connectOrigins = [
  new URL(config.publicConfig.gatewayUrl).origin,
  ...(config.isProd ? [] : [config.clientDevOrigin, config.clientDevOrigin.replace(/^http/, "ws")]),
];

const sessions = createGatewaySessionsSource({ baseUrl: config.gatewayHttpUrl, timeoutMs: 3_000 });

function notFound(res: ServerResponse) {
  res.statusCode = 404;
  res.end("Not found");
}

async function renderPage(req: IncomingMessage, res: ServerResponse) {
  try {
    const assets = await getManifest();
    await handlePageRequest(req, res, {
      assets,
      publicConfig: config.publicConfig,
      timeoutMs: config.ssrTimeoutMs,
      dataBudgetMs: config.ssrDataBudgetMs,
      sessions,
      assetOrigins,
      connectOrigins,
    });
  } catch (error) {
    if (error instanceof ManifestNotReadyError && !config.isProd) {
      // First compile still running in dev: retry shortly instead of erroring.
      res.writeHead(503, { "Content-Type": "text/html", "Retry-After": "1" });
      res.end('<meta http-equiv="refresh" content="1"><p>Waiting for the client build…</p>');
      return;
    }
    log.error("server.page_error", { path: req.url, ...errorFields(error) });
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal server error");
  }
}

function onRequest(req: IncomingMessage, res: ServerResponse) {
  const pathname = (req.url ?? "/").split("?", 1)[0] ?? "/";

  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));
    return;
  }

  if (handleApiRequest(req, res, pathname, { sessions, aiServiceUrl: config.aiServiceUrl })) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  if (pathname.startsWith("/assets/")) {
    if (!serveAssets) return notFound(res);
    req.url = req.url?.slice("/assets".length);
    serveAssets(req, res, () => notFound(res));
    return;
  }

  servePublic(req, res, () => void renderPage(req, res));
}

const server = http.createServer(onRequest);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    log.error("server.port_in_use", {
      port: config.port,
      hint: `Port ${config.port} is taken. Stop the other process or set PORT to a free port.`,
    });
  } else {
    log.error("server.error", errorFields(error));
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  log.info("server.listening", {
    url: `http://localhost:${config.port}`,
    mode: config.isProd ? "production" : "development",
  });
  // `pnpm dev` starts the gateway alongside this server, so give it a moment first.
  setTimeout(() => {
    void checkGateway();
    void checkAIService();
  }, 3_000).unref();
});

/**
 * Startup diagnostic. The app works without the gateway (pages render an error state
 * and the client keeps reconnecting), which makes a missing gateway easy to overlook:
 * say so plainly in the log instead of leaving only 503s from /api/sessions.
 */
async function checkGateway() {
  try {
    const response = await fetch(`${config.gatewayHttpUrl}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    log.warn("gateway.unreachable", {
      url: config.gatewayHttpUrl,
      ...errorFields(error),
      hint: "Session data comes from the realtime gateway. Run `pnpm dev` from the repository root (it starts web, gateway and simulator), or set GATEWAY_HTTP_URL.",
    });
  }
}

/** Same idea for the copilot: without ai-service, only the copilot panel fails. */
async function checkAIService() {
  try {
    const response = await fetch(`${config.aiServiceUrl}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    log.warn("ai_service.unreachable", {
      url: config.aiServiceUrl,
      ...errorFields(error),
      hint: "The AI copilot calls ai-service. `pnpm dev` starts it, or set AI_SERVICE_URL.",
    });
  }
}

// Graceful shutdown: stop accepting connections, let in-flight streams finish, and
// force-exit if they don't within the grace period (e.g. a stuck SSR stream).
function shutdown(signal: NodeJS.Signals) {
  log.info("server.shutdown", { signal });
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 5_000).unref();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
