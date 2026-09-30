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
  },
});
