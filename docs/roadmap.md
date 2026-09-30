# PulseDesk roadmap

Delivery plan for the remaining phases. Each phase ends in a **runnable, green
repository** (lint, typecheck, unit/component tests, build and E2E pass) and a demoable
increment. The plan is a working document: when a phase changes the plan, update this
file in the same PR.

| Phase | Theme                                                              | Status  |
| ----- | ------------------------------------------------------------------ | ------- |
| 1     | Foundation: monorepo, contracts, design system, streaming SSR      | ✅ Done |
| 2     | Dashboard, sessions list, session detail (on generated data)       | ✅ Done |
| 3     | Realtime: gateway, simulator, realtime client, Redux wiring        | ✅ Done |
| 4     | Reliability: reconnect, replay, heartbeat, fault injection         | ✅ Done |
| 5     | AI copilot: service, HTTP streaming, copilot UI                    | ✅ Done |
| 6     | AI quality: evaluation, hallucination regressions, AI workflow     | Next    |
| 7     | Performance: batching at scale, virtualisation, splitting, budgets |         |
| 8     | Testing: gap-filling, a11y automation, CI for the full stack       |         |
| 9     | Documentation: README, architecture, ADRs, demo script             |         |
| 10    | Polish: accessibility, mobile, states, security, code quality      |         |

## Adjustments to the original phase plan

These changes come from what Phases 1–2 taught us:

1. **Tests are written in the phase that introduces the behaviour**, not deferred to
   Phase 8. Phase 8 becomes gap-filling, cross-cutting automation (axe, full-stack CI)
   and the coverage review.
2. **The reconnect E2E test moves to Phase 4.** It is the acceptance test for the
   reliability work, so it lands with that work.
3. **`packages/observability` starts in Phase 3** with a minimal API. The metrics listed
   in the brief (`websocket.reconnect.count`, `ai.request.duration`, …) are emitted by
   Phase 3–5 code, so the API has to exist before then. Phase 7 fleshes it out.
4. **Remaining UI primitives are built when first needed**, not up front:
   `Toast` and `Dialog`/`Tooltip` (Phase 4 reliability panel and reconnect notices),
   `Tabs` (Phase 5 mobile session layout).

Changes made during Phase 3:

5. **Stream epochs (`streamId`) added to the protocol.** The in-memory gateway restarts
   its sequences on every boot (including dev `--watch` reloads). Cursors are now
   `{streamId, sequence}`, and a cursor from another epoch gets a fresh snapshot instead
   of a silent gap. Verified by restarting the gateway under a connected browser.
6. **Basic reconnect with backoff moved into Phase 3.** Without it, every gateway
   reload in dev left the app dead. Phase 4 keeps heartbeat, degraded detection, gap
   detection, reordering and fault injection.
7. **Notifications/Toast deferred to Phase 4.** Phase 3 had no notification that
   earned a toast; reconnect notices in Phase 4 are the first real use.
8. **Client-side retention of ended sessions deferred to Phase 7.** The gateway ages
   out ended sessions, but a long-lived tab keeps them until its next snapshot. It's a
   memory and performance concern, so it gets measured with the load scenarios.

Changes made during Phase 4:

9. **Equal jitter kept instead of full jitter.** Full jitter can retry after ~0 ms, which
   reads oddly next to a "retrying in 4s" countdown; equal jitter keeps a floor and
   still de-synchronises clients. What changed is the reset: it now happens only after
   10 s of stable connection, so a flapping gateway keeps backing off.
10. **`pong` carries `headSequence` (protocol change).** Without it, losing the _last_
    events before a quiet period is undetectable until the next event arrives. The
    heartbeat now bounds how long a trailing gap can go unnoticed.
11. **Degraded is a health flag, not a status.** It describes a live socket, and it's
    orthogonal to syncing/live, so the client state has `degraded` + `rttMs` next to
    `status`. While degraded, the client probes every 2 s so recovery shows quickly.
