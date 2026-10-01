# ADR-004: NDJSON over `fetch` for AI streaming (not SSE, not the WebSocket)

- **Status:** Accepted
- **Date:** 2026-09-30
- **Last reviewed:** 2026-10-01 (Phase 9): still current

## Context

The copilot sends one question about a session and streams back one answer. The answer
arrives token by token over several seconds, and the agent can cancel it or retry it.
Several answers can be in flight at once. Failures need to reach the UI as something it
can explain ("timed out", "service failed"), with any partial answer kept.

The app already holds a WebSocket to the realtime gateway (see
[ADR-001](001-websocket-vs-sse.md)).

## Decision

`POST /api/ai/chat` on the web server returns a streamed response of **newline-delimited
JSON**: `application/x-ndjson`, one `AIChunk` per line, each validated with the Zod schema
in `packages/contracts`:

```text
{"type":"delta","text":"A desktop visitor "}
{"type":"delta","text":"who arrived from google.com…"}
{"type":"done","finishReason":"stop","model":"mock"}
```

A stream ends with exactly one `done` or `error` chunk. A stream that ends without one
counts as cut off. Failures before streaming (bad request, unknown session, ai-service
down) are ordinary HTTP errors with a JSON `{ error }` body in the same shape.

The browser reads it with `fetch` and a `ReadableStream` reader, and cancels it with
`AbortController`. The web server streams ai-service's bytes through unchanged.

## Alternatives considered

### Server-Sent Events

SSE is the usual choice for token streams, and its framing would work. It loses on
the details that matter here:

- **`EventSource` can only GET.** The request has a body (session, action, question), so
  we'd either put it in a URL (logged, length-limited, cacheable) or not use
  `EventSource` at all.
- **Without `EventSource`, SSE is just a text format** parsed by hand from a `fetch`
  body, with more to parse (`data:`/`event:`/`id:` lines, multi-line data, comments).
  NDJSON is one `JSON.parse` per line.
- **Auto-reconnect is wrong for this.** `EventSource` reconnects and replays with
  `Last-Event-ID`. An answer isn't a feed: after a drop we want an explicit, visible
  failure and a user-initiated retry, not a silent reconnect that would start a new
  (and differently worded) answer.

The provider side still speaks SSE where the upstream API does (OpenAI's streaming
format); ai-service parses it and re-emits NDJSON, so the browser never sees provider
formats.

### The existing WebSocket

It's already open, but mixing the two would couple them. An AI answer would need request
ids multiplexed over the socket, the gateway would have to proxy AI traffic, and a
reconnect of the live feed (routine, see realtime-reliability.md) would take in-flight
answers with it. The Phase 5 requirement is the opposite: the WebSocket stays Live
whatever the copilot does, and vice versa. E2E asserts it.

### One JSON response (no streaming)

Simplest, but the agent waits the full generation time (5–20 s with a real model) for
the first word, and a cancel can't keep a partial answer because there isn't one.

## Consequences

- **Cancellation is plain HTTP.** Aborting the `fetch` closes the browser's connection;
  the web server sees its response close and aborts its upstream `fetch`; ai-service sees
  its response close and aborts the provider. No protocol message is needed, and the
  E2E test checks that ai-service recorded the stream as aborted.
- **Framing is our job.** Reads end mid-line and mid-character; `readLines()` handles
  both and is unit-tested for it. Every line is schema-validated, so a malformed line is
  a `protocol_error`, not a crash.
- **Buffering proxies are a risk** for any streamed HTTP response. The proxy sends
  `X-Accel-Buffering: no` and no compression is applied to the stream.
- **Errors mid-stream are in-band.** Once the 200 is sent, a timeout or provider failure
  can only be reported as an `error` chunk, so clients must read to the end. The browser
  client turns both paths into the same `AIStreamError`.
