import type { ClientMessage, RealtimeEvent, ServerMessage } from "@pulsedesk/contracts";
import type { WebSocketLike } from "@pulsedesk/realtime-client";
import {
  CLOSED_SESSION_RETENTION_MS,
  createPulseStore,
  selectSessionById,
  snapshotReceived,
} from "@pulsedesk/state";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startConnection, type Connection } from "./connection";

const T0 = 1_760_000_000_000;

/** Just enough WebSocket for the client: the test plays the gateway. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  closed = false;
  #listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: never) => void) {
    this.#listeners.set(type, [
      ...(this.#listeners.get(type) ?? []),
      listener as (event: unknown) => void,
    ]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.#listeners.get("open")?.forEach((listener) => listener({}));
  }
  receive(message: ServerMessage) {
    this.#listeners
      .get("message")
      ?.forEach((listener) => listener({ data: JSON.stringify(message) }));
  }
}

const pageView = (sequence: number, sessionId: string, path: string): RealtimeEvent => ({
  type: "session.page_view",
  eventId: `e${sequence}`,
  sequence,
  sessionId,
  timestamp: T0 + sequence,
  payload: { path, title: path },
});

function setup(sessions = [makeSession({ id: "s1", pageViews: 1 })]) {
  const store = createPulseStore({
    extra: {
      api: {
        fetchSessionsSnapshot: () => new Promise(() => {}),
        fetchSessionDetail: () => new Promise(() => {}),
      },
    },
  });
  store.dispatch(snapshotReceived({ streamId: "stream-1", sequence: 10, sessions }));
  const sockets: FakeSocket[] = [];
  const connection = startConnection({
    gatewayUrl: "ws://gateway.test/ws",
    devTools: false,
    getState: store.getState,
    dispatch: store.dispatch,
    transport: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const socket = sockets[0]!;
  socket.open();
  socket.receive({
    type: "welcome",
    connectionId: "c1",
    streamId: "stream-1",
    serverTime: T0,
    heartbeatIntervalMs: 15_000,
    headSequence: 10,
  });
  socket.receive({ type: "sync.started", fromSequence: 11, toSequence: 10 });
  socket.receive({ type: "sync.completed", replayedCount: 0, headSequence: 10 });
  return { store, socket, connection };
}

let connection: Connection | undefined;

beforeEach(() => vi.useFakeTimers({ now: T0 }));
afterEach(() => {
  connection?.stop();
  connection = undefined;
  vi.useRealTimers();
});

describe("startConnection", () => {
  it("resumes from the stream position the store already reflects", () => {
    const { socket, store, connection: started } = setup();
    connection = started;
    expect(socket.sent[0]).toMatchObject({
      type: "hello",
      resumeFrom: { streamId: "stream-1", sequence: 10 },
    });
    expect(store.getState().connection.status).toBe("live");
  });

  it("applies a burst of frames as one store update", () => {
    const { socket, store, connection: started } = setup();
    connection = started;
    const updates = vi.fn();
    store.subscribe(updates);

    for (let sequence = 11; sequence <= 60; sequence++)
      socket.receive({ type: "events", events: [pageView(sequence, "s1", `/p${sequence}`)] });

    expect(updates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(32);

    expect(updates).toHaveBeenCalledOnce();
    expect(selectSessionById(store.getState(), "s1")).toMatchObject({
      currentPath: "/p60",
      pageViews: 51,
    });
  });

  it("drops ended sessions past retention when another session ends", () => {
    const longAgo = T0 - CLOSED_SESSION_RETENTION_MS - 60_000;
    const {
      socket,
      store,
      connection: started,
    } = setup([
      makeSession({ id: "s1" }),
      makeSession({ id: "old", status: "closed", endedAt: longAgo, lastActivityAt: longAgo }),
    ]);
    connection = started;

    socket.receive({ type: "events", events: [pageView(11, "s1", "/pricing")] });
    vi.advanceTimersByTime(32);
    expect(store.getState().sessions.ids).toContain("old"); // activity alone doesn't prune

    socket.receive({
      type: "events",
      events: [
        {
          type: "session.closed",
          eventId: "e12",
          sequence: 12,
          sessionId: "s1",
          timestamp: T0,
          payload: { reason: "tab_closed" },
        },
      ],
    });
    vi.advanceTimersByTime(32);

    expect(store.getState().sessions.ids).toEqual(["s1"]);
    expect(selectSessionById(store.getState(), "s1")?.status).toBe("closed");
  });

  it("stop() closes the socket and applies what was still buffered", () => {
    const { socket, store, connection: started } = setup();
    socket.receive({ type: "events", events: [pageView(11, "s1", "/checkout")] });

    started.stop();

    expect(socket.closed).toBe(true);
    expect(selectSessionById(store.getState(), "s1")?.currentPath).toBe("/checkout");
    expect(vi.getTimerCount()).toBe(0);
  });
});