12. **Devtools are a build-time constant, and E2E uses a second build.** The flagship E2E
    drives the reliability panel, but the panel must not exist in production, and E2E
    runs against the production build. `pnpm build:devtools` makes the same production
    build with the panel compiled in (`dist-devtools/`), served on its own port for the
    reliability spec only. Every other spec still tests the real artefact. The CI check
    also uses it as a control: the marker must be absent from `dist/` _and_ present in
    `dist-devtools/`.
13. **No gateway debug routes.** All faults are injected client-side by wrapping the
    transport, which reaches every recovery path (including the server's replay and
    snapshot-on-expired-cursor) without adding attack surface to the gateway. The
    server-only path, slow-consumer backpressure, is covered by unit tests.
14. **Presence grace period (5 s) on the gateway.** Every short reconnect used to write
    "stopped viewing / started viewing" into the timeline. `presence.left` now waits,
    and a reconnect within the window takes over the watch silently.
15. **Toasts are reserved for recovery that needs explaining.** The single uses are
    recovery after a prolonged outage (≥ 10 s, the same threshold as the banner) and
    reloads from a fresh snapshot (gateway restart, cursor expired). The `notifications`
    slice (planned for Phase 3) landed here with its first real use.
16. **The reliability panel is non-modal.** It docks bottom-left over the details column
    (a bottom sheet on mobile), so the timeline stays visible while faults are injected.
    `Dialog` supports both modes on the native `<dialog>` element.

Changes made during Phase 5:

17. **AI faults are enacted by the real services, not a client wrapper** (a deliberate
    exception to item 13). The faults that matter are server behaviour: ai-service's
    time limits and the proxy's error mapping. The panel's choice travels as an
    `x-pulsedesk-ai-fault` header, forwarded only by devtools web builds and honoured only
    by an ai-service started with `AI_DEBUG=1`. E2E checks that the production build
    ignores it. `AI_DEBUG` also exposes recent request outcomes, which is how E2E proves
    a cancel reached the provider.
18. **The web server builds the AI context, not the browser.** The browser sends
    `{requestId, sessionId, action, prompt}`; the proxy loads the session from the gateway
    and runs `toAIContext()` (in `contracts`). ai-service re-validates it with strict
    schemas. A client can't forge or widen what reaches a model.
19. **Each question is independent.** No conversation history is sent to the model; the
    conversation is a per-session list in the tab's store. It keeps requests small and
    answers grounded in current data. Multi-turn context can come later if it earns it.
20. **"AI summaries generated" became "AI answers · generated in this tab".** There's no
    server-side count to show, and a per-tab count labelled as global would mislead.
21. **Session layout: three columns from `xl` (1280 px), tabs below.** At `lg` the
    activity column was too narrow to read. Activity is the default tab, and every panel
    stays mounted, so switching tabs never interrupts a stream or loses scroll position.
22. **The copilot renders after hydration, not on the server.** It's interactive only,
    so SSR renders a same-size skeleton and the lazy chunk loads in the browser.
23. **Answers outlive the page.** The runner is per tab, so navigating away doesn't
    cancel an answer; it's there when you come back.

## Ports and processes (target for `pnpm dev`)

| Process                      | Port                      | Starts in |
| ---------------------------- | ------------------------- | --------- |
| web (SSR)                    | 3000                      | Phase 1   |
| web client assets / HMR      | 3001                      | Phase 1   |
| realtime-gateway (HTTP + WS) | 4000                      | Phase 3   |
| ai-service                   | 4100                      | Phase 5   |
| event-simulator              | — (client of the gateway) | Phase 3   |

---

## Phase 3 — Realtime

**Goal:** `pnpm dev` starts web, gateway and simulator. The dashboard and session pages
update live. The generated mock data is removed.

### Architecture decisions

- **Single-writer gateway assigns sequences.** The simulator posts unsequenced events.
  The gateway validates them, assigns the next global `sequence`, appends them to the
  event log, updates its session projection and fans out to sockets. One writer makes
  ordering trivially correct for the demo; see Phase 9 docs for partitioned evolution.
