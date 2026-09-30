// Isomorphic package: only the minimal platform surface shared by browsers and Node.
declare const console: {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
declare const performance: { now(): number };
