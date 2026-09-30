/**
 * The subset of the WebSocket API the client depends on. The browser's WebSocket and
 * Node's global WebSocket satisfy it; tests provide a fake. Fault injection (Phase 4)
 * wraps a transport without the client knowing.
 */
export interface WebSocketEventMapLike {
  open: unknown;
  message: { data: unknown };
  close: { code: number; reason: string; wasClean: boolean };
  error: unknown;
}

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof WebSocketEventMapLike>(
    type: K,
    listener: (event: WebSocketEventMapLike[K]) => void,
  ): void;
}

export type TransportFactory = (url: string) => WebSocketLike;

export const OPEN = 1;

export const browserTransport: TransportFactory = (url) => new WebSocket(url);
