import { defineConfig } from "vitest/config";

/**
 * Headless load scenarios: real reducers, a real gateway and a real ai-service, all
 * in-process, no browser. They assert correctness under load (nothing lost, nothing
 * leaked) and print timings; the thresholds are deliberately loose so a busy CI runner
 * doesn't fail them, and tight enough to catch a change in complexity (linear → quadratic).
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["headless/**/*.load.test.ts"],
    environment: "node",
    globalSetup: ["headless/summary.ts"],
    // Measure what ships. Outside production, Redux Toolkit walks the whole state after
    // every dispatch (immutability and serialisability checks), which at 10,000 timeline
    // events costs more than the reducers themselves.
    env: { NODE_ENV: "production" },
    testTimeout: 60_000,
    // One scenario at a time: they measure time, and two at once would measure each other.
    fileParallelism: false,
  },
});
