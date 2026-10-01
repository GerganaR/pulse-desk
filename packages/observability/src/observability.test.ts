import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, errorFields, jsonConsoleSink, type LogRecord } from "./logger.ts";
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

describe("log output", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON object per line, on the console method for its level", () => {
    const output = {
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    const logger = createLogger({ sink: jsonConsoleSink, fields: { service: "gateway" } });
    logger.info("gateway.listening", { port: 4000 });
    logger.warn("client.slow_consumer");
    logger.error("http.unhandled", errorFields(new Error("boom")));

    const lines = [output.info, output.warn, output.error].map((spy) => {
      expect(spy).toHaveBeenCalledOnce();
      const line = String(spy.mock.calls[0]![0]);
      expect(line).not.toContain("\n");
      return JSON.parse(line) as Record<string, unknown>;
    });
    expect(lines[0]).toMatchObject({
      level: "info",
      msg: "gateway.listening",
      service: "gateway",
      port: 4000,
    });
    expect(new Date(String(lines[0]!.time)).toISOString()).toBe(lines[0]!.time);
    expect(lines[1]).toMatchObject({ level: "warn", msg: "client.slow_consumer" });
    expect(lines[2]).toMatchObject({ level: "error", error: "boom" });
    expect(String(lines[2]!.stack)).toContain("Error: boom");
  });

  it("lets a later field override an earlier one: call site over child over logger", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: { write: (r) => records.push(r) },
      fields: { a: 1, b: 1 },
    });
    logger.child({ b: 2, c: 2 }).info("x", { c: 3 });
    expect(records[0]!.fields).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("a child keeps its parent's level", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ sink: { write: (r) => records.push(r) }, level: "error" });
    logger.child({ id: 1 }).warn("dropped");
    logger.child({ id: 1 }).error("kept");
    expect(records.map((r) => r.message)).toEqual(["kept"]);
  });

  it("describes anything thrown, not only Errors", () => {
    expect(errorFields("just a string")).toEqual({ error: "just a string" });
    expect(errorFields(undefined)).toEqual({ error: "undefined" });
    expect(errorFields({ code: 7 })).toEqual({ error: "[object Object]" });
  });
});
