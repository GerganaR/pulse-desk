const env = process.env;
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  gatewayUrl: env.GATEWAY_HTTP_URL ?? "http://localhost:4000",
  /** Target concurrent live sessions. */
  sessionCount: number(env.SESSION_COUNT, 24),
  /** Approximate events per second across all sessions. */
  eventRate: number(env.EVENT_RATE, 3),
  /** Fraction of events sent malformed, to exercise gateway validation (0–1). */
  errorRate: number(env.ERROR_RATE, 0.01),
  /** Fixed seed for reproducible traffic (E2E tests); random when unset. */
  seed: env.SEED ? number(env.SEED, 1) : Math.floor(Math.random() * 2 ** 31),
  tickMs: number(env.TICK_MS, 250),
  maxOutbox: 10_000,
  maxBatch: 500,
};
