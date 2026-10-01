import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import type { Metrics } from "./metrics.ts";

/**
 * Reports Core Web Vitals (LCP, INP, CLS) plus FCP and TTFB as gauges.
 *
 * Browser-only, behind its own entry point (`@pulsedesk/observability/web-vitals`) so
 * Node consumers never load it, and so the app can import it lazily: the browser buffers
 * the underlying performance entries, so nothing is missed by starting after hydration.
 *
 * Values are reported as they change (not only when the page is hidden), because the
 * first consumer is a live developer view. Each point carries the standard rating
 * ("good", "needs-improvement", "poor") as a tag.
 */
export function reportWebVitals(metrics: Metrics): void {
  const options = { reportAllChanges: true };
  onLCP((vital) => metrics.gauge("web.vitals.lcp", vital.value, { rating: vital.rating }), options);
  onINP((vital) => metrics.gauge("web.vitals.inp", vital.value, { rating: vital.rating }), options);
  onCLS((vital) => metrics.gauge("web.vitals.cls", vital.value, { rating: vital.rating }), options);
  onFCP((vital) => metrics.gauge("web.vitals.fcp", vital.value, { rating: vital.rating }));
  onTTFB((vital) => metrics.gauge("web.vitals.ttfb", vital.value, { rating: vital.rating }));
}
