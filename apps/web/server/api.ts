import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionsSource } from "./data/sessions-source";
import { errorFields, log } from "./log";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * Same-origin API for the browser (a thin backend-for-frontend). Returns true when the
 * request was handled.
 */
export function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: { sessions: SessionsSource },
): boolean {
  if (!pathname.startsWith("/api/")) return false;

  if (pathname === "/api/sessions" && req.method === "GET") {
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    deps.sessions
      .getSnapshot(controller.signal)
      .then((snapshot) => sendJson(res, 200, snapshot))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        log.error("api.sessions_failed", errorFields(error));
        sendJson(res, 503, { error: "Session service unavailable" });
      });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
