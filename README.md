# PulseDesk

PulseDesk is a React 19 real-time session monitoring and AI copilot application built to
explore resilient realtime frontend architecture. It combines WebSocket-driven session
updates, streamed AI responses, Node.js streaming SSR, Redux Toolkit state management, and
a pnpm/Turborepo monorepo built with Rspack.

> **Status:** under active, incremental development. Phases 1–6 are complete: monorepo,
> shared contracts, design system, custom streaming SSR with Rspack, Redux domain layer,
> dashboard and session views, the realtime stack (WebSocket gateway, event simulator,
> realtime client), realtime reliability (heartbeat, gap detection and resync, dedupe,
> reorder buffer, backpressure, a dev fault-injection panel), and the AI copilot (an AI
> service with a mock and an OpenAI-compatible provider, NDJSON streaming with cancel,
> retry and timeouts, a lazy-loaded copilot panel), and AI quality (a grounding checker
> that flags unsupported claims in every answer, hallucination regressions in CI, and the
> AI-assisted workflow this project is built with). This README is expanded as each phase
> lands.

## Running locally

Requires **Node 24** (see `.nvmrc`) and pnpm (via Corepack).

```bash
nvm use            # or install Node 24.x
corepack enable
pnpm install
pnpm dev           # web, realtime gateway, event simulator, ai-service → http://localhost:3000
```

| Command               | What it does                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | SSR server on `:3000`, client assets + HMR on `:3001`                                                                                                                                     |
| `pnpm build`          | Production client + server bundles (Rspack)                                                                                                                                               |
| `pnpm build:devtools` | Same, with the reliability panel compiled in (`dist-devtools/`, used by E2E)                                                                                                              |
| `pnpm start`          | Build (if needed) and run the production server                                                                                                                                           |
| `pnpm check`          | Lint, typecheck and unit/component tests for every package                                                                                                                                |
| `pnpm coverage`       | The same tests with a coverage report per package (`coverage/` in each)                                                                                                                   |
| `pnpm e2e`            | Playwright against the production build (`pnpm build && pnpm build:devtools` first): user flows, reliability under injected faults, and an axe accessibility scan of every page and state |
| `pnpm eval`           | Grounding evaluation against a real model if `OPENAI_*` is set, else the mock. `--rpm 5` paces it for a free tier                                                                         |

If port 3000 is taken: `PORT=3100 pnpm dev`.

If `pnpm dev` exits within a second with `@pulsedesk/web#dev` failed (Linux): Turbo's
full-screen view hides the cause, so run `pnpm turbo run dev --ui=stream` to see it. If
it says `EMFILE: too many open files, watch …`, the machine is out of file-watcher
instances (editors hold most of the default 128). Raise the limit with
`sudo sysctl fs.inotify.max_user_instances=512`, or close an editor.

## Repository structure

```text
apps/
  web/                 React 19 app: Rspack client + server builds, streaming SSR
    client/            entry-client.tsx (hydrateRoot)
    server/            HTTP server, SSR pipeline, CSP, asset manifest, gateway client
    src/               app shell, pages, features (sessions, dashboard, realtime, copilot)
  realtime-gateway/    Node WebSocket gateway: sequencing, replay buffer, snapshots, presence
  ai-service/          AI copilot backend: providers (mock, OpenAI-compatible), NDJSON streaming,
                       grounding checker and evaluation (src/evaluation/)
  event-simulator/     Believable visitor traffic, posted to the gateway's ingest API
packages/
  contracts/           Zod schemas + inferred types: realtime events, WS protocol, DTOs
  state/               Redux Toolkit domain layer (framework-agnostic): slices, selectors
  realtime-client/     WebSocket client: state machine, resume cursor, backoff, typed events
  observability/       Logger + metrics API with pluggable sinks
  test-utils/          Seeded, deterministic session factories for tests and mocks
  ui/                  Design system: tokens (Tailwind v4 @theme) and accessible components
  typescript-config/   Shared strict tsconfig presets
  eslint-config/       Shared flat ESLint config (type-aware, react-hooks, jsx-a11y)
tests/
  e2e/                 Playwright: user flows, fault injection, accessibility scan (axe)
docs/adr/              Architecture decision records
prompts/               Prompts for AI-assisted planning, implementation, tests, review, refactoring
```

