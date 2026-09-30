import type { IncomingMessage, ServerResponse } from "node:http";
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
  deps: { sessions: SessionsSource },
): boolean {
  if (!pathname.startsWith("/api/")) return false;

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
