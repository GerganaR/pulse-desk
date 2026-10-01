import { createMemorySink, createMetrics } from "@pulsedesk/observability";

/**
 * This tab's metrics, aggregated in memory. Everything the browser measures (realtime,
 * the copilot, rendering, Web Vitals) records here; the dev reliability panel reads it.
 * A production deployment would add a sink that ships points to a backend.
 */
export const metricsSink = createMemorySink();
export const metrics = createMetrics(metricsSink);
