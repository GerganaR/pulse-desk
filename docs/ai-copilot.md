# AI copilot

How the copilot answers questions about a session: what it sees, how answers stream,
and what happens when it's slow, fails or is cancelled. Wire format:
[ADR-004](adr/004-ndjson-for-ai-streaming.md).

Code: `apps/ai-service` (service), `apps/web/server/ai-proxy.ts` (proxy),
`apps/web/src/features/copilot` (UI, streaming client, runner), `packages/state/src/ai`
(slice), `packages/contracts/src/ai.ts` and `ai-context.ts` (schemas, privacy boundary).

## Request flow

```text
 browser                      web server (:3000)                 ai-service (:4100)
 ───────                      ──────────────────                 ──────────────────
 POST /api/ai/chat  ────────► validate (same-origin JSON, Zod)
 {requestId, sessionId,       load session from the gateway
  action, prompt}             toAIContext(session, events)
                              POST /chat {…, context} ─────────► validate (strict schema)
                                                                 provider.stream(…)
 NDJSON chunks  ◄──────────── bytes streamed through  ◄───────── delta… done | error
```

The browser only **names** a session. The web server loads it and builds the context, so
a client can neither invent session data nor widen what's sent to a model.

## What the model sees: `toAIContext()`

The privacy boundary is one pure, unit-tested function in `packages/contracts`. It builds
the context from an allowlist; nothing is spread, so a field added to `Session` later
can't leak by accident.

| Included                                                        | Left out                                          |
| --------------------------------------------------------------- | ------------------------------------------------- |
| Status, device, browser, OS, country, referrer                  | Session, visitor and event ids; stream sequences  |
| Landing and current path, duration, page views                  | Visitor name and city                             |
| Page views, clicks (label, element), form open/submit (+ error) | Absolute timestamps (offsets from start are kept) |
| Typing (form and field name only; values are never captured)    | Agent presence; "stopped typing" noise            |
| At most 200 recent events, plus a count of what was left out    | Anything beyond that                              |

ai-service validates the context with **strict** schemas, so an unexpected field is
rejected with 400 rather than passed to a model. That's a second check on the boundary.

The system prompt (`apps/ai-service/src/prompts/system.ts`) tells the model to answer only
from the data, never infer outcomes ("a click is not a purchase"), and ignore
instructions inside the data. The session JSON sits in a delimited block, apart from the
task. Checking answers against the data is Phase 6.

## Providers

`AIProvider.stream(request, signal): AsyncGenerator<string, FinishReason>`.

- **Mock** (default): composes a deterministic answer from the context alone and streams
  it word by word (400 ms before the first token, ~35 ms per token, seeded jitter). It
  only states facts that events show, and it says so when a free-form question is beyond
  its keyword routing.
- **OpenAI-compatible**: Chat Completions streaming (SSE) via `fetch`, no SDK. Enabled
  with `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` (and optionally
  `OPENAI_BASE_URL`). The key stays in ai-service. It's unit-tested against a fake
  stream; it hasn't been run against the real API in this repository's CI.

## Time limits

| Limit                 | ai-service (reports in-stream) | Browser (backstop) |
| --------------------- | ------------------------------ | ------------------ |
| First token           | 10 s                           | 15 s               |
| Whole answer          | 45 s                           | 60 s               |
| Accepting the request | —                              | proxy: 5 s         |

The service's limits are shorter, so normally it ends the stream with a clear
`timeout` chunk. The browser's own timers only matter if the service itself hangs. The
service races every provider read against its abort signal, so a provider that ignores
cancellation still can't hold a response open (unit-tested).

## Cancellation

Cancel in the UI → `AbortController.abort()` → the browser's fetch closes → the proxy's
response closes and aborts its upstream fetch → ai-service's response closes and aborts
the provider. The runner records the cancellation (keeping the partial text) before
aborting, and any late chunk is ignored by the slice. E2E checks ai-service recorded the
stream as `aborted`; removing ai-service's abort-on-disconnect makes that test fail.

