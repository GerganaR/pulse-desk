import "#zod-setup";
import * as z from "zod/mini";

/**
 * Field schemas shared by the contracts. Internal: not exported from the package.
 *
 * Schemas are written with `zod/mini`: the same validation core as full Zod, with a
 * functional API (`z.string().check(z.minLength(1))`) that bundlers can tree-shake. The
 * browser loads these schemas to validate every frame and response, and full Zod was the
 * largest single dependency in the initial bundle (see docs/performance.md).
 */

export const nonEmptyString = z.string().check(z.minLength(1));
/** A URL path as tracked by the collector, e.g. "/pricing". */
export const urlPath = z.string().check(z.startsWith("/"));
/** A count, sequence position, duration or epoch timestamp: an integer ≥ 0. */
export const nonNegativeInt = z.int().check(z.nonnegative());
