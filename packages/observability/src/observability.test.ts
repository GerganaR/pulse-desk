import { describe, expect, it } from "vitest";
import { createLogger, type LogRecord } from "./logger.ts";
import { createMemorySink, createMetrics } from "./metrics.ts";

describe("metrics", () => {
  it("aggregates counters and histograms in memory", () => {
    const sink = createMemorySink();
    const metrics = createMetrics(sink);
    metrics.increment("websocket.events.received", 5);
    metrics.increment("websocket.events.received", 3);
    metrics.histogram("websocket.batch.size", 10);
    metrics.histogram("websocket.batch.size", 2);

    expect(sink.get("websocket.events.received")).toMatchObject({
      kind: "counter",
      count: 2,
      sum: 8,
    });
    expect(sink.get("websocket.batch.size")).toMatchObject({
      kind: "histogram",
      min: 2,
      max: 10,
      last: 2,
    });
  });

  it("keeps the latest value of a gauge", () => {
    const sink = createMemorySink();
    const metrics = createMetrics(sink);
    metrics.gauge("web.vitals.lcp", 1_800, { rating: "good" });
    metrics.gauge("web.vitals.lcp", 2_100, { rating: "good" });
    expect(sink.get("web.vitals.lcp")).toMatchObject({ kind: "gauge", last: 2_100, count: 2 });
  });

  it("reset() forgets everything", () => {
    const sink = createMemorySink();
    createMetrics(sink).increment("websocket.reconnect.count");
    sink.reset();
    expect(sink.snapshot()).toEqual({});
  });

  it("timers record elapsed time", () => {
    const sink = createMemorySink();
    const stop = createMetrics(sink).startTimer("ai.request.duration");
    const elapsed = stop();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(sink.get("ai.request.duration")?.count).toBe(1);
  });
});

describe("logger", () => {
  it("filters by level and merges child fields", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: { write: (r) => records.push(r) },
      level: "info",
      fields: { service: "gw" },
    });
    logger.debug("hidden");
    logger.child({ connectionId: "c1" }).warn("slow consumer", { bufferedBytes: 1024 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "warn",
      message: "slow consumer",
      fields: { service: "gw", connectionId: "c1", bufferedBytes: 1024 },
    });
  });
});
