/**
 * What `#zod-setup` resolves to outside the browser: nothing to configure. Node services
 * keep Zod's JIT-compiled parsers. Browser bundles get `csp-safe.ts` instead (the
 * "browser" condition of `imports` in package.json).
 */
export {};
