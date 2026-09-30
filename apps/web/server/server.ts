import http, { type IncomingMessage, type ServerResponse } from "node:http";
import sirv from "sirv";
import { serverConfig as config } from "./config";
import { errorFields, log } from "./log";
import { ManifestNotReadyError, createManifestLoader } from "./manifest";
import { handlePageRequest } from "./ssr";

const getManifest = createManifestLoader(config.clientDist, { cache: config.isProd });

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
const connectOrigins = [
  new URL(config.publicConfig.gatewayUrl).origin,
  ...(config.isProd ? [] : [config.clientDevOrigin.replace(/^http/, "ws")]),
];

function notFound(res: ServerResponse) {
  res.statusCode = 404;
  res.end("Not found");
}

async function renderPage(req: IncomingMessage, res: ServerResponse) {
  try {
    const assets = await getManifest();
    handlePageRequest(req, res, {
      assets,
      publicConfig: config.publicConfig,
      timeoutMs: config.ssrTimeoutMs,
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
});

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
