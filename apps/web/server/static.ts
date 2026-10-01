import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import sirv, { type Options } from "sirv";

export type StaticHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  /** Path of the file inside the directory, e.g. "/js/main.abc123.js". */
  pathname: string,
  /** Called when there is no such file, so the caller can answer or try something else. */
  next: () => void,
) => Promise<void>;

/**
 * Serves files from a directory, and stays up when a file goes missing.
 *
 * In production `sirv` lists the directory once at startup and then streams files without
 * an error handler. If a file it listed is later removed (a rebuild or a deploy replacing
 * the directory under a running server), the next request for it emits an unhandled
 * stream error and the whole process exits. Checking that the file still exists first
 * turns that into an ordinary 404.
 */
export function createStaticHandler(directory: string, options: Options): StaticHandler {
  const root = path.resolve(directory);
  const serve = sirv(root, options);

  return async function handleStatic(req, res, pathname, next) {
    let relative: string;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      return next(); // malformed percent-encoding
    }
    const file = path.join(root, relative);
    // `path.join` resolves "..": anything that leaves the directory isn't ours to serve.
    if (!file.startsWith(root + path.sep)) return next();
    try {
      if (!(await stat(file)).isFile()) return next();
    } catch {
      return next();
    }
    req.url = pathname + (req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
    serve(req, res, next);
  };
}