Internal packages and the Node services ship **TypeScript source** with no build step:
Rspack, Vitest and Node 24's native type stripping consume it directly (the gateway runs
as `node src/main.ts`). This removes stale-`dist` issues and watch-order coupling from
the task graph.

## Roadmap

Phase-by-phase delivery plan, decisions and acceptance criteria: [docs/roadmap.md](docs/roadmap.md).

## Realtime reliability

Every event is applied exactly once and in order, whatever happens to the connection:
a contiguous global sequence, resume cursors with replay, heartbeat with dead-socket and
"Degraded" detection, a reorder buffer, dedupe by sequence and eventId, same-socket
resync for lost frames, and server-side backpressure. The UI stays quiet: a status pill
for short blips, a banner only after 10 s, one toast on recovery, and replayed events
marked in the timeline.

In development (`pnpm dev`) a **Reliability** button (bottom left) opens a panel that
injects faults into the live connection: disconnect/reconnect, latency, dropped,
duplicated and reordered events. It isn't in production builds, and CI proves it.
Details: [docs/realtime-reliability.md](docs/realtime-reliability.md).

## AI copilot

The session page has a copilot next to the live timeline (a tab on smaller screens).
Quick actions (summarise, what's blocking, suggest a reply, unusual behaviour, key
events) or a free-form question stream an answer in, with Cancel, Retry and a partial
answer kept on failure. Several answers can stream at once, and the WebSocket is
unaffected throughout.

- The browser only names the session; the web server builds the model's context with
  `toAIContext()`, a unit-tested privacy boundary (no ids, names, city or timestamps).
- `POST /api/ai/chat` streams NDJSON from ai-service through the web server; cancelling
  aborts the provider end to end. Time limits apply to the first token and the whole answer.
- The default provider is a deterministic mock grounded in the session data;
  `AI_PROVIDER=openai` switches to a real model.
- **Answers are checked, not trusted.** ai-service checks every complete answer against
  the context the model saw: claims of a purchase, signup, contact request, form
  submission or error must match an event. Anything unsupported is flagged under the
  answer ("Couldn't verify against this session's events: …", with the reason). A click
  on "Upgrade" is not a payment.
- A regression suite runs nine realistic sessions through every quick action in CI, and
  fails if any answer makes an unsupported claim. `pnpm eval` runs the same cases against
  a real model and writes a report. What rule-based checking can't catch:
  [LIMITATIONS.md](apps/ai-service/src/evaluation/LIMITATIONS.md).
- In dev, the Reliability panel can make the copilot time out, fail with a 500, stream
  slowly, or invent a claim (to see the guard catch it).

Details: [docs/ai-copilot.md](docs/ai-copilot.md).

## AI-assisted development

This project is built with an AI coding assistant, under a loop where AI output is
checked like any other: plan → human review → implementation in small verified steps →
mutation-checked tests → AI review → human review and commit. The workflow, with real
examples from this repository's history: [docs/ai-development-workflow.md](docs/ai-development-workflow.md).
The prompts for each step: [prompts/](prompts/README.md).

## Architecture decisions

- [ADR-001: WebSocket for realtime updates (not SSE or polling)](docs/adr/001-websocket-vs-sse.md)
- [ADR-002: Redux state boundaries](docs/adr/002-redux-state-boundaries.md)
- [ADR-003: Custom streaming SSR](docs/adr/003-ssr-architecture.md)
- [ADR-004: NDJSON over fetch for AI streaming](docs/adr/004-ndjson-for-ai-streaming.md)

## Environment variables

Each service reads its own variables; `pnpm dev` passes them through Turborepo.

**web**

