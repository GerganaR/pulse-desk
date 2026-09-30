# ADR-001: WebSocket for realtime session updates (not SSE or polling)

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

The session console streams a continuous feed of visitor events to agents. The feed must
survive drops, stalls and reordering with no lost or duplicated entries (see
[realtime-reliability.md](../realtime-reliability.md)). The connection also carries
agent-originated messages:

- **presence**: "Jordan is viewing this session", per session and per tab;
- **resync requests**: "replay from sequence 1,284", sent mid-stream when a gap is found;
- **heartbeats**: application-level ping/pong to measure latency and detect a dead server
  from the browser, which can't see protocol-level pings.

Traffic is small messages at a moderate rate (tens per second per agent at peak), with
bursts during catch-up replays.

## Decision

Use a **WebSocket** (`ws` on the gateway, the platform `WebSocket` in the browser) with a
JSON protocol validated by Zod schemas in `packages/contracts`.

The client depends only on a small `WebSocketLike` interface, so tests inject a fake
socket and development builds inject a fault-injecting wrapper.

## Alternatives considered

### Server-Sent Events (SSE)

SSE has real strengths here, and they were weighed seriously:

- automatic reconnection, with `Last-Event-ID` giving resume-from-cursor for free;
- plain HTTP: works through every proxy, easy to load-balance and to cache-bust;
- simpler server (no upgrade, no framing).

It loses on the client → server direction. Presence, watch/unwatch, resync requests and
heartbeats would need separate HTTP requests. Those requests then have to be correlated
with the right stream on the server, which needs a connection id, sticky routing, or
shared state across gateway instances. A resync must happen _on the stream that has the
gap_. With SSE, that means tearing the stream down and reopening it, losing the ability
to keep presence and watches intact.

The built-in reconnect is also less useful than it looks. We need jittered, stability-aware
backoff, an offline pause and a visible countdown. So we'd be managing reconnection
ourselves anyway, which is half of what SSE offers for free.

### Long polling / short polling

Simple and robust, but it adds latency proportional to the poll interval, sends empty
responses when nothing happens, and turns bursts into many requests. It's not a fit for
a live activity feed. Kept in mind as a last-resort fallback for hostile networks
(unnecessary for an internal console).

### WebTransport

Would allow unordered/unreliable delivery and multiplexed streams, but browser support
is still incomplete, and we need _ordered, reliable_ delivery anyway.

## Consequences

- **We own reconnection, resume and heartbeat.** This is deliberate and documented in
  `realtime-reliability.md`. Sequences plus cursors give the same resume semantics as
  `Last-Event-ID`, plus gap detection mid-stream.
- **Load balancing needs care at scale.** WebSockets are long-lived, so load isn't
  rebalanced by new requests. The production path is stateless gateways (all state in
  the shared log and presence store) so any instance can take any reconnect, plus
  connection draining on deploy (the gateway already closes with 1001 on shutdown and
  clients resume elsewhere).
- **Backpressure is our job.** One slow socket must not grow gateway memory without
  bound, hence the `bufferedAmount` limit and slow-consumer disconnect.
- **The AI copilot uses a different transport.** It's request/response streaming of one
  answer, which fits a streamed HTTP response (NDJSON over `fetch`) better: cancellation
  via `AbortController`, no socket state, and independence from the live feed. See
  [ADR-004](004-ndjson-for-ai-streaming.md).
