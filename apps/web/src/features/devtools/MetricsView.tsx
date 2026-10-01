import type { MetricSummary } from "@pulsedesk/observability";
import { Button } from "@pulsedesk/ui";
import { useEffect, useState } from "react";
import { formatCount } from "@/lib/format";
import { metricsSink } from "@/lib/metrics";

/**
 * Developer metrics view: what this tab has measured since it loaded (or since Reset).
 * Realtime, copilot, rendering and Web Vitals all record into one in-memory sink.
 *
 * Development and devtools builds only (reached through the reliability panel); carries
 * the marker the production bundle check looks for.
 */
const MARKER = "pulsedesk-devtools";

const GROUPS: readonly { title: string; prefix: string }[] = [
  { title: "Realtime", prefix: "websocket." },
  { title: "AI copilot", prefix: "ai." },
  { title: "Rendering", prefix: "session." },
  { title: "Page", prefix: "web." },
];

const MILLISECONDS = /(duration|rtt|first_token|lcp|inp|fcp|ttfb)$/;

function formatValue(name: string, value: number): string {
  if (name.endsWith(".cls")) return value.toFixed(3);
  if (!MILLISECONDS.test(name)) return formatCount(Math.round(value));
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)} s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} s`;
  return value >= 10 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`;
}

/** One line per metric: a total for counters, the latest value for gauges, a spread for histograms. */
function describe(name: string, summary: MetricSummary): { value: string; detail?: string } {
  switch (summary.kind) {
    case "counter":
      return { value: formatCount(summary.sum) };
    case "gauge":
      return { value: formatValue(name, summary.last) };
    case "histogram":
      return {
        value: formatValue(name, summary.sum / summary.count),
        detail: `max ${formatValue(name, summary.max)} · n=${formatCount(summary.count)}`,
      };
  }
}

function useMetricsSnapshot() {
  const [snapshot, setSnapshot] = useState(() => metricsSink.snapshot());
  useEffect(() => {
    const timer = setInterval(() => setSnapshot(metricsSink.snapshot()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return { snapshot, refresh: () => setSnapshot(metricsSink.snapshot()) };
}

export function MetricsView() {
  const { snapshot, refresh } = useMetricsSnapshot();
  const names = Object.keys(snapshot).sort();

  return (
    <div data-devtools={MARKER} className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">Measured in this tab. Histograms show the average.</p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            metricsSink.reset();
            refresh();
          }}
        >
          Reset
        </Button>
      </div>
      {names.length === 0 && <p className="text-xs text-fg-subtle">Nothing recorded yet.</p>}
      {GROUPS.map(({ title, prefix }) => {
        const group = names.filter((name) => name.startsWith(prefix));
        if (group.length === 0) return null;
        return (
          <section key={prefix} aria-label={`${title} metrics`} className="mb-3 last:mb-0">
            <h3 className="mb-1 text-xs font-semibold text-fg-muted">{title}</h3>
            <dl>
              {group.map((name) => {
                const summary = snapshot[name];
                if (!summary) return null;
                const { value, detail } = describe(name, summary);
                return (
                  <div key={name} className="flex items-baseline gap-2 py-0.5">
                    <dt className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-muted">
                      {name.slice(prefix.length)}
                    </dt>
                    {detail && (
                      <span className="shrink-0 font-mono text-[11px] text-fg-subtle tabular-nums">
                        {detail}
                      </span>
                    )}
                    <dd className="w-16 shrink-0 text-right font-mono text-xs text-fg tabular-nums">
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
