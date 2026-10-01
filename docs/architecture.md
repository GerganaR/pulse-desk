# Architecture

How PulseDesk is put together: the processes, the packages they share, the four flows
that matter (a page request, the live feed, a copilot answer, a failure), and an honest
account of what would have to change to run it at scale.

This document is the map. The detail lives next to each subject:
[realtime-reliability.md](realtime-reliability.md), [ai-copilot.md](ai-copilot.md),
[performance.md](performance.md) and the [ADRs](adr/).

## System overview

```text
                     ┌──────────────────────── browser ────────────────────────┐
                     │  React 19 app (hydrated)      Redux store (one per tab) │
                     │  realtime client ── batcher ──► eventsReceived(batch)   │
                     │  copilot runner  ── per-frame ─► ai slice               │
                     └───┬──────────────────┬──────────────────────┬───────────┘
              HTML, JSON │        WebSocket │           NDJSON     │
        (same origin)    │   (cross origin) │       (same origin)  │
                         ▼                  │                      ▼
              ┌─────────────────────┐       │           ┌─────────────────────┐
              │ web  :3000          │       │           │ web  /api/ai/chat   │
              │ streaming SSR       │       │           │ builds the context  │
              │ /api/sessions*      │       │           │ streams bytes back  │
              └──────────┬──────────┘       │           └──────────┬──────────┘
                    HTTP │                  │                 HTTP │
                         ▼                  ▼                      ▼
              ┌──────────────────────────────────┐      ┌─────────────────────┐
              │ realtime-gateway  :4000          │      │ ai-service  :4100   │
              │ ingest → sequence → project →    │      │ provider (mock or   │
              │ fan out; replay buffer; presence │      │ OpenAI-compatible)  │
              └──────────────────▲───────────────┘      │ grounding check     │
                    POST /ingest │                      └─────────────────────┘
              ┌──────────────────┴───────────────┐
              │ event-simulator                  │
              │ scripted visitor journeys        │
              └──────────────────────────────────┘
```

Two rules shape the diagram:

- **The browser talks to its own origin for everything except the live feed.** Session
  data and AI answers go through the web server (a thin backend-for-frontend), so there
  is no CORS, the AI provider and its key are never visible to the browser, and one
  place enforces validation. The WebSocket goes straight to the gateway: proxying a
  long-lived socket through the SSR server would add a hop and a failure mode for no gain.
- **The live feed and the copilot are independent.** Different transports, different
  processes, different slices. Either can fail, stall or be cancelled without the other
  noticing, and an E2E test asserts the connection never leaves **Live** during copilot
  failures ([ADR-004](adr/004-ndjson-for-ai-streaming.md)).

## Apps

| App                     | Port          | What it owns                                                                                                                                             |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`              | 3000 (+ 3001) | The React app, its streaming SSR server, the same-origin API (`/api/sessions`, `/api/sessions/:id`, `POST /api/ai/chat`), CSP and static assets          |
| `apps/realtime-gateway` | 4000          | The event stream: validation, the single global sequence, the replay buffer, the session projection, WebSocket fan-out, presence, backpressure           |
| `apps/ai-service`       | 4100          | Copilot answers: prompt building, providers, NDJSON streaming, time limits, the grounding check, the evaluation suite                                    |
| `apps/event-simulator`  | —             | Believable visitor traffic (journeys through landing, pricing, forms, checkout), posted to the gateway's ingest API. Stands in for a real event producer |

Port 3001 exists only in development: the Rspack dev server that serves client assets
with HMR. In production the web server serves hashed, precompressed assets itself.

## Packages

| Package                              | Depends on               | Role                                                                                                                                                                                           |
| ------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`                 | `zod` (mini)             | Schemas and inferred types for everything that crosses a boundary: realtime events, the WebSocket protocol, session DTOs, AI requests and chunks. Also `toAIContext()`, the privacy boundary   |
| `packages/state`                     | contracts, Redux Toolkit | The Redux domain layer: slices, selectors, thunks. No React, no `fetch`: network access is injected, so it runs in SSR, in the browser, in unit tests and in the headless load tests unchanged |
| `packages/realtime-client`           | contracts, observability | The WebSocket client: state machine, resume cursor, backoff, heartbeat, sequencer (reorder and dedupe), resync. Transport injected. Fault injection lives behind a subpath export              |
| `packages/observability`             | —                        | A logger and a typed metrics API (counter, histogram, gauge, timer) with pluggable sinks, plus Web Vitals reporting behind a subpath export                                                    |
| `packages/ui`                        | React, Tailwind v4       | The design system: tokens (`@theme`), and accessible components (Button, Dialog, Tabs, Toast, Tooltip, StatusBadge, ConnectionIndicator, …)                                                    |
| `packages/test-utils`                | contracts                | Seeded, deterministic session and event factories. The simulator uses the same vocabulary, so test data and demo data look alike                                                               |
| `typescript-config`, `eslint-config` | —                        | Shared strict presets                                                                                                                                                                          |

