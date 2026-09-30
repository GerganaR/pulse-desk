/**
 * Build-time constants, replaced by Rspack's DefinePlugin (see rspack.shared.ts) and by
 * Vitest's `define`. Branches on a false constant are removed from the bundle entirely.
 */
declare const __DEVTOOLS__: boolean;