- **Simulator → gateway over HTTP batch ingest** (`POST /ingest`, NDJSON or JSON array),
  not WebSocket. Ingest and fan-out are different concerns, retries are simpler, and it
  mirrors how a real collector would sit in front of the gateway.
- **`EventLog` interface** (`append`, `readAfter(sequence, limit)`, `oldestSequence`,
  `headSequence`) with an in-memory ring-buffer implementation. The documented
  production swap is Redis Streams or Kafka.
- **Session projection in the gateway** (`SessionStore`) answers snapshot requests:
  `GET /sessions` and `GET /sessions/:id`, the latter with a bounded recent timeline.
  Every snapshot carries the `sequence` it reflects (already in `contracts`).
- **The web server's `SessionsSource` becomes a gateway HTTP client.** The UI and store
  don't change, and SSR keeps its 250 ms data budget.
- **Client resumes from the SSR snapshot's sequence**, so no events are lost between
  server render and socket open.
- **Event batching from day one.** The realtime provider buffers incoming events and
  dispatches a single `eventsReceived(batch)` action per flush (~32 ms, or per animation
  frame while visible). Phase 7 measures and tunes it.

### Deliverables

- `apps/realtime-gateway`
  - `server.ts` (HTTP + `ws` upgrade on `/ws`, health, graceful shutdown)
  - `websocket/connection-manager.ts` (registry, broadcast, per-socket send queue)
  - `websocket/session-room.ts` (who is watching which session → presence events)
  - `websocket/heartbeat.ts` (protocol-level ping, terminate dead sockets)
  - `websocket/replay-buffer.ts` (in-memory `EventLog`)
  - `events/` (ingest validation, sequencing, session projection)
  - All inbound data validated with `@pulsedesk/contracts` decoders
- `apps/event-simulator`
  - Journey state machine (landing → browse → pricing → CTA → form → checkout → close)
    using the `test-utils` vocabulary. Believable timing between steps.
  - `SESSION_COUNT`, `EVENT_RATE`, `ERROR_RATE` (malformed or failed-submit events) env
    configuration. Warm start so the dashboard is populated immediately.
  - Retries with backoff while the gateway is down.
- `packages/realtime-client` (Phase 3 scope): typed connection state machine
  (`idle → connecting → open → closed`), `hello`/`welcome` handshake with `resumeAfter`,
  typed subscriptions, clean `close()`. Transport injected, so tests use a fake
  WebSocket.
- `packages/state`
  - `sessionEvents` slice: per-session timelines, normalised, bounded length per session
  - `connection` slice: status, last sequence, health fields
  - `eventsReceived(batch)` updates sessions (status, current page, counters) and
    timelines in one reducer pass
  - `notifications` slice (for toasts)
- `packages/observability` (minimal): `logger`, `metrics.counter/histogram/gauge`, a
  console sink and an in-memory sink.
- `apps/web`
  - `RealtimeProvider` (client-only, starts in an effect, never during SSR)
  - Event batcher
  - `ConnectionIndicator` in the top bar
  - Live activity timeline on the session page (not virtualised yet)
  - `Toast` primitive in `packages/ui`
  - Gateway-backed `SessionsSource`; delete `mock-sessions-source.ts`
- Turbo: `dev` runs all apps; the gateway declares a health check the simulator waits on.

### Tests

- Gateway integration: a real `ws` client connects, receives a snapshot, receives live
  events in sequence order; ingest rejects malformed events.
- Reducer tests: every event type applied to sessions/timelines; batch = sequential.
- Batcher: flush interval, flush on size cap, flush on unmount.
- realtime-client: handshake, typed dispatch, invalid frames counted and ignored.
- E2E: open dashboard, a new session appears without reload; open a session, its
  timeline grows.

### Done when

`pnpm dev` → dashboard updates live within a second of simulator activity. The
indicator shows **Live**. Killing the simulator stops activity without errors.

---

## Phase 4 — Reliability

**Goal:** the connection survives drops, stalls, duplicates and reordering with no lost
or duplicated timeline entries, and the UI explains what is happening without nagging.

### Architecture decisions