Dependencies point one way: apps → packages, and among packages everything may depend
on `contracts`, nothing on `web`. `state` and `realtime-client` do not know React exists.

Packages and the Node services ship **TypeScript source with no build step**. Rspack,
Vitest and Node 24's type stripping consume it directly (the gateway runs as
`node src/main.ts`). There is no stale `dist/` to debug and no watch-order coupling in
the task graph; the cost is `erasableSyntaxOnly` (no enums, no parameter properties) and
explicit `.ts` import specifiers in Node packages.

## Flow 1: a page request (streaming SSR)

```text
 browser                    web server                                gateway
 ───────                    ──────────                                ───────
 GET /sessions/ses_1 ─────► resolve route handle (status, redirect,
                            which lazy chunk)
                            prefetch into a fresh Redux store ──────► GET /sessions
                              budget: 250 ms                  ──────► GET /sessions/ses_1
                              ◄───────────────────────────────────── { streamId, sequence, … }
                            renderToPipeableStream(<Root>)
 ◄───── headers (CSP with   onShellReady: status, no-store, security headers
        a per-request nonce)
 ◄───── HTML: the whole     page rendered in the first flush
        document            (routes are preloaded at server start)
 ◄───── bootstrap script:   window.__PULSEDESK__ = { assets, config,
        inline, nonce'd       preloadedState, serverNow, theme }
 ◄───── <script async>      initial scripts + this route's chunk
        hydrateRoot(document)
        ── after hydration ─► realtime chunk runs, WebSocket opens (flow 2)
```

What each step is for:

1. **Route handle first.** HTTP concerns (redirect `/` → `/dashboard`, 404 status, which
   chunk to send) are metadata on the same route table the client renders, so the server
   cannot drift from the UI ([ADR-003](adr/003-ssr-architecture.md)).
2. **Prefetch with a budget.** The server loads the sessions snapshot (and the session
   detail, on a session URL) into a per-request store. If the gateway hasn't answered in
   250 ms (`SSR_DATA_BUDGET_MS`), the requests are aborted and the page streams with
   skeletons; the client loads the data after hydration. A _failed_ fetch is kept in
   state, so the page server-renders its error UI with a retry. Time to first byte is
   never hostage to a slow backend.
3. **One tree, two entries.** Server and client render the identical `<Root>`; only the
   router differs (`StaticRouter` / `BrowserRouter`). Every input that could differ
   between them (state, clock, theme) is passed from the server through the bootstrap
   data. This is the main structural defence against hydration mismatches.
4. **The snapshot carries a stream position.** `{ streamId, sequence }` travels in the
   preloaded state. The realtime client resumes from exactly there, so there is no gap
   and no overlap between server-rendered data and live data.
5. **Lazy routes that still server-render.** Each page is its own chunk. The server
   preloads all of them at startup, so pages render synchronously into the shell and the
   HTML is complete without JavaScript. The browser gets the page's chunk as an `async`
   script alongside the initial ones (no second waterfall); if it arrives late, React's
   selective hydration hydrates the shell first.

What the server renders, and what starts only in the browser:

| Rendered on the server                                     | Starts after hydration                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| App shell, navigation, page titles and meta                | The WebSocket connection and every live update                  |
| Sessions snapshot, session details, the timeline's history | Connection status transitions (the pill starts as "Connecting") |
| Empty, error and not-found states (with the right status)  | The copilot panel (SSR renders a same-size skeleton)            |
| The theme (from a cookie: no flash)                        | Presence ("you are viewing"), Web Vitals, devtools              |

## Flow 2: the live feed

```text
 simulator        gateway                                       browser
 ─────────        ───────                                       ───────
 POST /ingest ──► validate each event (Zod)
                  drop producer retries (eventId)
                  append to the log ── assigns sequence n+1
                  apply to the session projection
                  broadcast { type: "events", events } ───────► decode frame (Zod)
                                                                sequencer: dedupe, reorder,
                                                                  detect gaps
                                                                batcher: hold ≤ 32 ms
                                                                dispatch eventsReceived(batch)
                                                                  sessions + timelines +
                                                                  presence in one reducer pass
                                                                one render
```

