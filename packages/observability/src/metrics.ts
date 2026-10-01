/**
 * Metrics API. Instrumented code depends only on `Metrics`; where points go is a sink
 * (console, in-memory for tests and the dev panel, or a real backend adapter later).
 */

/** Catalogue of metric names. Adding a metric is a deliberate change, typos don't compile. */
export type MetricName =
  | "websocket.connection.duration"
  | "websocket.connect.attempts"
  | "websocket.reconnect.count"
  | "websocket.events.received"
  | "websocket.events.dropped"
  | "websocket.frames.invalid"
  | "websocket.batch.size"
  | "websocket.heartbeat.rtt"
  | "websocket.heartbeat.timeouts"
  | "websocket.gaps.detected"
  | "websocket.resync.count"
  | "gateway.connections.active"
  | "gateway.events.ingested"
  | "gateway.events.rejected"
  | "gateway.broadcast.duration"
  | "gateway.backpressure.disconnects"
  | "ai.request.duration"
  | "ai.request.first_token"
  | "ai.request.cancelled"
  | "ai.request.failed"
  | "ai.answer.unverified_claims"
  | "session.timeline.render.duration";

export type MetricKind = "counter" | "gauge" | "histogram";
export type Tags = Readonly<Record<string, string>>;

export interface MetricPoint {
  kind: MetricKind;
  name: MetricName;
  value: number;
  tags: Tags;
  timestamp: number;
}

export interface MetricSink {
  record(point: MetricPoint): void;
}

export interface Metrics {
  increment(name: MetricName, value?: number, tags?: Tags): void;
  gauge(name: MetricName, value: number, tags?: Tags): void;
  histogram(name: MetricName, value: number, tags?: Tags): void;
  /** Starts a timer; calling the returned function records the elapsed ms as a histogram. */
  startTimer(name: MetricName, tags?: Tags): () => number;
}

const NO_TAGS: Tags = Object.freeze({});

export function createMetrics(sink: MetricSink, now: () => number = () => Date.now()): Metrics {
  const record = (kind: MetricKind, name: MetricName, value: number, tags: Tags = NO_TAGS) =>
    sink.record({ kind, name, value, tags, timestamp: now() });

  return {
    increment: (name, value = 1, tags) => record("counter", name, value, tags),
    gauge: (name, value, tags) => record("gauge", name, value, tags),
    histogram: (name, value, tags) => record("histogram", name, value, tags),
    startTimer(name, tags) {
      const start = performance.now();
      return () => {
        const elapsed = performance.now() - start;
        record("histogram", name, elapsed, tags);
        return elapsed;
      };
    },
  };
}

export const noopMetrics: Metrics = createMetrics({ record: () => {} });

export interface MetricSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  last: number;
}

/**
 * Aggregates points in memory, per metric name (tags ignored). Used by tests and the
 * dev reliability panel. Bounded: it keeps aggregates, not raw points.
 */
export function createMemorySink() {
  const summaries = new Map<MetricName, MetricSummary>();
  return {
    record(point: MetricPoint) {
      const current = summaries.get(point.name);
      if (!current) {
        summaries.set(point.name, {
          count: 1,
          sum: point.value,
          min: point.value,
          max: point.value,
          last: point.value,
        });
        return;
      }
      current.count++;
      current.sum += point.value;
      current.min = Math.min(current.min, point.value);
      current.max = Math.max(current.max, point.value);
      current.last = point.value;
    },
    get(name: MetricName): MetricSummary | undefined {
      return summaries.get(name);
    },
    snapshot(): Record<string, MetricSummary> {
      return Object.fromEntries([...summaries].map(([name, summary]) => [name, { ...summary }]));
    },
    reset() {
      summaries.clear();
    },
  } satisfies MetricSink & Record<string, unknown>;
}

/** Fan out to several sinks (e.g. memory for the dev panel + a remote backend). */
export function combineSinks(...sinks: MetricSink[]): MetricSink {
  return { record: (point) => sinks.forEach((sink) => sink.record(point)) };
}