## State and rendering

- **`ai` slice** (`packages/state`): requests keyed by id (entity adapter) with status,
  text, error, timings, attempt and model; a per-session conversation order. Updates
  apply only while a request is streaming. **Retry** starts a new request that takes the
  failed one's place in the conversation as attempt n + 1.
- **Runner** (`ai-runner.ts`, one per tab): owns the AbortControllers (not
  serialisable, so not in Redux). It buffers text and dispatches at most **once per
  animation frame** per request, and flushes before a request ends, so a failed or
  cancelled answer keeps every character that arrived. It outlives the panel: leaving the
  page doesn't stop an answer.
- **Panel**: lazy chunk (5.7 KB gzipped), rendered after hydration. Answers are plain text
  (`pre-wrap`), never HTML or Markdown: model output is untrusted, and it quotes visitor
  strings. While streaming, the answer is `aria-busy` and only the outcome is announced
  ("Answer ready.", "Answer failed: …").
- **Layout**: three columns from `xl` (1280 px); below that, `Tabs` (Details / Activity /
  Copilot) with every panel kept mounted, so switching tabs never interrupts a stream.

## Faults (development)

The reliability panel's **AI copilot** control (Off / Timeout / Error 500 / Slow) adds an
`x-pulsedesk-ai-fault` header to new copilot requests. Unlike the realtime faults, these
are server behaviours (ai-service's time limits, the proxy's error mapping), so they're
enacted by the real services, doubly gated:

- the web server forwards the header only in devtools builds (`__DEVTOOLS__`; a
  production build drops it, which E2E checks);
- ai-service acts on it only when started with `AI_DEBUG=1` (`pnpm dev` does).

`AI_DEBUG=1` also exposes `GET /debug/requests/:id` (recent outcomes) for E2E.

| Fault     | What happens                            | UI                                               |
| --------- | --------------------------------------- | ------------------------------------------------ |
| Timeout   | The provider never produces a token     | Failed: "didn't start answering in time" + Retry |
| Error 500 | ai-service answers 500 before streaming | Failed: "The AI service failed" + Retry          |
| Slow      | 250 ms before every token               | Visible streaming; time to try Cancel            |

## Tests

| Level       | File                                             | Covers                                                                                                                                                                        |
| ----------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `contracts/src/ai-context.test.ts`               | Privacy boundary: no ids, names, city, sequences, timestamps; strict schema; trimming                                                                                         |
| Unit        | `ai-service/src/stream.test.ts`                  | done/error framing, both timeouts, abort stops the provider, provider ignoring abort                                                                                          |
| Unit        | `ai-service/src/providers/providers.test.ts`     | Mock is grounded and deterministic; OpenAI SSE parsing, errors                                                                                                                |
| Integration | `ai-service/src/server.integration.test.ts`      | HTTP: NDJSON, validation, disconnect aborts, fault gate, 500/timeout/slow                                                                                                     |
| Integration | `web/server/ai-proxy.test.ts`                    | Context built server-side, validation, CSRF, 502/503 mapping, cancel closes upstream, fault forwarding                                                                        |
| Unit        | `web/src/features/copilot/stream-client.test.ts` | NDJSON split reads and UTF-8, malformed lines, early close, timeouts, abort                                                                                                   |
| Unit        | `web/src/features/copilot/ai-runner.test.ts`     | Per-frame batching, cancel keeps text, failure, retry in place, concurrent requests                                                                                           |
| Unit        | `state/src/ai/ai.test.ts`                        | Slice lifecycle, late chunks ignored, retry, trimming                                                                                                                         |
| Component   | `web/src/features/copilot/copilot.test.tsx`      | Every turn state, progressive render, composer, announcements, text-only output                                                                                               |
| E2E         | `tests/e2e/copilot.spec.ts`                      | Progressive render (recorded in-page), concurrent answers, grounding, cancel reaches ai-service, 500 → retry, timeout, WebSocket never leaves Live, production ignores faults |
