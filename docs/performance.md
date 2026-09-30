# Performance

> Living document. Each phase records measurements here so optimisations are judged
> against numbers, not intuition. The full write-up lands in Phase 7.

## Client bundle baseline (Phase 2)

Production build, initial JavaScript for any route (all code is currently in the initial
chunk group; route-level splitting is Phase 7 work).

| Chunk       | Contents                                             | Gzipped     |
| ----------- | ---------------------------------------------------- | ----------- |
| `framework` | react, react-dom, scheduler, react-router            | 79.9 KB     |
| vendors     | Zod, Redux Toolkit, Immer, react-redux, lucide icons | 37.1 KB     |
| `main`      | application code + workspace packages                | 13.2 KB     |
| `runtime`   | Rspack runtime                                       | 0.7 KB      |
| **Total**   |                                                      | **~131 KB** |

Largest dependencies by (unminified) source size: react-dom 620 KiB, **zod 359 KiB**,
react-router 345 KiB, Redux Toolkit 71 KiB, Immer 51 KiB.

The Rspack entrypoint budget (350 KB minified) is currently exceeded (~342 KiB ≈ 350 KB).
It is deliberately **not** raised to silence the warning.

## Phase 4 delta

Measured with the same method on both commits (initial scripts from `asset-manifest.json`,
`gzip -9`):

| Build               | Initial JS (minified) | Gzipped     |
| ------------------- | --------------------- | ----------- |
| Phase 3 (`4fa1793`) | 451.9 KB              | 137.4 KB    |
| Phase 4             | 463.9 KB              | 140.8 KB    |
| **Delta**           | **+12.0 KB**          | **+3.4 KB** |

The increase is the event sequencer, heartbeat, browser-lifecycle handling, outage
banner, toasts and the notifications slice. The reliability panel, fault injector,
`Dialog` and `Tooltip` add nothing: they exist only in the devtools build, which
`check-devtools-excluded.ts` verifies in CI. The budget warning stays on and the limit
unchanged. Phase 7 owns bringing it back under.

## Phase 5 delta

Same method. The gzipped column is bytes ÷ 1024 (as in the Phase 4 table); the
minified column is bytes ÷ 1000.

| Build               | Initial JS (minified) | Gzipped     |
| ------------------- | --------------------- | ----------- |
| Phase 4 (`a563503`) | 464.0 KB              | 140.9 KB    |
| Phase 5             | 474.7 KB              | 144.5 KB    |
| **Delta**           | **+10.7 KB**          | **+3.6 KB** |

By chunk: the Rspack runtime grew 1.1 KB gzipped. Production now has its first lazy
chunk, so the runtime includes chunk loading, which later route splitting reuses. `main`
grew 2.5 KB: the `ai` slice and selectors, `Tabs`, the copilot panel shell and skeleton,
the fault-switch context (an always-`null` provider in production) and the AI answers tile.

The copilot itself (conversation UI, streaming client, NDJSON reader, runner, AI
schemas) is a **lazy chunk of 14.2 KB minified / 5.7 KB gzipped**, loaded after hydration
on the session page only. None of it is in the initial bundle, which was checked by
searching the initial chunks for its strings.

### Known opportunities (to be evaluated in Phase 7)

1. **Zod on the client.** Full Zod is used only to validate network input. Zod 4's
   tree-shakeable `zod/mini` API would likely remove most of its weight; this requires
   rewriting `packages/contracts` schemas, which are shared with the Node services.
2. **Route-level code splitting** with `React.lazy`: the session detail page (and, from
   Phase 5, the AI copilot) don't need to be in the dashboard's initial load.
3. ~~Lazy AI copilot~~: done in Phase 5 (5.7 KB gzipped chunk).