- **Single writer.** Everything that enters the stream goes through
  `EventPipeline.publish`: producer events, inactivity transitions from the sweeper, and
  presence. One writer means one contiguous sequence (1, 2, 3, … with no holes), and
  every reliability mechanism is arithmetic on that number
  ([ADR-006](adr/006-single-writer-sequence-and-cursors.md)).
- **Handshake.** The client's `hello` carries its cursor. The gateway answers `welcome`,
  then either a `snapshot` (first connect, expired cursor, or a cursor from another
  stream epoch) or a replay framed by `sync.started` / `sync.completed`. The whole
  handshake runs synchronously on the gateway, so no broadcast can interleave with it.
- **Batching.** Socket frames are coalesced into one Redux action per 32 ms window, so a
  burst or an 800-event replay costs a handful of renders
  ([ADR-005](adr/005-event-batching.md)).
- **Client → server messages** are few and small: `hello`, `ping`, `session.watch`,
  `session.unwatch`. That traffic is why this is a WebSocket and not SSE
  ([ADR-001](adr/001-websocket-vs-sse.md)).

The failure handling for this flow (heartbeat, gap detection, resync, backoff,
backpressure) is the subject of [realtime-reliability.md](realtime-reliability.md).

## Flow 3: a copilot answer

```text
 browser                      web server                        ai-service
 ───────                      ──────────                        ──────────
 POST /api/ai/chat ─────────► same-origin check, Zod
 { requestId, sessionId,      load the session from the gateway
   action, prompt }           toAIContext(session, events)
                              POST /chat { …, context } ──────► strict schema (extra field → 400)
                                                                provider.stream(request, signal)
 ◄── {"type":"delta",…} ◄──── bytes passed through ◄─────────── delta … delta
 ◄── {"type":"delta",…}                                         grounding check on the full
 ◄── {"type":"done",          (no buffering, no compression)      answer against the context
      "unverified":[…]}                                         done { unverified } | error
 runner: buffer text, dispatch once per animation frame
 Cancel: AbortController ───► response closes → abort upstream ► response closes → abort provider
```

- **The browser only names a session.** The web server loads it and builds the model's
  context from an allowlist (`toAIContext()`): no ids, names, city or absolute
  timestamps. ai-service re-validates with strict schemas. A client can neither invent
  session data nor widen what a model sees.
- **Answers are checked, not trusted.** Before the stream ends, ai-service checks the
  complete answer against the exact context the model saw. Unsupported outcome claims
  travel in the `done` chunk and the UI flags them under the answer
  ([ADR-008](adr/008-rule-based-grounding-guard.md)).
- **Each question is independent.** No conversation history is sent; the conversation is
  a per-session list in the tab's store.
- **Model output is rendered as text**, never HTML or Markdown: it is untrusted and it
  quotes visitor-controlled strings.

Details, time limits and the fault matrix: [ai-copilot.md](ai-copilot.md).

## Redux boundaries

The rule of thumb from [ADR-002](adr/002-redux-state-boundaries.md): _if another route
or the network cares, it's Redux; if only this component cares, it's local; if it should
be in a link, it's the URL._

| Slice           | Holds                                                                                              | Written by                                         |
| --------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `sessions`      | Normalised sessions, load status, and the stream position (`streamId`, `sequence`) they reflect    | SSR prefetch, `snapshotReceived`, `eventsReceived` |
| `timelines`     | Per-session event lists, **only for sessions someone opened**; capped at 10,000 entries            | Session detail fetch, `eventsReceived`             |
| `presence`      | Which agents are viewing which session                                                             | `eventsReceived`, snapshots                        |
| `connection`    | Status, retry countdown, RTT, degraded flag, sync progress                                         | The realtime client's state events                 |
| `notifications` | The toast queue                                                                                    | Recovery from an outage, explicit UI actions       |
| `ai`            | Copilot requests by id (status, text, error, timings, unverified claims), conversation per session | The copilot runner                                 |

Three actions cross slices on purpose: `eventsReceived(batch)`, `snapshotReceived` and
`sessionsExpired`. A batch updates sessions, timelines and presence in a single dispatch
and a single render, however many events arrived.

What is deliberately **not** in Redux:

| State                                     | Where                                  | Why                                                                                              |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Filters and search on the sessions list   | URL search params                      | Shareable, survives reload, renders correctly on the server                                      |
| The current time ("8s ago")               | External store, `useSyncExternalStore` | It ticks every second; `getServerSnapshot` returns the server's render time so hydration matches |
| Theme                                     | React context + cookie                 | The server needs it to render without a flash                                                    |
| Menu open, input text, chart/table toggle | Component state                        | Nobody else cares                                                                                |
| The WebSocket client, `AbortController`s  | Module instances (provider, AI runner) | Not serialisable; the store holds their _state_, not the objects                                 |
| Streaming text between frames             | The AI runner's buffer                 | Dispatching per token would be hundreds of actions per answer                                    |