- **Reconnect policy:** exponential backoff with full jitter (1 s base, 30 s cap),
  reset after a connection has been healthy for a grace period. Immediate retry on
  `online` and on tab becoming visible after a long hidden period.
- **Heartbeat:** client `ping` every N seconds. A missing `pong` within the timeout marks
  the socket dead and triggers a reconnect. RTT feeds a rolling health estimate.
- **Degraded:** open but unhealthy (RTT above threshold, or recent missed pongs). It is
  distinct from Reconnecting.
- **Ordering and dedupe, client side:**
  - Drop any event with `sequence <= lastApplied`, and any seen `eventId` (bounded LRU).
  - Hold out-of-order events in a reorder buffer until the gap fills.
  - If the gap doesn't fill within a timeout, request a resync (`hello` with
    `resumeAfter = lastApplied`) on the same connection.
- **Replay:** the gateway replays from the event log after the cursor, framed by
  `sync.started` and `sync.completed`. If the cursor is older than the buffer, it sends
  a fresh `snapshot` and the client replaces state.
- **Backpressure, server side:** per-socket `bufferedAmount` threshold. Slow consumers
  are disconnected with a reason code, and replay recovers them when they reconnect.

### Deliverables

- `realtime-client`
  - backoff
  - heartbeat
  - health info: `rttMs`, `reconnectCount`, `connectedSince`, `lastEventAt`,
    `eventsDropped`
  - online/visibility handling
  - reorder buffer and dedupe
  - resync
  - `close()` that cancels timers and never reconnects
- Gateway: heartbeat termination, replay, snapshot-on-expired-cursor, backpressure,
  connection limits.
- **Status UX:**
  - Indicator states: Live, Connecting, Reconnecting (with "retrying in 4s"),
    Degraded, Offline.
  - A non-modal banner only after a prolonged outage.
  - A "Catching up… 23 events" state during sync.
  - Replayed events insert in order with a subtle highlight, never duplicated.
  - No toast per reconnect.
- **Developer reliability panel** (`Dialog` and `Tooltip` primitives land here):
  - Controls: disconnect, reconnect, artificial latency, drop N events, duplicate next
    event, deliver next batch out of order.
  - Client-side fault injection wraps the transport. Gateway debug routes are
    registered only outside production.
  - Excluded from the production bundle: loaded via dynamic import behind
    `config.devTools`, which is dead-code-eliminated when `NODE_ENV=production`. A CI
    check greps the production bundle for the panel's marker string.
- Docs: `docs/realtime-reliability.md`, `docs/adr/001-websocket-vs-sse.md`.

### Tests

- realtime-client with fake timers:
  - the exact backoff sequence (seeded jitter)
  - heartbeat timeout triggers reconnect
  - dedupe by sequence and by eventId
  - reorder buffer releases in order
  - gap timeout triggers resync
  - `close()` leaves no timers
- Integration: in-process gateway plus real client; kill the socket mid-stream and assert
  the replayed sequence is contiguous.
- **Flagship E2E:** open live session → receive events → disconnect via the panel → UI
  shows Reconnecting → simulator produces events while disconnected → reconnect →
  missed events appear **once and in order** (assert on sequence numbers in DOM
  attributes) → UI shows Live.

### Done when

Every control in the reliability panel can be triggered during the demo and the
timeline stays correct. The flagship E2E is green in CI.

### Outcome

Delivered as planned, with the adjustments listed above (items 9–16). Details, failure
table and test map: [realtime-reliability.md](realtime-reliability.md); transport choice:
[ADR-001](adr/001-websocket-vs-sse.md).

- The flagship E2E and three further reliability specs pass on desktop and mobile, and
  pass 5× repeated. A repeat run found a real race: "Retry now" during an in-flight
  attempt fell back to the full backoff. It is fixed and has a unit test.
- The production client grew by 3.4 KB gzipped (137.4 → 140.8 KB) for the sequencer,
  heartbeat and status UX. The panel, fault injector, `Dialog` and `Tooltip` are not in
  it (checked in CI).

---

## Phase 5 — AI copilot

