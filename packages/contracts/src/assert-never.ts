/**
 * Compile-time exhaustiveness guard for discriminated-union switches.
 *
 * Its own module on purpose: `projection.ts` needs it, and the browser's initial bundle
 * needs `projection.ts`. Next to the decoders it dragged every schema, and the validation
 * library, into that bundle.
 */
export function assertNever(value: never, context = "value"): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
