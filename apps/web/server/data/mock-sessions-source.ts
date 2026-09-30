import { generateSessions } from "@pulsedesk/test-utils";
import type { SessionsSource } from "./sessions-source";

export interface MockSessionsSourceOptions {
  /** Simulated backend latency. Raise above the SSR data budget to see streaming fallbacks. */
  latencyMs: number;
  /** Probability [0,1] that a request fails, to exercise error and retry UI. */
  failureRate: number;
}

/**
 * Temporary data source: a deterministic population generated relative to "now", so
 * every request (SSR or client fetch) sees the same sessions with fresh timestamps.
 */
export function createMockSessionsSource({
  latencyMs,
  failureRate,
}: MockSessionsSourceOptions): SessionsSource {
  return {
    getSnapshot(signal) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (Math.random() < failureRate) {
            reject(new Error("Session service unavailable"));
            return;
          }
          resolve({ sequence: 0, sessions: generateSessions({ now: Date.now(), seed: 42 }) });
        }, latencyMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason as Error);
          },
          { once: true },
        );
      });
    },
  };
}