**Goal:** ask the copilot about a session and watch the answer stream in, with
cancel, retry, timeout and failure handled cleanly and independently of the WebSocket.

### Architecture decisions

- **Transport:** `POST /api/ai/chat` on the web server (same-origin backend-for-frontend)
  proxies to `ai-service` and streams the response straight through. There's no CORS,
  the browser never sees provider details, and one place enforces limits.
- **Wire format:** NDJSON chunks (`{type:"delta"|"done"|"error", …}`) validated with
  `contracts`. Simpler than SSE for a POST, and each line is independently parseable.
- **Provider abstraction:** `AIProvider.stream(request, signal): AsyncIterable<AIChunk>`.
  Two providers:
  - Mock (default): deterministic, grounded strictly in the supplied context, with
    realistic token pacing.
  - Real provider (`openai.provider.ts`) enabled by env vars.
- **Context mapping:** `toAIContext(session, events)` produces a minimal, explicit
  structure: event types, paths, element labels, timings. It excludes internal ids,
  sequence numbers and anything not needed. It's unit-tested as a privacy boundary.
- **Cancellation propagates end to end:** browser `AbortController` → web proxy aborts its
  upstream fetch → ai-service aborts the provider stream.
- **Timeouts:** time-to-first-token and total-duration limits, enforced in both the
  browser and the service.
- **State:** an `ai` slice keyed by request id stores status, partial text, error,
  timing and parent session. Partial text is appended in batched updates (per frame),
  not per token.

### Deliverables

- `packages/contracts`: AI request, context and chunk schemas.
- `apps/ai-service`: `server.ts`, `stream.ts`, `prompts/`, `providers/mock.provider.ts`,
  `providers/openai.provider.ts`.
  - Dev-only fault injection (timeout, HTTP 500, slow stream), selectable from the
    reliability panel.
- `apps/web`:
  - Streaming client utility (`ReadableStream` reader, NDJSON parse, abort, timeouts).
  - Copilot panel, **lazy-loaded** with `React.lazy`:
    - quick actions (summarise, what's blocking, suggest reply, unusual behaviour,
      key events only)
    - free-form prompt
    - progressive rendering with a caret
    - cancel, retry, and "partial answer kept" on failure
    - several requests in the conversation at once
  - The session page becomes three panels on desktop and tabs on mobile.
  - "AI summaries generated" stat tile.
- Reliability panel: AI timeout, AI 500, slow AI.

### Tests

- Stream parser: split chunks across reads, malformed lines, early close.
- `ai` slice: lifecycle, cancel keeps partial text, retry creates a new attempt.
- ai-service: abort stops the provider, timeout closes the stream with an `error`
  chunk, and 500 paths.
- E2E: stream renders progressively, cancel mid-stream, retry succeeds, 500 and
  timeout show the error state, and the WebSocket stays Live throughout.

### Done when

Demo steps 12–17 from the brief work in one continuous take.

### Outcome

Delivered as planned, with the adjustments above (items 17–23). Details, flow, time
limits and test map: [ai-copilot.md](ai-copilot.md); wire format:
[ADR-004](adr/004-ndjson-for-ai-streaming.md).

- The brief's demo script isn't in the repository, so "demo steps 12–17" were checked as
  the flow they describe, in one browser session: ask (quick action and free text) →
  progressive answer → several at once → cancel mid-stream → 500 → retry → timeout,
  with the connection Live throughout. That flow is also the E2E spec.
- E2E: 6 copilot tests, each on desktop and mobile; with the dashboard spec, 110/110
  over 5 repeats. Cancellation is
  mutation-checked end to end: removing ai-service's abort-on-disconnect fails the
  cancel test. Unit-level guards (abort race, `AI_DEBUG` gate) were mutation-checked too.
- The browser check found real layout bugs, all fixed: an implicit grid column let the
  quick-action row widen the mobile page past the viewport; the mobile panel height hid
  the composer; chips overflowed with no scroll affordance (they wrap now); the dev
  Reliability toggle covered the mobile composer (it docks in the mobile header now);
  and the activity column was too narrow at 1280 px.
