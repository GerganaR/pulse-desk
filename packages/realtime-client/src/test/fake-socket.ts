import type { ClientMessage, RealtimeEvent, ServerMessage } from "@pulsedesk/contracts";
import type { WebSocketEventMapLike, WebSocketLike } from "../transport.ts";

type Listener = (event: never) => void;

/** Controllable stand-in for a WebSocket. */
export class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  closedWith: number | null = null;
  readonly url: string;
  #listeners = new Map<string, Listener[]>();

  constructor(url = "ws://gateway/ws") {
    this.url = url;
  }

  addEventListener<K extends keyof WebSocketEventMapLike>(
    type: K,
    listener: (event: WebSocketEventMapLike[K]) => void,
  ) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(code = 1000) {
    this.closedWith = code;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.#fire("open");
  }
  receive(message: ServerMessage | string) {
    this.#fire("message", {
      data: typeof message === "string" ? message : JSON.stringify(message),
    });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.#fire("close", { code, reason: "", wasClean: false });
  }
  /** Messages the client sent, filtered by type. */
  sentOfType<T extends ClientMessage["type"]>(type: T) {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }
  #fire(type: keyof WebSocketEventMapLike, event?: unknown) {
    this.#listeners.get(type)?.forEach((listener) => (listener as (event: unknown) => void)(event));
  }
}

export function clickEvent(sequence: number, eventId = `e${sequence}`): RealtimeEvent {
  return {
    type: "session.click",
    eventId,
    sequence,
    sessionId: "s1",
    timestamp: 0,
    payload: { element: "cta", label: "Go", path: "/" },
  };
}