| Variable             | Default                  | Purpose                                                  |
| -------------------- | ------------------------ | -------------------------------------------------------- |
| `PORT`               | `3000`                   | SSR server port                                          |
| `CLIENT_DEV_PORT`    | `3001`                   | Dev asset server (HMR)                                   |
| `GATEWAY_HTTP_URL`   | `http://localhost:4000`  | Gateway HTTP API used server-side (SSR, `/api/sessions`) |
| `PUBLIC_GATEWAY_URL` | `ws://localhost:4000/ws` | Gateway WebSocket URL handed to the browser              |
| `SSR_DATA_BUDGET_MS` | `250`                    | Max time SSR waits for data before streaming skeletons   |
| `AI_SERVICE_URL`     | `http://localhost:4100`  | ai-service, called server-side by `/api/ai/chat`         |

**realtime-gateway**

| Variable             | Default  | Purpose                                                   |
| -------------------- | -------- | --------------------------------------------------------- |
| `GATEWAY_PORT`       | `4000`   | HTTP + WebSocket port (not `PORT`, which belongs to web)  |
| `REPLAY_BUFFER_SIZE` | `10000`  | Events retained for replay after reconnects               |
| `IDLE_AFTER_MS`      | `45000`  | Inactivity before a session is marked idle                |
| `CLOSE_AFTER_MS`     | `180000` | Inactivity before a session is closed                     |
| `LOG_LEVEL`          | `info`   | `debug` logs every handshake and rejected ingest          |
| `MAX_BUFFERED_BYTES` | 8 MiB    | Per-socket send backlog before a slow consumer is dropped |
| `PRESENCE_GRACE_MS`  | `5000`   | How long a disconnected viewer stays "viewing"            |

**ai-service**

| Variable                    | Default                     | Purpose                                                                                                                   |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AI_SERVICE_PORT`           | `4100`                      | HTTP port                                                                                                                 |
| `AI_PROVIDER`               | `mock`                      | `mock` or `openai` (any OpenAI-compatible endpoint)                                                                       |
| `OPENAI_API_KEY`            | —                           | Required with `AI_PROVIDER=openai` (and for `pnpm eval` against a real model); never reaches the browser                  |
| `OPENAI_MODEL`              | —                           | Required with `AI_PROVIDER=openai` and for `pnpm eval`                                                                    |
| `OPENAI_BASE_URL`           | `https://api.openai.com/v1` | Chat Completions endpoint                                                                                                 |
| `OPENAI_MAX_OUTPUT_TOKENS`  | `600`                       | Output limit per answer. Models that reason first spend it on reasoning too; raise it if answers stop at the length limit |
| `AI_FIRST_TOKEN_TIMEOUT_MS` | `10000`                     | No first token by then → `timeout` error in the stream                                                                    |
| `AI_TOTAL_TIMEOUT_MS`       | `45000`                     | Hard limit for one answer                                                                                                 |
| `AI_MOCK_TOKEN_MS`          | `35`                        | Mock provider pacing per token                                                                                            |
| `AI_DEBUG`                  | off (`1` in `pnpm dev`)     | Dev fault injection and `/debug/requests/:id`. Never in production                                                        |

To use a real model in development, copy `apps/ai-service/.env.example` to
`apps/ai-service/.env` (gitignored) and add your key. `pnpm dev` and `pnpm eval` read it;
`pnpm start` and the E2E suite never do, so tests always run against the mock.

**event-simulator**

| Variable           | Default                 | Purpose                                                  |
| ------------------ | ----------------------- | -------------------------------------------------------- |
| `GATEWAY_HTTP_URL` | `http://localhost:4000` | Where to post events                                     |
| `SESSION_COUNT`    | `24`                    | Concurrent simulated visitors                            |
| `EVENT_RATE`       | `3`                     | Approximate events per second across all visitors        |
| `ERROR_RATE`       | `0.01`                  | Fraction of events sent malformed (exercises validation) |
| `SEED`             | random                  | Fixed seed for reproducible traffic                      |

Try the failure paths: use the Reliability panel in dev; stop the gateway process while
the app is open (the indicator shows Reconnecting with a countdown, a banner appears
after 10 s, and it recovers on its own); or open a page with the gateway down (SSR
renders the error state, and the page heals when the gateway returns).
