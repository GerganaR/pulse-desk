export const GATEWAY_PORT = Number(process.env.PERF_GATEWAY_PORT ?? 4350);
export const gatewayHttp = `http://localhost:${GATEWAY_PORT}`;

/** Batching windows to compare, in ms. The first is the default the app ships with. */
export const DEFAULT_BATCH_MS = 32;
export const BATCH_VARIANTS = [DEFAULT_BATCH_MS, 0, 16, 100] as const;

const WEB_BASE_PORT = Number(process.env.PERF_WEB_PORT ?? 3350);
export const webUrl = (batchMs: number = DEFAULT_BATCH_MS) =>
  `http://localhost:${WEB_BASE_PORT + BATCH_VARIANTS.indexOf(batchMs as (typeof BATCH_VARIANTS)[number])}`;

/** CPU slowdown that stands in for a mid-range laptop or phone (Chrome DevTools' "4x"). */
export const CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 4);

/**
 * Optional: another build to compare page-load cost against (for example the previous
 * commit, built elsewhere and started on this URL with the same gateway).
 */
export const BASELINE_URL = process.env.PERF_BASELINE_URL ?? null;
