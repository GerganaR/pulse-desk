# ADR-003: Custom streaming SSR with React 19, Rspack and a Node HTTP server

- **Status:** Accepted
- **Date:** 2026-09-30
- **Last reviewed:** 2026-10-01 (Phase 9): data prefetch and lazy routes updated to what was built

## Context

PulseDesk's first screen is a dashboard of live sessions. We want:

- meaningful HTML on first byte (fast LCP, usable before JS loads, no layout flash);
- a clear boundary between what is rendered on the server and what starts only in the
  browser (the WebSocket connection, AI streaming);
- full control over the document, headers (CSP) and error handling — both to demonstrate
  how SSR works under the hood and because a monitoring console has unusual needs
  (live data must never be cached; visitor-supplied strings end up in HTML).

Next.js/Remix would provide much of this out of the box. This project deliberately
builds the pipeline by hand to own and explain each layer.

## Decision

1. **Two Rspack builds.** `rspack.client.config.ts` (target: browserslist) produces
   content-hashed chunks and an `asset-manifest.json`. `rspack.server.config.ts`
   (target: node24, ESM output) bundles the HTTP server, SSR pipeline and React tree into
   a single self-contained file. CSS enters the graph only via the client entry.

2. **React renders the whole document.** `<Document>` renders `<html>`, and the client calls
   `hydrateRoot(document, …)`. React 19 hoists `<title>`/`<meta>` from anywhere in the tree
   and dedupes stylesheets rendered with `precedence`, so no head-management library is
   needed.

3. **Streaming with `renderToPipeableStream`.** Headers are sent at `onShellReady`;
   Suspense boundaries stream in as they resolve. A hard timeout aborts slow renders
   (remaining boundaries complete on the client); client disconnects abort rendering.
   Shell failures return a static fallback document rendered without React.

4. **Declarative router, not React Router data APIs.** Server: `<StaticRouter>`; client:
   `<BrowserRouter>`. HTTP concerns (redirects, 404) are declared as `handle` metadata on
   the same route table and resolved by the server before rendering. Server-side data
   is prefetched into a per-request Redux store and serialised (see ADR-002), keeping
   Redux as the single source of domain truth rather than adding a parallel loader cache.
   The prefetch has a **time budget** (250 ms): past it, the requests are aborted and the
   page streams with skeletons, so time to first byte never waits on a slow backend.

5. **One `<Root>` for both entries.** Server and client render the identical tree; only
   the router differs. This is the primary structural defence against hydration
   mismatches.

6. **Runtime config and bootstrap data** are injected via `bootstrapScriptContent`, escaped
   for script context, with a per-request CSP nonce applied by React to every script it
   emits. The same build artefact can therefore be promoted across environments.

7. **Development:** the Rspack dev server serves client assets with HMR/React Refresh on
   its own port; the server bundle is watch-built and the SSR process restarted after
   each successful rebuild.

8. **Lazy routes that still render in the first flush** (Phase 7). Each page is its own
   chunk, wrapped by `lazyRoute()`: `React.lazy` alone always suspends once, even for a
   loaded module, which would put every page behind a fallback that needs JavaScript to
   resolve. The server preloads all routes at startup and renders them synchronously;
   the page's chunk is added to the bootstrap scripts (all `async`), so the browser
   fetches it in parallel with the main bundle. `progressiveChunkSize` is set to
   infinity so React never defers a completed boundary's HTML behind an inline script.
   The realtime connection is a further chunk, sent as a low-priority preload and run
   after hydration.

## What renders where

| Rendered on the server                 | Starts only after hydration             |
| -------------------------------------- | --------------------------------------- |
| App shell, navigation, page structure  | WebSocket connection and live updates   |
| Page titles/meta                       | Connection status transitions           |
| Sessions snapshot and session timeline | AI copilot panel (SSR sends a skeleton) |
| Empty, error and not-found states      | Dev reliability panel (devtools builds) |

## Alternatives considered

- **Next.js / React Router framework mode.** Faster to build, better-trodden. Rejected
  for this project because the goal is to own the SSR, bundling and hydration boundary,
  and because RSC is not needed for a dashboard whose data is mostly live.
- **`renderToString`.** Simpler, but blocks on the slowest data and gives up
  streaming/selective hydration.
- **Hydrating a `#root` div inside a string template.** Common and simple; rejected
  because React 19's document-level rendering removes the need for head management.
- **React Router data routers (`createStaticHandler`).** Good fit when loaders own data.
  Here Redux owns domain data; loaders would duplicate it, and lazy routes require
  resolving matches before hydration.
- **Externalising `node_modules` in the server bundle.** Smaller output, but the
  artefact then depends on install layout at runtime. Bundling keeps deploys hermetic.

## Consequences

- We own concerns a framework would handle: asset manifest, CSP, streaming error
  handling, dev orchestration. Each is small, but each is ours to maintain.
- Hydration safety depends on discipline (no `Date.now()`/locale formatting in render
  without a server-provided value). It's enforced by jsdom hydration tests and by E2E
  tests that fail on any console error.
- Route-level code splitting needs no router machinery, but it did need `lazyRoute()`
  (decision 8) and a manifest that maps route chunks to scripts. If the route chunk
  arrives after the main bundle, selective hydration hydrates the shell first.
- The server must know the client's assets. In production it reads the manifest once;
  in development it fetches it from the dev server on every request, and answers 503
  with a refresh while the first compile is still running.

## Tradeoffs

Full control and a hermetic server artefact, at the cost of more code than a framework.
The pipeline is roughly 600 lines, and every line can be explained. That is appropriate
for this project, but not a general recommendation for product teams without a reason
to own SSR.