On the server there is **one store per request**, never a module singleton: a shared
store would leak one visitor's data into another's response.

## Failure handling

The design position: every dependency is assumed to fail, each failure degrades one
thing, and the UI says what is happening without nagging.

| What fails                                       | What the user sees                                                                    | Mechanism                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Gateway slow at page load                        | The page arrives on time with skeletons, then fills in                                | 250 ms SSR data budget; client fetch after hydration                             |
| Gateway down at page load                        | A server-rendered error state with **Retry**; the page heals when the gateway returns | Failed fetch kept in the preloaded state; the realtime client keeps reconnecting |
| Unknown session URL                              | A real HTTP 404 with the not-found page                                               | Status resolved from loaded data before the shell is sent                        |
| React fails to render the shell                  | A static fallback document (no React involved), HTTP 500                              | `onShellError`                                                                   |
| A Suspense boundary fails or SSR times out       | The rest of the page; the boundary retries on the client                              | `onError`, 10 s render timeout with `abort()`                                    |
| A lazy page chunk fails to load                  | The shell stays; the page area explains and offers a reload                           | `RouteBoundary` (error boundary keyed by location)                               |
| WebSocket drops                                  | Pill: **Reconnecting · retry in 4s**. A banner only after 10 s. One toast on recovery | Backoff with equal jitter, resume cursor, replay                                 |
| Socket silently dead, slow link, lost frames     | **Degraded**, or a brief "Catching up"                                                | Heartbeat, sequencer, same-socket resync                                         |
| Gateway restarts                                 | One toast: sessions were reloaded from a fresh snapshot                               | Stream epochs: a cursor from another `streamId` is never resumed                 |
| Client can't keep up                             | A reconnect and replay                                                                | Gateway closes sockets over 8 MiB of backlog with 4008                           |
| Malformed event from a producer                  | Nothing: the event is rejected individually, the batch continues                      | Per-event validation at ingest                                                   |
| Malformed frame on the socket                    | Nothing: counted and ignored                                                          | Zod decode at the client                                                         |
| ai-service down or failing                       | Only the copilot fails: "The AI service is unreachable" / "failed", with **Retry**    | Proxy maps upstream failures to 502/503; the rest of the app is untouched        |
| Model slow or silent                             | "Didn't start answering in time" with **Retry**; partial text kept                    | First-token and total time limits in ai-service, longer backstops in the browser |
| Model says something the session doesn't support | The answer stays, with "Couldn't verify against this session's events: …"             | Grounding check in ai-service                                                    |
| Hydration mismatch                               | (A bug, not a runtime state.) Tests fail                                              | jsdom hydration tests with a negative control; E2E fails on any console error    |

Every mechanism in the right-hand column has a test that was mutation-checked: the
guard was removed on purpose and a test failed. The dev **Reliability** panel can
trigger most of the left-hand column on demand ([demo.md](demo.md) walks through it).

## Security boundaries

- **CSP:** strict and nonce-based, no `'unsafe-eval'`, `connect-src` limited to self and
  the gateway origin. Zod runs jitless in the browser so it never probes `eval`.
- **Validation at every boundary:** ingest, WebSocket frames in both directions, the
  same-origin API, the AI proxy, ai-service's own input.
- **Bootstrap data is escaped for script context** (visitor-supplied strings end up in
  it), and pages are `Cache-Control: no-store`.
- **Secrets stay server-side:** the provider key exists only in ai-service's environment.
- **Devtools cannot be switched on in production:** they are compiled out, and CI
  proves it ([ADR-007](adr/007-devtools-build-time-constant.md)).

Not done, and said plainly: there is no authentication. The agent identity is a
constant, presence is whatever the client's `hello` claims, the gateway's ingest and
snapshot endpoints are open, and there are no rate limits on ingest or the AI proxy
beyond a concurrent-stream cap. The security review is Phase 10.

## Scaling: what this demo is, and what production would need

**What runs today.** One gateway process. The event log is an in-memory ring buffer of
10,000 events; the session projection is a `Map`; presence is a `Map`. A restart loses
all three and starts a new stream epoch, which clients handle by taking a fresh
snapshot. Measured on a laptop, that single process ingests about 31,000 events/s and
fans a 6,800-event run out to five clients in ~0.2 s
([performance.md](performance.md)), which is far more than a demo needs and tells you
nothing about production, because the limits that matter are structural:

| Limit                         | Why it exists                                | What breaks first                                                                    |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| One gateway process           | The sequence is a counter in memory          | Availability: a deploy or crash disconnects everyone and discards replay history     |
| Replay depth of 10,000 events | Ring buffer                                  | At 1,000 events/s that is 10 s of history: any longer blip becomes a full snapshot   |
| Every client gets every event | One global stream, no subscriptions          | Fan-out cost is clients × events; bandwidth to each browser grows with total traffic |
| Snapshot = all sessions       | `GET /sessions` returns the whole projection | Payload and SSR time grow with tenant size                                           |
| 1,000 connections             | A configured cap on one Node process         | —                                                                                    |
| No tenancy, no auth           | Out of scope                                 | —                                                                                    |

**The production path.**

```text
 producers ─► collectors ─► durable partitioned log ─► gateway ─┐
              (validate,     (Kafka / Redis Streams;   gateway ─┼─► load balancer ─► browsers
               dedupe)        partition by session,    gateway ─┘    (no affinity needed)
                              or by tenant)               │
                                                          ├─► projection store (sessions, read models)
                                                          └─► presence store + pub/sub (Redis)
```

1. **Replace the in-memory log with a durable, partitioned one.** The gateway already
   talks to an `EventLog` interface (`append`, `readAfter`, `oldestSequence`,
   `headSequence`). Partition by session id (or tenant), so ordering is guaranteed where
   it matters (within a session) and throughput scales with partitions. Sequences become
   per-partition offsets assigned by the log, not by a gateway.
2. **Cursors become per-partition.** Today a cursor is `{ streamId, sequence }`. In a
   partitioned world it is a small vector: `{ partition → offset }` for the partitions
   the client is subscribed to. The client's sequencer logic (contiguous check, reorder
   buffer, dedupe, gap → resync) is unchanged per partition; what changes is that it
   holds several of them. `streamId` keeps its role as the epoch marker.
3. **Gateways become stateless consumers.** Each instance consumes the log and fans out
   to its own sockets. Any instance can serve any reconnect, because replay comes from
   the log, not from the instance's memory. That is why **connection affinity isn't
   needed** for the feed. Deploys drain connections (the gateway already closes with
   1001 and clients resume elsewhere), and jittered backoff spreads the reconnect wave.
4. **Subscriptions instead of a firehose.** Clients subscribe to what they show: a
   summary topic for the dashboard and list, and one session's partition for its
   timeline. This is the largest change to the protocol, and the one the demo most
   obviously lacks.
5. **Projections move out of the gateway.** The session read model (today's
   `SessionStore`) becomes a consumer writing to a store that the web server queries for
   SSR, with pagination. Snapshots still carry the offsets they reflect, so the
   SSR-to-live handoff keeps working exactly as now.
6. **Presence needs shared state.** It is the one piece that is inherently
   cross-instance ("who else is viewing"): a Redis hash with TTLs plus pub/sub, with the
   5 s grace period kept. Affinity is only worth considering here, and TTLs make it
   unnecessary.
7. **Exactly-once stays an end-to-end property.** The log gives at-least-once; the
   client's dedupe by offset and `eventId` turns that into exactly-once application,
   as it does today.

**What would carry over unchanged:** the client state machine, backoff and heartbeat;
the sequencer; snapshot-with-position; batching and the reducers; the whole AI path
(ai-service is already stateless and scales horizontally behind the proxy; the real
constraint there is provider quota, which needs a queue and per-tenant limits).

**What this document does not claim:** none of the production path has been built or
load-tested. The measured numbers are for one process on one machine. The claim is
narrower: the protocol was designed so that the client would not need to be rethought,
and the seams (`EventLog`, `SessionsSource`, `AIProvider`, injected transports) are
where the replacements would go.

## Where to look

| Question                            | Start here                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| How does a page get rendered?       | `apps/web/server/ssr.ts`, `apps/web/src/app/Root.tsx`, `apps/web/src/app/routes.tsx`                                             |
| How does an event reach the screen? | `apps/realtime-gateway/src/events/pipeline.ts` → `apps/web/src/features/realtime/connection.ts` → `packages/state/src/realtime/` |
| What happens when the socket drops? | `packages/realtime-client/src/client.ts`, `sequencer.ts`                                                                         |
| What does a model see?              | `packages/contracts/src/ai-context.ts`                                                                                           |
| How is an answer checked?           | `apps/ai-service/src/evaluation/grounding.ts`                                                                                    |
| What is on the wire?                | `packages/contracts/src/protocol.ts`, `events.ts`, `ai.ts`                                                                       |
| Why was it built this way?          | [docs/adr/](adr/), and the numbered decisions in [roadmap.md](roadmap.md)                                                        |
