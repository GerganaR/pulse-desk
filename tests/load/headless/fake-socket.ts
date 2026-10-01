import type { ClientMessage, ServerMessage } from "@pulsedesk/contracts";
import type { WebSocketLike } from "@pulsedesk/realtime-client";

/** A WebSocket the scenario controls: it plays the gateway and the network. */
export class FakeSocket implements WebSocketLike {
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
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.#fire("open", {});
  }
  receive(message: ServerMessage) {
    this.#fire("message", { data: JSON.stringify(message) });
  }
  /** The network drops the connection (abnormal close). */
  drop() {
    this.readyState = 3;
    this.#fire("close", { code: 1006, reason: "", wasClean: false });
  }
  get listenerCount() {
    return [...this.#listeners.values()].reduce((sum, list) => sum + list.length, 0);
  }
  #fire(type: string, event: unknown) {
    this.#listeners.get(type)?.forEach((listener) => listener(event));
  }
}
