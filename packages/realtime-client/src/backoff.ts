export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Source of randomness in [0, 1). Injectable so tests are deterministic. */
  random: () => number;
}

export const defaultBackoff: BackoffOptions = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  random: Math.random,
};

/**
 * Exponential backoff with "equal jitter": half the delay is fixed, half random.
 *
 * Without jitter, every client that lost the same gateway reconnects in lock-step and
 * hammers it at 1s, 2s, 4s…; full jitter spreads load best but can retry almost
 * immediately, which reads oddly in a "retrying in Ns" UI. Equal jitter is the compromise.
 *
 *   attempt 1 → 0.5–1 s, 2 → 1–2 s, 3 → 2–4 s, 4 → 4–8 s … capped at maxDelayMs
 */
export function backoffDelay(
  attempt: number,
  { baseDelayMs, maxDelayMs, random }: BackoffOptions,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
