export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export interface LogRecord {
  level: LogLevel;
  message: string;
  time: number;
  fields: LogFields;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Logger that adds `fields` to every record (e.g. { service: "gateway" }). */
  child(fields: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  sink: LogSink;
  level?: LogLevel;
  fields?: LogFields;
}

export function createLogger({ sink, level = "info", fields = {} }: LoggerOptions): Logger {
  const threshold = LEVELS[level];
  const log = (recordLevel: LogLevel, message: string, extra: LogFields = {}) => {
    if (LEVELS[recordLevel] < threshold) return;
    sink.write({ level: recordLevel, message, time: Date.now(), fields: { ...fields, ...extra } });
  };
  return {
    debug: (message, extra) => log("debug", message, extra),
    info: (message, extra) => log("info", message, extra),
    warn: (message, extra) => log("warn", message, extra),
    error: (message, extra) => log("error", message, extra),
    child: (extra) => createLogger({ sink, level, fields: { ...fields, ...extra } }),
  };
}

/** Serialise an unknown thrown value into loggable fields. */
export function errorFields(error: unknown): LogFields {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}

/**
 * One JSON object per line — what log shippers expect. Writes through `console` so it
 * works in Node and browsers; Node services can swap in a stdout sink if needed.
 */
export const jsonConsoleSink: LogSink = {
  write({ level, message, time, fields }) {
    const line = JSON.stringify({
      level,
      time: new Date(time).toISOString(),
      msg: message,
      ...fields,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  },
};

/** Human-readable output for the browser devtools console. */
export const browserConsoleSink: LogSink = {
  write({ level, message, fields }) {
    console[level](`[pulsedesk] ${message}`, fields);
  },
};