- Initial JS grew 3.6 KB gzipped (140.8 → 144.5 KB): about 1 KB is the Rspack
  chunk-loading runtime, needed now that production has its first lazy chunk; the rest
  is the `ai` slice, `Tabs`, the copilot shell and the stat tile. The copilot itself is
  a 5.7 KB lazy chunk. Budget warning stays on; see [performance.md](performance.md).
- The OpenAI-compatible provider is unit-tested against a fake stream only; it hasn't
  been run against a live API here.
- One unexplained failure in `realtime-gateway` tests during a cold full run (didn't
  recur in 3 isolated runs or the next full run). Tracked below.

---

## Phase 6 — AI quality and AI-assisted workflow

**Goal:** show that AI output is checked, not trusted, and document how AI is used
to build this project.

### Deliverables

- `apps/ai-service/src/evaluation/`
  - **Fixtures:** realistic sessions with the facts they support and the claims they
    must _not_ support. Example: pricing → enterprise → pricing → "Upgrade" click must
    not produce "completed payment".
  - **Grounding checker:** claims are extracted with a rule-based taxonomy (purchase,
    signup, form submission, error encountered, contact request) and verified against
    event evidence. Deterministic, fast, and explainable.
  - **Regression suite:** runs against the mock provider in CI. `pnpm eval` runs the
    same fixtures against a real provider when a key is present, and writes a report.
  - **Runtime guard:** ungrounded claims in a streamed answer are flagged in the UI
    ("couldn't verify: …") rather than silently shown.
  - `LIMITATIONS.md`: what rule-based checking cannot catch, provider nondeterminism,
    fixture coverage.
- `prompts/`: `feature-planning.md`, `implementation.md`, `code-review.md`,
  `test-generation.md`, `refactoring.md`. Each is written for this codebase: its
  packages, boundaries, and known failure modes (hydration, StrictMode, CSP, reconnect).
- `docs/ai-development-workflow.md`: the loop from requirement to AI planning to human
  review to implementation to tests to AI review to human final review. It includes real
  examples from this repository's history, such as the mutation-tested hydration guard,
  the Zod CSP finding and the wrong-port dev confusion.
- `.github/pull_request_template.md` with the AI-assistance section.

### Done when

Removing a guard in the mock provider (so it invents a payment) makes CI fail.

---

## Phase 7 — Performance

**Goal:** stay smooth under bursts and long sessions, and bring the bundle back under
budget with numbers to show for it.

### Deliverables

- **Virtualised timeline** (`@tanstack/react-virtual`) with stick-to-bottom behaviour
  that pauses when the user scrolls up and shows a "N new events" pill. The sessions
  table is virtualised past a threshold.
- **Route-level code splitting** with `React.lazy` (session detail, copilot). Streaming
  SSR plus selective hydration handle lazy boundaries.
- **Bundle:**
  - Evaluate `zod/mini` for client-side parsing (the largest known win; see
    `performance.md`).
  - Bundle analysis with Rsdoctor.
  - Enforce the budget in CI (`performance.yml`).
- **Batching tuned with measurements:** flush interval against events per second, render
  count and frame time. Measured, not assumed.
- **Observability, complete:**
  - Web Vitals (LCP, INP, CLS) reported through `packages/observability`.
  - React Profiler timing for `session.timeline.render.duration`.
  - All metrics from the brief emitted.
  - A dev metrics view in the reliability panel.
- **Load and stress scenarios (`tests/load/`):**
  - 100 concurrent simulated sessions
  - a 1,000-event burst (reducer throughput measured headlessly via `packages/state`)
  - repeated reconnects (no leaks: socket and timer counts return to baseline)
  - a 10,000-event timeline
  - 10 concurrent AI streams
- `docs/performance.md` completed with before/after tables.

### Done when

The initial JS is within budget, a 1,000-event burst doesn't drop frames below target on
a mid-range profile, and the results are recorded.

---

## Phase 8 — Testing

**Goal:** close the gaps and make the whole stack testable in CI.

