import type { RealtimeEvent } from "@pulsedesk/contracts";
import { createRealtimeClient } from "@pulsedesk/realtime-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "./fake-socket.ts";
import { report } from "./report.ts";

const T0 = 1_760_000_000_000;
const CYCLES = 200;

const click = (sequence: number): RealtimeEvent => ({
  type: "session.click",
  eventId: `e${sequence}`,
  sequence,
  sessionId: "s1",
  timestamp: T0 + sequence,
  payload: { element: "cta", label: "Go", path: "/" },
});

beforeEach(() => vi.useFakeTimers({ now: T0 }));
afterEach(() => vi.useRealTimers());

describe("repeated reconnects", () => {
  it(`leaves no sockets, timers or listeners behind after ${CYCLES} drops`, () => {
    const sockets: FakeSocket[] = [];
    const client = createRealtimeClient({
      url: "ws://gateway.test/ws",
      agent: { id: "agent_load", name: "Load Test" },
      resumeFrom: null,
      transport: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const delivered: number[] = [];
    const unsubscribe = client.subscribe((event) => {
      if (event.type === "events") delivered.push(...event.events.map((e) => e.sequence));
    });

    /** Complete the handshake on the newest socket, replaying what was missed. */
    let head = 0;
    const goLive = (missed: number) => {
      const socket = sockets.at(-1) as FakeSocket;
      socket.open();
      socket.receive({
        type: "welcome",
        connectionId: `c${sockets.length}`,
        streamId: "stream",
        serverTime: Date.now(),
        heartbeatIntervalMs: 15_000,
        headSequence: head + missed,
      });
      const hello = socket.sent.find((message) => message.type === "hello");
      if (hello?.type === "hello" && hello.resumeFrom === null) {
        socket.receive({ type: "snapshot", streamId: "stream", sequence: head, sessions: [] });
      } else {
        socket.receive({ type: "sync.started", fromSequence: head + 1, toSequence: head + missed });
        if (missed > 0)
          socket.receive({
            type: "events",
            events: Array.from({ length: missed }, (_, i) => click(head + 1 + i)),
          });
        head += missed;
        socket.receive({ type: "sync.completed", replayedCount: missed, headSequence: head });
      }
    };

    client.connect();
    goLive(0);
    // Timers a healthy, idle connection keeps (heartbeat, stability): the baseline.
    const baselineTimers = vi.getTimerCount();
    expect(client.getState().status).toBe("live");

    let maxOpenSockets = 0;
    let maxTimers = 0;
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      (sockets.at(-1) as FakeSocket).drop();
      expect(client.getState().status).toBe("reconnecting");
      // Whatever the backoff has grown to, wait it out; the cap is 30 s.
      while (sockets.length === cycle) vi.advanceTimersByTime(1_000);
      goLive(3); // three events were missed each time
      expect(client.getState().status).toBe("live");

      maxOpenSockets = Math.max(maxOpenSockets, sockets.filter((s) => s.readyState === 1).length);
      maxTimers = Math.max(maxTimers, vi.getTimerCount());
    }

    report(`reconnects x${CYCLES}`, {
      socketsCreated: sockets.length,
      maxOpenAtOnce: maxOpenSockets,
      timersBaseline: baselineTimers,
      timersMax: maxTimers,
      eventsDelivered: delivered.length,
    });

    // Exactly one live socket at any time, and timers never accumulate across cycles.
    expect(sockets).toHaveLength(CYCLES + 1);
    expect(maxOpenSockets).toBe(1);
    expect(maxTimers).toBeLessThanOrEqual(baselineTimers + 1);
    // Every missed event was delivered exactly once, in order.
    expect(delivered).toEqual(Array.from({ length: CYCLES * 3 }, (_, i) => i + 1));
    expect(client.getStats().reconnectCount).toBe(CYCLES);

    client.close();
    unsubscribe();
    expect(vi.getTimerCount(), "close() cancels every timer").toBe(0);
    expect(sockets.filter((s) => !s.closed && s.readyState === 1)).toHaveLength(0);
    // Advancing time after close must not open anything new.
    vi.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(CYCLES + 1);
  });
});
