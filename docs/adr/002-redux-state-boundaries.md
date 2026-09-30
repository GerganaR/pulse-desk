# ADR-002: Redux state boundaries

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

PulseDesk has several kinds of state with very different lifetimes and audiences:

- **Domain data** shared across routes and updated from the network: sessions, their
  events, the realtime connection, AI conversations. Many components read it; updates
  arrive at high frequency and out of band (WebSocket).
- **UI state** owned by a single component: whether a menu is open, the text in an
  input, which view (chart/table) a card shows.
- **URL state**: filters and search on the sessions list.
- **Ambient environment**: the current time, the theme preference.

Putting everything in Redux makes every keystroke and hover an action, couples
components to a global store they don't need, and makes SSR serialise noise. Putting
nothing in Redux scatters network data across components and hooks, and makes
reconnect/replay logic (Phase 3–4) hard to reason about.

## Decision

| State                                                                   | Where it lives                                | Why                                                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions, session events, connection status, notifications, AI requests | **Redux** (`packages/state`)                  | Shared, network-sourced, updated outside React's render cycle; needs deterministic reducers for dedup/ordering and a single serialisable snapshot for SSR              |
| Menu open, input text, hover, chart/table toggle                        | **Component state**                           | Owned by one component; no one else cares                                                                                                                              |
| Status filter and search query                                          | **URL search params**                         | Shareable, survives reload, works with back/forward, renders correctly on the server                                                                                   |
| Theme preference                                                        | **React context + cookie**                    | UI preference; the cookie lets the server render the right theme with no flash                                                                                         |
| Current time (for "8s ago")                                             | **External store via `useSyncExternalStore`** | Ticks every second; in Redux it would dispatch 3,600 actions/hour and re-run every selector. `getServerSnapshot` returns the server's render time so hydration matches |

Within Redux:

- **Normalised entities** with `createEntityAdapter`. No `sortComparer`: `lastActivityAt`
  changes on almost every event, so a maintained sort order would be recomputed per
  update. Ordering happens in memoised selectors, only for consumers that need it.
- **`packages/state` is framework-agnostic.** It has no React and no fetch. Network access
  is injected as the thunk `extra` argument (`PulseApi`), so reducers and selectors run
  in Node (SSR, load tests) and in unit tests with fakes.
- **Selectors take primitive arguments** (`now`, `status`, `query`) and time-dependent
  selectors take a _quantised_ time, so memoisation holds between clock ticks.
- **One store per SSR request**, never a module singleton, so one visitor's data can never
  leak into another's response.
- **Fetch deduplication** via the thunk `condition`. Aborting is reserved for the SSR data
  budget; components never abort the shared fetch on unmount, because the result is
  shared, and under StrictMode abort-on-cleanup combined with dedupe would load nothing.

## Alternatives considered

- **RTK Query** for the snapshot. Good fit for request/response caching, but most data
  here arrives as a _stream_ that must be merged, deduplicated and ordered by sequence
  (Phase 3–4). A hand-written slice keeps that logic explicit and testable. RTK Query
  remains a reasonable choice for future CRUD-style endpoints.
- **Zustand / Jotai.** Lighter weight, but RTK's entity adapters, action log (DevTools
  replay of a reconnect sequence is valuable for debugging) and the explicit role
  requirement all favour Redux.
- **All state in Redux**, including UI flags. Rejected for the reasons in Context.

## Consequences

- Contributors need a rule of thumb, and this is it: _if another route or the network cares,
  it's Redux; if only this component cares, it's local; if it should be in a link, it's the URL._
- Realtime events (Phase 3) must be batched before dispatch so bursts don't produce
  hundreds of actions and renders.

## Tradeoffs

More upfront structure than a single `useState`-heavy app, in exchange for predictable
data flow under reconnects, replays and bursts. That is the part of this app most likely
to have bugs.
