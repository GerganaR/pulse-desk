import type { ClientMessage, RealtimeEvent, ServerMessage } from "@pulsedesk/contracts";
import type { WebSocketLike } from "@pulsedesk/realtime-client";
import {
  CLOSED_SESSION_RETENTION_MS,
  createPulseStore,
  selectNotifications,
  selectSessionById,
  snapshotReceived,
} from "@pulsedesk/state";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startConnection, type Connection } from "./connection";
import { PROLONGED_OUTAGE_MS } from "./outage";

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
  /** The connection is lost (not closed by the client). */
  drop(code = 1006) {
    this.readyState = 3;
    this.#listeners.get("close")?.forEach((listener) => listener({ code }));
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
  return { store, socket, sockets, connection };
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

describe("recovery notices", () => {
  const welcome = (streamId = "stream-1"): ServerMessage => ({
    type: "welcome",
    connectionId: "c2",
    streamId,
    serverTime: T0,
    heartbeatIntervalMs: 15_000,
    headSequence: 12,
  });

  /** Loses the connection, waits `downForMs`, then lets the next attempt's socket open. */
  function reconnectAfter(sockets: FakeSocket[], downForMs: number) {
    sockets.at(-1)!.drop();
    vi.advanceTimersByTime(downForMs);
    // Attempts made in the meantime never opened; the client keeps trying.
    for (let waited = 0; sockets.at(-1)!.readyState === 3 && waited < 120_000; waited += 250)
      vi.advanceTimersByTime(250);
    const socket = sockets.at(-1)!;
    socket.open();
    return socket;
  }

  function replay(socket: FakeSocket, count: number) {
    socket.receive(welcome());
    socket.receive({ type: "sync.started", fromSequence: 11, toSequence: 10 + count });
    if (count > 0)
      socket.receive({
        type: "events",
        events: Array.from({ length: count }, (_, i) => pageView(11 + i, "s1", `/p${11 + i}`)),
      });
    socket.receive({ type: "sync.completed", replayedCount: count, headSequence: 10 + count });
  }

  it("says nothing after a short blip: the status pill is enough", () => {
    const { sockets, store, connection: started } = setup();
    connection = started;
    const socket = reconnectAfter(sockets, 1_000);
    expect(store.getState().connection.status).not.toBe("live");
    replay(socket, 2);

    expect(store.getState().connection.status).toBe("live");
    expect(selectSessionById(store.getState(), "s1")?.currentPath).toBe("/p12");
    expect(selectNotifications(store.getState())).toEqual([]);
  });

  it("announces recovery once after a prolonged outage, with what was caught up", () => {
    const { sockets, store, connection: started } = setup();
    connection = started;
    replay(reconnectAfter(sockets, PROLONGED_OUTAGE_MS + 5_000), 2);

    expect(selectNotifications(store.getState())).toMatchObject([
      {
        tone: "success",
        title: "Live updates restored",
        description: "Caught up on 2 missed events.",
      },
    ]);
  });

  it("uses the singular for one missed event, and no detail when nothing was missed", () => {
    const one = setup();
    replay(reconnectAfter(one.sockets, PROLONGED_OUTAGE_MS + 1_000), 1);
    expect(selectNotifications(one.store.getState())[0]?.description).toBe(
      "Caught up on 1 missed event.",
    );
    one.connection.stop();

    const none = setup();
    connection = none.connection;
    replay(reconnectAfter(none.sockets, PROLONGED_OUTAGE_MS + 1_000), 0);
    expect(selectNotifications(none.store.getState())).toMatchObject([
      { title: "Live updates restored", description: null },
    ]);
  });

  it("explains a gateway restart even after a short blip, and reloads the sessions", () => {
    const { sockets, store, connection: started } = setup();
    connection = started;
    const socket = reconnectAfter(sockets, 1_000);
    socket.receive(welcome("stream-2"));
    socket.receive({
      type: "snapshot",
      streamId: "stream-2",
      sequence: 3,
      sessions: [makeSession({ id: "s9" })],
    });

    expect(store.getState().sessions).toMatchObject({ streamId: "stream-2", ids: ["s9"] });
    expect(selectNotifications(store.getState())).toMatchObject([
      {
        title: "Live updates restored",
        description: "The gateway restarted, so sessions were reloaded from a fresh snapshot.",
      },
    ]);
  });

  it("explains a reload when too much was missed to replay", () => {
    const { sockets, store, connection: started } = setup();
    connection = started;
    const socket = reconnectAfter(sockets, 1_000);
    socket.receive(welcome());
    socket.receive({
      type: "snapshot",
      streamId: "stream-1",
      sequence: 90_000,
      sessions: [makeSession({ id: "s1", pageViews: 40 })],
    });

    expect(selectSessionById(store.getState(), "s1")?.pageViews).toBe(40);
    expect(selectNotifications(store.getState())[0]?.description).toBe(
      "Too much happened while offline to replay, so sessions were reloaded.",
    );
  });

  it("a snapshot discards events still waiting in the batch: it already includes them", () => {
    const { socket, store, connection: started } = setup();
    connection = started;
    socket.receive({ type: "events", events: [pageView(11, "s1", "/stale")] });
    socket.receive({
      type: "snapshot",
      streamId: "stream-1",
      sequence: 11,
      sessions: [makeSession({ id: "s1", pageViews: 2, currentPath: "/from-snapshot" })],
    });
    vi.advanceTimersByTime(1_000);

    expect(selectSessionById(store.getState(), "s1")).toMatchObject({
      pageViews: 2,
      currentPath: "/from-snapshot",
    });
  });
});
