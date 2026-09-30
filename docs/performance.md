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

### Known opportunities (to be evaluated in Phase 7)

1. **Zod on the client.** Full Zod is used only to validate network input. Zod 4's
   tree-shakeable `zod/mini` API would likely remove most of its weight; this requires
   rewriting `packages/contracts` schemas, which are shared with the Node services.
2. **Route-level code splitting** with `React.lazy`: the session detail page (and, from
   Phase 5, the AI copilot) don't need to be in the dashboard's initial load.
3. **Lazy AI copilot** once it exists.
