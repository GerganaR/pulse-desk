# PulseDesk

PulseDesk is a React 19 real-time session monitoring and AI copilot application built to
explore resilient realtime frontend architecture. It combines WebSocket-driven session
updates, streamed AI responses, Node.js streaming SSR, Redux Toolkit state management, and
a pnpm/Turborepo monorepo built with Rspack.

> **Status:** under active, incremental development. Phases 1–3 are complete: monorepo,
> shared contracts, design system, custom streaming SSR with Rspack, Redux domain layer,
> dashboard and session views, and the realtime stack (WebSocket gateway, event
> simulator, realtime client). This README is expanded as each phase lands.

## Running locally

Requires **Node 24** (see `.nvmrc`) and pnpm (via Corepack).

```bash
nvm use            # or install Node 24.x
corepack enable
pnpm install
pnpm dev           # web, realtime gateway and event simulator → http://localhost:3000
```

| Command      | What it does                                                 |
| ------------ | ------------------------------------------------------------ |
| `pnpm dev`   | SSR server on `:3000`, client assets + HMR on `:3001`        |
| `pnpm build` | Production client + server bundles (Rspack)                  |
| `pnpm start` | Build (if needed) and run the production server              |
| `pnpm check` | Lint, typecheck and unit/component tests for every package   |
| `pnpm e2e`   | Playwright against the production build (`pnpm build` first) |

If port 3000 is taken: `PORT=3100 pnpm dev`.

## Repository structure

```text
apps/
  web/                 React 19 app: Rspack client + server builds, streaming SSR
    client/            entry-client.tsx (hydrateRoot)
    server/            HTTP server, SSR pipeline, CSP, asset manifest, gateway client
    src/               app shell, pages, features (sessions, dashboard, realtime)
  realtime-gateway/    Node WebSocket gateway: sequencing, replay buffer, snapshots, presence
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
  e2e/                 Playwright
docs/adr/              Architecture decision records
```

Internal packages and the Node services ship **TypeScript source** with no build step:
Rspack, Vitest and Node 24's native type stripping consume it directly (the gateway runs
as `node src/main.ts`). This removes stale-`dist` issues and watch-order coupling from
the task graph.

## Roadmap

Phase-by-phase delivery plan, decisions and acceptance criteria: [docs/roadmap.md](docs/roadmap.md).

## Architecture decisions

- [ADR-002: Redux state boundaries](docs/adr/002-redux-state-boundaries.md)
- [ADR-003: Custom streaming SSR](docs/adr/003-ssr-architecture.md)

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

**realtime-gateway**

| Variable             | Default  | Purpose                                                  |
| -------------------- | -------- | -------------------------------------------------------- |
| `GATEWAY_PORT`       | `4000`   | HTTP + WebSocket port (not `PORT`, which belongs to web) |
| `REPLAY_BUFFER_SIZE` | `10000`  | Events retained for replay after reconnects              |
| `IDLE_AFTER_MS`      | `45000`  | Inactivity before a session is marked idle               |
| `CLOSE_AFTER_MS`     | `180000` | Inactivity before a session is closed                    |
| `LOG_LEVEL`          | `info`   | `debug` logs every handshake and rejected ingest         |

**event-simulator**

| Variable           | Default                 | Purpose                                                  |
| ------------------ | ----------------------- | -------------------------------------------------------- |
| `GATEWAY_HTTP_URL` | `http://localhost:4000` | Where to post events                                     |
| `SESSION_COUNT`    | `24`                    | Concurrent simulated visitors                            |
| `EVENT_RATE`       | `3`                     | Approximate events per second across all visitors        |
| `ERROR_RATE`       | `0.01`                  | Fraction of events sent malformed (exercises validation) |
| `SEED`             | random                  | Fixed seed for reproducible traffic                      |

Try the failure paths: stop the gateway process while the app is open (the indicator
shows Reconnecting with a countdown and recovers on its own), or open a page with the
gateway down (SSR renders the error state, and the page heals when the gateway returns).
