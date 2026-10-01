import { existsSync, readFileSync, rmSync } from "node:fs";
import { RESULTS_FILE } from "./report.ts";

/** Vitest global setup: start from an empty results file, print it when the run ends. */
export default function setup() {
  rmSync(RESULTS_FILE, { force: true });
  return () => {
    if (!existsSync(RESULTS_FILE)) return;
    const lines = readFileSync(RESULTS_FILE, "utf8").trim().split("\n");
    console.log("\nLoad scenario results");
    for (const line of lines) {
      const { scenario, ...values } = JSON.parse(line) as Record<string, string | number>;
      const text = Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("  ");
      console.log(`  ${String(scenario).padEnd(46)} ${text}`);
    }
    console.log("");
  };
}
