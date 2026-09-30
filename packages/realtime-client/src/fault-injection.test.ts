import type { ServerMessage } from "@pulsedesk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFaultInjector } from "./fault-injection.ts";
import { FakeSocket, clickEvent as event } from "./test/fake-socket.ts";
import type { WebSocketLike } from "./transport.ts";

let real: FakeSocket[];

function setup() {
  real = [];
  const injector = createFaultInjector((url) => {
    const socket = new FakeSocket(url);
    real.push(socket);
    return socket;
  });
  const socket = injector.transport("ws://gateway/ws");
  const frames: ServerMessage[] = [];
  const closes: number[] = [];
  socket.addEventListener("message", ({ data }) => frames.push(JSON.parse(String(data))));
  socket.addEventListener("close", ({ code }) => closes.push(code));
  real[0]!.open();
  const sequences = () =>
    frames.flatMap((f) => (f.type === "events" ? f.events.map((e) => e.sequence) : []));
  const push = (...sequences: number[]) =>
    real[0]!.receive({ type: "events", events: sequences.map((s) => event(s)) });
  return { injector, socket, frames, closes, sequences, push };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fault injector", () => {
  it("passes frames through untouched when no fault is armed", () => {
    const { sequences, push, socket } = setup();
    push(1, 2);
    expect(sequences()).toEqual([1, 2]);
    expect(socket.readyState).toBe(1);
  });

  it("drops the next N events across frames, then stops", () => {
    const { injector, sequences, push } = setup();
    injector.dropEvents(3);
    push(1, 2);
    push(3, 4);
    push(5);
    expect(sequences()).toEqual([4, 5]);
    expect(injector.getState().dropRemaining).toBe(0);
    expect(injector.getLog()[0]?.message).toContain("#3");
  });

  it("duplicates the next event once", () => {
    const { injector, sequences, push } = setup();
    injector.duplicateNextEvent();
    push(1, 2);
    push(3);
    expect(sequences()).toEqual([1, 2, 1, 3]);
  });

  it("delivers a held single-event batch after the next one", () => {
    const { injector, sequences, push } = setup();
    injector.reorderNextBatch();
    push(1);
    expect(sequences()).toEqual([]);
    push(2);
    expect(sequences()).toEqual([2, 1]);
  });

  it("releases a held batch on its own if the stream goes quiet", () => {
    const { injector, sequences, push } = setup();
    injector.reorderNextBatch();
    push(1);
    vi.advanceTimersByTime(1_000);
    expect(sequences()).toEqual([1]);
  });

  it("reverses a multi-event batch", () => {
    const { injector, sequences, push } = setup();
    injector.reorderNextBatch();
    push(1, 2, 3);
    expect(sequences()).toEqual([3, 2, 1]);
  });

  it("adds latency without ever reordering frames", () => {
    const { injector, sequences, push } = setup();
    injector.setLatency(300);
    push(1);
    vi.advanceTimersByTime(100);
    injector.setLatency(0); // a later frame with less delay must still arrive second
    push(2);
    expect(sequences()).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(sequences()).toEqual([1, 2]);
  });

  it("disconnect() drops live sockets abnormally and fails new ones until restore()", () => {
    const { injector, closes } = setup();
    injector.disconnect();
    expect(closes).toEqual([1006]);

    const attempt: WebSocketLike = injector.transport("ws://gateway/ws");
    const attemptCloses: number[] = [];
    attempt.addEventListener("close", ({ code }) => attemptCloses.push(code));
    vi.advanceTimersByTime(100);
    expect(attemptCloses).toEqual([1006]);
    expect(real).toHaveLength(1); // never reached the network

    injector.restore();
    injector.transport("ws://gateway/ws");
    expect(real).toHaveLength(2);
  });

  it("stops delivering to a socket after it was cut", () => {
    const { injector, sequences, push } = setup();
    injector.setLatency(100);
    push(1);
    injector.disconnect();
    vi.advanceTimersByTime(200);
    expect(sequences()).toEqual([]);
  });
});
