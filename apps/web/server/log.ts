/**
 * Minimal structured logger for the SSR server: one JSON object per line, ready for a
 * log shipper. Replaced by @pulsedesk/observability once that package lands.
 */
type Level = "info" | "warn" | "error";

function write(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};

export function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}