- Coverage review per package. Target the logic that is risky, not a vanity number.
- `@axe-core/playwright` scan on every page and state (loading, error, reconnecting).
- Component tests for all connection-indicator states and copilot states.
- CI runs E2E against the **full stack**: Playwright `webServer` array for web, gateway,
  ai-service and a deterministic simulator seed.
- Flake audit: run E2E ×20 locally, and fix any source of nondeterminism.

---

## Phase 9 — Documentation

- `README.md` in final form:
  - overview, demo GIF, screenshots, architecture diagram
  - technology choices, realtime reliability, AI architecture, AI workflow
  - performance, testing, running locally, environment variables
  - repository structure, tradeoffs, future improvements
- `docs/architecture.md`:
  - apps and packages, request/SSR/realtime/AI flows (ASCII diagrams)
  - Redux boundaries, failure handling
  - **honest scaling section**. The demo runs as one gateway with an in-memory log. The
    production path would be partitioned streams (Redis Streams or Kafka), horizontally
    scaled gateways behind a load balancer with shared pub/sub, per-partition cursors,
    and connection affinity only where needed.
- ADRs 001–003 finalised. Add new ADRs for decisions made along the way (for example
  NDJSON vs SSE for AI, and batching strategy).
- `docs/demo.md`: the 20-step interview walkthrough, with the exact clicks and what to
  say at each step.

---

## Phase 10 — Polish

- **Accessibility pass:**
  - screen reader walkthrough (NVDA and VoiceOver) of every flow
  - focus management on route change and after dialogs
  - live-region audit so realtime updates are announced sparingly
  - reduced motion, forced colours
- **Responsive:** tablet layouts, the session page on small screens, touch targets.
- **State consistency:** every surface has deliberate loading, empty, error, offline and
  reconnecting states. Audit them side by side.
- **Security review:** CSP, input validation at every boundary, rate limits on ingest and
  AI, and no secrets reaching the client bundle.
- **Code quality:** dead code, naming, comment accuracy, dependency audit.
- Final Lighthouse and Web Vitals run recorded in `performance.md`.

---

## Cross-cutting

### Definition of done (every phase)

- `pnpm check`, `pnpm build`, `pnpm e2e` green from a cold Turbo cache.
- New behaviour has tests at the lowest useful level, plus E2E for user-facing flows.
- Visual check in a real browser: light, dark and mobile.
- Docs and this roadmap updated if a decision changed.
- **One branch and pull request per phase**, using the PR template, so the history
  reads as reviewed, incremental delivery.

### Carried-over items

| Item                                                                | From    | Planned in            |
| ------------------------------------------------------------------- | ------- | --------------------- |
| Client entry over the 350 KB budget (Zod is the main contributor)   | Phase 2 | Phase 7               |
| Dev metrics view in the reliability panel (panel exists now)        | Phase 4 | Phase 7               |
| Adaptive heartbeat thresholds (relative to normal RTT)              | Phase 4 | Phase 10              |
| Run the OpenAI-compatible provider against a live API (`pnpm eval`) | Phase 5 | Phase 6               |
| One-off `realtime-gateway` test failure under full parallel run     | Phase 5 | Phase 8 (flake audit) |
| AI metrics in the dev metrics view (`aiMetricsSink` exists)         | Phase 5 | Phase 7               |
| Delete generated mock session source                                | Phase 2 | Phase 3               |
| Commit Phases 1–2                                                   | Phase 2 | Before Phase 3        |

### Risks

| Risk                                  | Mitigation                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Flaky realtime E2E (timing-dependent) | Deterministic simulator seed; assert on sequence numbers, not timing; fake-timer unit tests carry the timing logic |
| Hydration mismatches from live data   | Snapshot + sequence handshake; server clock during hydration; hydration tests with clock skew (already in place)   |
| Scope creep in AI evaluation          | Rule-based grounding with explicit limitations, rather than LLM-as-judge                                           |
| Real AI provider unavailable in CI    | Mock provider is the default; real-provider eval is opt-in and local                                               |
| Dev tooling leaking into production   | Dead-code elimination by `NODE_ENV`, plus a CI assertion on the production bundle                                  |
