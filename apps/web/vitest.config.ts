import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests compile devtools code paths in; the runtime `config.devTools` flag still decides.
  define: { __DEVTOOLS__: "true" },
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.{ts,tsx}"],
    // Whole pages rendered in jsdom are CPU-bound (the sessions page takes about 0.6 s
    // alone), and `pnpm check` runs every package's tests at once. Under that load the
    // default 5 s was reached once in the Phase 8 flake audit; the limit isn't the assertion.
    testTimeout: 20_000,
  },
});
