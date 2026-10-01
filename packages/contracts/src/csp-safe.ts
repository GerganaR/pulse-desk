/**
 * Browser-only Zod configuration. Every schema module imports `#zod-setup`, which bundlers
 * resolve to this file for the browser (see `imports` in package.json) and to a no-op
 * everywhere else.
 *
 * Zod JIT-compiles object parsers with `new Function`, and probes whether eval is allowed
 * when each object schema is *constructed* (i.e. when schema modules load). Under a strict
 * CSP without 'unsafe-eval' the probe is caught, but the browser still reports a CSP
 * violation: noise that would flood a CSP report endpoint and hide real attacks.
 *
 * Jitless mode skips the probe and the JIT. Because the probe runs at module evaluation,
 * this must execute before any schema is built. Importing it from the schema modules
 * themselves guarantees that in whichever chunk they end up, without the app having to
 * remember an import order. Node services resolve the no-op and keep the faster JIT path.
 */
import { config } from "zod/mini";

config({ jitless: true });
