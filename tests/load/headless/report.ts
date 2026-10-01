import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const RESULTS_FILE = path.join(import.meta.dirname, "../results/headless.ndjson");

/** Median of repeated runs: one slow run (GC, a cold JIT) shouldn't decide the number. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Time `run` a few times (after a warm-up) and return the median in milliseconds. */
export function measure(run: () => void, { runs = 7 } = {}): number {
  run(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return median(times);
}

const round = (value: number) => (Number.isInteger(value) ? value : Number(value.toFixed(2)));

/**
 * Record one result. The test runner hides console output from passing tests, so results
 * go to a file that the global teardown prints as a summary (see `summary.ts`).
 */
export function report(scenario: string, values: Record<string, string | number>) {
  const rounded = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "number" ? round(value) : value,
    ]),
  );
  mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  appendFileSync(RESULTS_FILE, `${JSON.stringify({ scenario, ...rounded })}\n`);
}
