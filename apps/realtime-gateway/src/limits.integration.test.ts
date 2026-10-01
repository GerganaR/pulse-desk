import { createLogger } from "@pulsedesk/observability";
import { makeSession } from "@pulsedesk/test-utils";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket as ServerSocket } from "ws";
import { loadConfig, type GatewayConfig } from "./config.ts";
import { createGateway, type Gateway } from "./gateway.ts";
import { startHeartbeat, trackLiveness } from "./websocket/heartbeat.ts";

/**
 * What the gateway refuses: input and load that would otherwise cost memory or keep dead
 * connections alive. Each limit is the only thing between a misbehaving producer or
 * client and every other agent's live view.
 */
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];

async function start(overrides: Partial<GatewayConfig> = {}) {
  const gateway = createGateway({
    config: { ...loadConfig(), ...overrides },
    logger: createLogger({ sink: { write: () => {} } }),
  });
  gateways.push(gateway);
  const port = await gateway.listen(0, "127.0.0.1");
  return { gateway, host: `127.0.0.1:${port}` };
}

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close());
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

const post = (host: string, body: string) =>
  fetch(`http://${host}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

/** Resolves with how the connection attempt ended. */
function open(url: string): Promise<"open" | "refused"> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve("open"), { once: true });
    socket.addEventListener("error", () => resolve("refused"), { once: true });
    socket.addEventListener("close", () => resolve("refused"), { once: true });
  });
}

describe("ingest limits", () => {
  it("rejects a body that isn't JSON", async () => {
    const { host, gateway } = await start();
    const response = await post(host, "{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Body must be JSON" });
    expect(gateway.log.headSequence()).toBe(0);
  });

  it.each([
    ["no events field", {}],
    ["events that aren't a list", { events: "all of them" }],
    ["more events than one batch may hold", { events: Array.from({ length: 501 }, () => ({})) }],
  ])("rejects a batch with %s", async (_, body) => {
    const { host } = await start();
    const response = await post(host, JSON.stringify(body));
    expect(response.status).toBe(400);
  });

  it("stops reading a body past the size limit instead of buffering it", async () => {
    const { host, gateway } = await start({ maxIngestBodyBytes: 1_024 });
    const response = await post(host, JSON.stringify({ events: [], padding: "x".repeat(4_096) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Batch too large" });
    expect(gateway.log.headSequence()).toBe(0);
  });

  it("still accepts a valid batch right at the service's normal settings", async () => {
    const { host } = await start();
    const response = await post(
      host,
      JSON.stringify({
        events: [
          {
            type: "session.created",
            eventId: "c1",
            sessionId: "ses_1",
            timestamp: Date.now(),
            payload: { session: makeSession({ id: "ses_1" }) },
          },
        ],
      }),
    );
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: [] });
  });
});

describe("HTTP surface", () => {
  it("reports liveness with the stream position and load", async () => {
    const { host, gateway } = await start();
    const response = await fetch(`http://${host}/healthz`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      streamId: gateway.log.streamId,
      headSequence: 0,
      sessions: 0,
      connections: 0,
    });
  });

  it.each([
    ["GET", "/"],
    ["GET", "/ingest"],
    ["POST", "/sessions"],
    ["DELETE", "/sessions/ses_1"],
    ["GET", "/sessions/ses_1/events"],
  ])("answers 404 for %s %s", async (method, path) => {
    const { host } = await start();
    expect((await fetch(`http://${host}${path}`, { method })).status).toBe(404);
  });
});

describe("connection limits", () => {
  it("accepts WebSocket upgrades on /ws only", async () => {
    const { host } = await start();
    expect(await open(`ws://${host}/ws`)).toBe("open");
    expect(await open(`ws://${host}/`)).toBe("refused");
    expect(await open(`ws://${host}/ws/extra`)).toBe("refused");
  });

  it("refuses connections beyond the cap, and accepts again once one leaves", async () => {
    const { host } = await start({ maxConnections: 2 });
    expect(await open(`ws://${host}/ws`)).toBe("open");
    expect(await open(`ws://${host}/ws`)).toBe("open");
    expect(await open(`ws://${host}/ws`)).toBe("refused");

    sockets[0]!.close();
    await vi.waitFor(async () => {
      const health = (await (await fetch(`http://${host}/healthz`)).json()) as {
        connections: number;
      };
      expect(health.connections).toBe(1);
    });
    expect(await open(`ws://${host}/ws`)).toBe("open");
  });
});

describe("liveness heartbeat", () => {
  class FakeSocket extends EventEmitter {
    ping = vi.fn();
    terminate = vi.fn();
  }
  const asSocket = (socket: FakeSocket) => socket as unknown as ServerSocket;

  afterEach(() => vi.useRealTimers());

  it("terminates a socket that missed a whole interval, and keeps one that answers", () => {
    vi.useFakeTimers();
    const answering = new FakeSocket();
    const silent = new FakeSocket();
    for (const socket of [answering, silent]) trackLiveness(asSocket(socket));
    const stop = startHeartbeat(() => [answering, silent].map(asSocket), 1_000);

    vi.advanceTimersByTime(1_000); // first round: both are pinged
    expect(answering.ping).toHaveBeenCalledTimes(1);
    expect(silent.ping).toHaveBeenCalledTimes(1);
    answering.emit("pong");

    vi.advanceTimersByTime(1_000); // second round: only one answered
    expect(silent.terminate).toHaveBeenCalledTimes(1);
    expect(answering.terminate).not.toHaveBeenCalled();
    expect(answering.ping).toHaveBeenCalledTimes(2);
    expect(silent.ping).toHaveBeenCalledTimes(1); // a dead socket isn't pinged again

    stop();
    vi.advanceTimersByTime(5_000);
    expect(answering.ping).toHaveBeenCalledTimes(2);
  });

  it("gives a new connection a full interval before judging it", () => {
    vi.useFakeTimers();
    const fresh = new FakeSocket();
    trackLiveness(asSocket(fresh));
    const stop = startHeartbeat(() => [asSocket(fresh)], 1_000);
    vi.advanceTimersByTime(1_000);
    expect(fresh.terminate).not.toHaveBeenCalled();
    stop();
  });
});

describe("configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("falls back to the default for a missing, empty or non-numeric value", () => {
    const defaults = loadConfig();
    for (const value of ["", "lots", "NaN"]) {
      vi.stubEnv("MAX_CONNECTIONS", value);
      expect(loadConfig().maxConnections).toBe(defaults.maxConnections);
    }
  });

  it("reads numeric overrides from the environment", () => {
    vi.stubEnv("MAX_CONNECTIONS", "25");
    vi.stubEnv("PRESENCE_GRACE_MS", "0");
    expect(loadConfig()).toMatchObject({ maxConnections: 25, presenceGraceMs: 0 });
  });
});
