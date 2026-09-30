import type { WebSocket } from "ws";

const alive = new WeakMap<WebSocket, boolean>();

/**
 * Protocol-level liveness (WebSocket ping/pong frames, answered by the browser
 * automatically). A socket that misses a full interval is terminated: without this, a
 * client that vanished without a TCP close (laptop sleep, network switch) would hold a
 * connection — and keep receiving broadcasts into a dead buffer — for minutes.
 *
 * This is separate from the application-level `ping` message, which lets the *client*
 * measure latency and detect a dead server.
 */
export function trackLiveness(socket: WebSocket) {
  alive.set(socket, true);
  socket.on("pong", () => alive.set(socket, true));
}

export function startHeartbeat(sockets: () => Iterable<WebSocket>, intervalMs: number) {
  const timer = setInterval(() => {
    for (const socket of sockets()) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
