// @vitest-environment node
import type { SessionsSnapshot } from "@pulsedesk/contracts";
import { makeSession } from "@pulsedesk/test-utils";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayError, createGatewaySessionsSource } from "./gateway-sessions-source";

const session = makeSession({ id: "ses_1" });
const snapshot: SessionsSnapshot = { streamId: "s", sequence: 4, sessions: [session] };
const detail = { streamId: "s", sequence: 4, session, events: [], truncated: false, viewers: [] };

const servers: http.Server[] = [];
/** A stand-in gateway; returns the source that reads from it and the paths it was asked for. */
async function gateway(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  timeoutMs = 2_000,
) {
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    requested.push(req.url ?? "");
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { source: createGatewaySessionsSource({ baseUrl, timeoutMs }), requested, baseUrl };
}

const json = (status: number, body: unknown) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

describe("gateway sessions source", () => {
  it("returns the validated sessions snapshot", async () => {
    const { source, requested } = await gateway(json(200, snapshot));
    await expect(source.getSnapshot()).resolves.toEqual(snapshot);
    expect(requested).toEqual(["/sessions"]);
  });

  it("returns a session's detail, with the id safely encoded in the URL", async () => {
    const { source, requested } = await gateway(json(200, detail));
    await expect(source.getSessionDetail("ses_1/../admin?x=1")).resolves.toMatchObject({
      session: { id: "ses_1" },
    });
    expect(requested).toEqual(["/sessions/ses_1%2F..%2Fadmin%3Fx%3D1"]);
  });

  it("answers null for a session the gateway doesn't have", async () => {
    const { source } = await gateway(json(404, { error: "Session not found" }));
    await expect(source.getSessionDetail("ses_gone")).resolves.toBeNull();
  });

  it("treats a missing sessions endpoint as a failure, not as an empty list", async () => {
    const { source } = await gateway(json(404, {}));
    await expect(source.getSnapshot()).rejects.toMatchObject({ name: "GatewayError", status: 404 });
  });

  it("reports the gateway's status when it answers with an error", async () => {
    const { source } = await gateway(json(500, { error: "boom" }));
    await expect(source.getSnapshot()).rejects.toMatchObject({
      message: "Realtime gateway responded 500",
      status: 500,
    });
  });

  it.each([
    ["a field of the wrong type", { ...snapshot, sequence: "4" }],
    [
      "a session missing its visitor",
      { ...snapshot, sessions: [{ ...session, visitor: undefined }] },
    ],
    ["something that isn't a snapshot at all", ["nope"]],
  ])("rejects malformed data: %s", async (_, body) => {
    const { source } = await gateway(json(200, body));
    await expect(source.getSnapshot()).rejects.toThrow("Realtime gateway returned malformed data");
  });

  it("says the gateway is unreachable when nothing is listening", async () => {
    const { source } = await gateway(json(200, snapshot));
    await new Promise((resolve) => servers.splice(0)[0]!.close(resolve));
    const failure = await source.getSnapshot().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GatewayError);
    expect(failure).toMatchObject({ message: "Realtime gateway is unreachable", status: null });
  });

  it("gives up on a gateway that doesn't answer in time", async () => {
    const { source } = await gateway(() => {}, 50); // accepts the request, never responds
    await expect(source.getSnapshot()).rejects.toThrow("Realtime gateway timed out");
  });

  it("passes the caller's own cancellation through, not as a gateway failure", async () => {
    const { source } = await gateway(() => {});
    const controller = new AbortController();
    const pending = source.getSnapshot(controller.signal);
    controller.abort();
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(GatewayError);
    expect((failure as Error).name).toBe("AbortError");
  });
});
