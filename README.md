# PulseDesk

PulseDesk is a React 19 real-time session monitoring and AI copilot application built to
explore resilient realtime frontend architecture. It combines WebSocket-driven session
updates, streamed AI responses, Node.js streaming SSR, Redux Toolkit state management, and
a pnpm/Turborepo monorepo built with Rspack.

> **Status:** under active, incremental development. Phases 1–2 are complete: monorepo,
> shared contracts, design system, custom streaming SSR with Rspack, Redux domain layer,
> dashboard, sessions list and session detail (on generated data until the realtime
> gateway lands in Phase 3). This README is expanded as each phase lands.

## Running locally

Requires **Node 24** (see `.nvmrc`) and pnpm (via Corepack).

```bash
nvm use            # or install Node 24.x
corepack enable
pnpm install
pnpm dev           # http://localhost:3000
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
    server/            HTTP server, SSR pipeline, CSP, asset manifest
    src/               app shell, pages, components
packages/
  contracts/           Zod schemas + inferred types: realtime events, WS protocol, DTOs
  state/               Redux Toolkit domain layer (framework-agnostic): slices, selectors
  test-utils/          Seeded, deterministic session factories for tests and mocks
  ui/                  Design system: tokens (Tailwind v4 @theme) and accessible components
  typescript-config/   Shared strict tsconfig presets
  eslint-config/       Shared flat ESLint config (type-aware, react-hooks, jsx-a11y)
tests/
  e2e/                 Playwright
docs/adr/              Architecture decision records
```

Internal packages ship **TypeScript source** with no build step. Rspack, Vitest and Node's
native type stripping consume them directly. This removes stale-`dist` issues and
watch-order coupling from the task graph.

## Architecture decisions

- [ADR-002: Redux state boundaries](docs/adr/002-redux-state-boundaries.md)
- [ADR-003: Custom streaming SSR](docs/adr/003-ssr-architecture.md)

## Environment variables (web)

| Variable             | Default                  | Purpose                                                |
| -------------------- | ------------------------ | ------------------------------------------------------ |
| `PORT`               | `3000`                   | SSR server port                                        |
| `CLIENT_DEV_PORT`    | `3001`                   | Dev asset server (HMR)                                 |
| `SSR_DATA_BUDGET_MS` | `250`                    | Max time SSR waits for data before streaming skeletons |
| `MOCK_LATENCY_MS`    | `40`                     | Simulated latency of the temporary session source      |
| `MOCK_FAILURE_RATE`  | `0`                      | Probability (0–1) the session source fails             |
| `PUBLIC_GATEWAY_URL` | `ws://localhost:4000/ws` | Realtime gateway (Phase 3)                             |

Try the degraded paths: `MOCK_LATENCY_MS=1500 pnpm dev` shows streamed skeletons and a
client-side load; `MOCK_FAILURE_RATE=1 pnpm dev` shows the error state and retry.
