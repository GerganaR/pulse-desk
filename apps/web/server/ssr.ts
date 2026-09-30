import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BOOTSTRAP_GLOBAL,
  type AssetManifest,
  type BootstrapData,
  type PublicConfig,
} from "@/lib/bootstrap";
import { serializeForScript } from "@/lib/serialize";
import { render, resolveRouteHandle } from "./entry-server";
import { errorFields, log } from "./log";
import { contentSecurityPolicy, createNonce, setSecurityHeaders } from "./security";

export interface SsrContext {
  assets: AssetManifest;
  publicConfig: PublicConfig;
  timeoutMs: number;
  assetOrigins: string[];
  connectOrigins: string[];
}

/**
 * Streaming SSR for a single page request.
 *
 *   request ─► route handle (redirect / status) ─► renderToPipeableStream
 *                                                     │
 *                     onShellReady ◄──────────────────┤  headers + stream the shell
 *                     onShellError ◄──────────────────┤  static 500 document
 *                     onError      ◄──────────────────┘  log; Suspense boundaries that
 *                                                        fail are retried on the client
 *
 * The render is aborted if it exceeds `timeoutMs` (pending Suspense boundaries then
 * finish on the client) or if the client disconnects mid-stream.
 */
export function handlePageRequest(req: IncomingMessage, res: ServerResponse, ctx: SsrContext) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = resolveRouteHandle(url.pathname);

  if (route.redirect) {
    res.writeHead(302, { Location: route.redirect + url.search });
    res.end();
    return;
  }

  const nonce = createNonce();
  const bootstrap: BootstrapData = { assets: ctx.assets, config: ctx.publicConfig };
  const startedAt = performance.now();
  let shellErrored = false;
  let renderErrored = false;

  const { pipe, abort } = render({
    url: url.pathname + url.search,
    assets: ctx.assets,
    nonce,
    bootstrapScripts: ctx.assets.scripts,
    bootstrapScriptContent: `window.${BOOTSTRAP_GLOBAL}=${serializeForScript(bootstrap)}`,

    onShellReady() {
      res.statusCode = renderErrored ? 500 : route.status;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // Pages contain live, per-request data; never let intermediaries cache them.
      res.setHeader("Cache-Control", "no-store");
      setSecurityHeaders(
        res,
        contentSecurityPolicy({
          nonce,
          assetOrigins: ctx.assetOrigins,
          connectOrigins: ctx.connectOrigins,
        }),
      );
      pipe(res);
    },

    onShellError(error) {
      shellErrored = true;
      log.error("ssr.shell_error", { path: url.pathname, ...errorFields(error) });
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(fallbackDocument);
    },

    onError(error, errorInfo) {
      renderErrored = true;
      log.error("ssr.render_error", {
        path: url.pathname,
        componentStack: errorInfo.componentStack,
        ...errorFields(error),
      });
    },

    onAllReady() {
      if (shellErrored) return;
      log.info("ssr.render_complete", {
        path: url.pathname,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
  });

  const timeout = setTimeout(() => {
    log.warn("ssr.timeout", { path: url.pathname, timeoutMs: ctx.timeoutMs });
    abort(new Error(`SSR exceeded ${ctx.timeoutMs}ms`));
  }, ctx.timeoutMs);

  res.on("close", () => {
    clearTimeout(timeout);
    // Client went away before we finished streaming: stop rendering work for it.
    if (!res.writableFinished) abort(new Error("Client disconnected"));
  });
}

/** Rendered without React so it works even when React rendering itself is what failed. */
const fallbackDocument = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Something went wrong · PulseDesk</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f8f9fb;color:#1c1f2a}
  @media (prefers-color-scheme:dark){body{background:#12141b;color:#eceef4}}
  main{max-width:28rem;padding:2rem;text-align:center}
  a{color:#5b5bd6}
</style>
</head>
<body><main>
  <h1 style="font-size:1.25rem">Something went wrong</h1>
  <p>PulseDesk couldn't render this page. The error has been logged.</p>
  <p><a href="">Try again</a></p>
</main></body>
</html>`;
