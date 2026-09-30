/**
 * Side-effect module: import it FIRST in browser entry points.
 *
 * Zod JIT-compiles object parsers with `new Function`, and probes whether eval is allowed
 * when each object schema is *constructed* (i.e. when schema modules load). Under a strict
 * CSP without 'unsafe-eval' the probe is caught, but the browser still reports a CSP
 * violation — noise that would flood a CSP report endpoint and hide real attacks.
 *
 * Jitless mode skips the probe and the JIT. Because the probe runs at module evaluation,
 * this must execute before any schema module does, which is why it is a standalone
 * import rather than a function to call. Node services don't import it and keep the
 * faster JIT path.
 */
import { config } from "zod";

config({ jitless: true });
