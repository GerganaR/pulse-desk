import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAIChat } from "./ai-proxy";
import type { SessionsSource } from "./data/sessions-source";
import { errorFields, log } from "./log";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Same-origin API for the browser (a thin backend-for-frontend over the gateway).
 * Returns true when the request was handled.
 */
export function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: { sessions: SessionsSource; aiServiceUrl: string },
): boolean {
  if (!pathname.startsWith("/api/")) return false;

  if (pathname === "/api/ai/chat" && req.method === "POST") {
    handleAIChat(req, res, {
      sessions: deps.sessions,
      aiServiceUrl: deps.aiServiceUrl,
      // Build-time constant: production builds never forward the fault header.
      forwardFaults: __DEVTOOLS__,
    }).catch((error: unknown) => {
      log.error("api.ai_chat_failed", errorFields(error));
      if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
      else res.end();
    });
    return true;
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort()); // browser went away → stop upstream work
  const fail = (event: string) => (error: unknown) => {
    if (controller.signal.aborted) return;
    log.error(event, errorFields(error));
    sendJson(res, 503, { error: "Session service unavailable" });
  };

  if (pathname === "/api/sessions" && req.method === "GET") {
    deps.sessions
      .getSnapshot(controller.signal)
      .then((snapshot) => sendJson(res, 200, snapshot))
      .catch(fail("api.sessions_failed"));
    return true;
  }

  const detail = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
  if (detail && req.method === "GET") {
    deps.sessions
      .getSessionDetail(decodeURIComponent(detail[1] ?? ""), controller.signal)
      .then((snapshot) =>
        snapshot
          ? sendJson(res, 200, snapshot)
          : sendJson(res, 404, { error: "Session not found" }),
      )
      .catch(fail("api.session_detail_failed"));
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
