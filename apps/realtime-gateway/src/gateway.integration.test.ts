import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  type ServerMessage,
  type StreamCursor,
  type UnsequencedEvent,
} from "@pulsedesk/contracts";
import { createLogger } from "@pulsedesk/observability";
import { makeSession } from "@pulsedesk/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { createGateway, type Gateway } from "./gateway.ts";

const agent = { id: "agent_1", name: "Jordan Lee" };
let gateway: Gateway;
let baseUrl: string;
const openSockets: WebSocket[] = [];
let counter = 0;

beforeEach(async () => {
  gateway = createGateway({
    config: loadConfig(),
    logger: createLogger({ sink: { write: () => {} } }),
  });
  const port = await gateway.listen(0, "127.0.0.1");
  baseUrl = `127.0.0.1:${port}`;
});

afterEach(async () => {
  openSockets.forEach((s) => s.close());
  await gateway.close();
});

const created = (id: string): UnsequencedEvent => ({
  type: "session.created",
  eventId: `c${++counter}`,
  sessionId: id,
  timestamp: Date.now(),
  payload: { session: makeSession({ id }) },
});
const click = (id: string): UnsequencedEvent => ({
  type: "session.click",
  eventId: `k${++counter}`,
  sessionId: id,
  timestamp: Date.now(),
  payload: { element: "cta", label: "Upgrade", path: "/pricing" },
});

async function ingest(events: UnsequencedEvent[]) {
  const response = await fetch(`http://${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
  return response.json() as Promise<{ accepted: number }>;
}

/** A test client that records every (validated) server message. */
async function connect(resumeFrom: StreamCursor | null) {
  const socket = new WebSocket(`ws://${baseUrl}/ws`);
  openSockets.push(socket);
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.addEventListener("message", (event) => {
    messages.push(ServerMessageSchema.parse(JSON.parse(String(event.data))));
    waiters.splice(0).forEach((wake) => wake());
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(
    JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, agent, resumeFrom }),
  );

  const waitFor = async (predicate: (m: ServerMessage[]) => boolean, timeoutMs = 2_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(messages)) {
      if (Date.now() > deadline)
        throw new Error(`Timed out; got ${JSON.stringify(messages.map((m) => m.type))}`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };
  const sequences = () =>
    messages.flatMap((m) => (m.type === "events" ? m.events.map((e) => e.sequence) : []));
  return {
    socket,
    messages,
    waitFor,
    sequences,
    send: (m: unknown) => socket.send(JSON.stringify(m)),
  };
}

describe("realtime gateway (integration)", () => {
  it("first connection gets welcome + snapshot, then live events", async () => {
    await ingest([created("s1")]);
    const client = await connect(null);
    await client.waitFor((m) => m.some((x) => x.type === "snapshot"));

    const [welcome, snapshot] = client.messages;
    expect(welcome).toMatchObject({
      type: "welcome",
      streamId: gateway.log.streamId,
      headSequence: 1,
    });
    expect(snapshot).toMatchObject({ type: "snapshot", sequence: 1 });
    if (snapshot?.type === "snapshot") expect(snapshot.sessions.map((s) => s.id)).toEqual(["s1"]);

    await ingest([click("s1"), click("s1")]);
    await client.waitFor(() => client.sequences().length === 2);
    expect(client.sequences()).toEqual([2, 3]);
  });

  it("a reconnecting client receives exactly the events it missed, in order", async () => {
    await ingest([created("s1"), click("s1")]); // seq 1, 2
    const cursor = { streamId: gateway.log.streamId, sequence: 2 };
    await ingest([click("s1"), click("s1"), click("s1")]); // seq 3, 4, 5 while "offline"

    const client = await connect(cursor);
    await client.waitFor((m) => m.some((x) => x.type === "sync.completed"));
    expect(client.messages.map((m) => m.type)).toEqual([
      "welcome",
      "sync.started",
      "events",
      "sync.completed",
    ]);
    expect(client.sequences()).toEqual([3, 4, 5]);

    await ingest([click("s1")]);
    await client.waitFor(() => client.sequences().length === 4);
    expect(client.sequences()).toEqual([3, 4, 5, 6]); // live continues with no gap or duplicate
  });

  it("a cursor from another stream epoch gets a fresh snapshot, not a bogus replay", async () => {
    await ingest([created("s1")]);
    const client = await connect({ streamId: "previous-gateway-boot", sequence: 1 });
    await client.waitFor((m) => m.some((x) => x.type === "snapshot"));
    expect(client.messages.some((m) => m.type === "sync.started")).toBe(false);
  });

  it("serves session detail with its timeline and current viewers", async () => {
    await ingest([created("s1"), click("s1")]);
    const client = await connect(null);
    await client.waitFor((m) => m.some((x) => x.type === "snapshot"));
    client.send({ type: "session.watch", sessionId: "s1" });
    await client.waitFor(() => client.sequences().length === 1); // presence.joined broadcast

    const detail = (await (await fetch(`http://${baseUrl}/sessions/s1`)).json()) as {
      events: { type: string }[];
      viewers: unknown[];
    };
    expect(detail.events.map((e) => e.type)).toEqual([
      "session.created",
      "session.click",
      "presence.joined",
    ]);
    expect(detail.viewers).toEqual([agent]);
  });

  it("publishes presence.left when a watching client disconnects", async () => {
    await ingest([created("s1")]);
    const watcher = await connect(null);
    const observer = await connect(null);
    await watcher.waitFor((m) => m.some((x) => x.type === "snapshot"));
    await observer.waitFor((m) => m.some((x) => x.type === "snapshot"));

    watcher.send({ type: "session.watch", sessionId: "s1" });
    await observer.waitFor(() => observer.sequences().length === 1);
    watcher.socket.close();

    await observer.waitFor(() => observer.sequences().length === 2);
    const events = observer.messages.flatMap((m) => (m.type === "events" ? m.events : []));
    expect(events.map((e) => e.type)).toEqual(["presence.joined", "presence.left"]);
  });

  it("answers malformed client messages with an error instead of crashing", async () => {
    const client = await connect(null);
    client.send({ type: "nonsense" });
    await client.waitFor((m) => m.some((x) => x.type === "error"));
    expect(client.messages.find((m) => m.type === "error")).toMatchObject({ code: "bad_request" });
  });

  it("returns 404 for unknown sessions", async () => {
    expect((await fetch(`http://${baseUrl}/sessions/nope`)).status).toBe(404);
  });
});
