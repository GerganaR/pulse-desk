# Performance

> Living document. Each phase records measurements here so optimisations are judged
> against numbers, not intuition. Sections are in phase order: the history shows how the
> bundle grew until Phase 7 brought it back under budget.

## Where it stands (after Phase 7)

| Measure                                                  | Before (Phase 6) | After (Phase 7)                 |
| -------------------------------------------------------- | ---------------- | ------------------------------- |
| Initial JS, every page (minified)                        | 474.7 KB         | **337.9 KB** (budget 350 KB)    |
| Initial JS, gzipped                                      | 144.5 KB         | **108.1 KB**                    |
| Sessions list with 2,000 sessions: blocking time at load | 1,787 ms         | 159 ms                          |
| Sessions list with 2,000 sessions: time until Live       | 19.1 s           | 0.9 s                           |
| Dashboard on slow 4G: first contentful paint             | 1,360 ms         | 644 ms                          |
| 1,000 events in one second, 4× CPU throttle              | not measured     | p95 frame 16.7 ms on every page |
| 10,000-event timeline: rows in the DOM                   | all of them      | 14                              |

Details and method for each row are in [Phase 7](#phase-7-results) below.

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

## Phase 6 delta

Same method. **Initial JS unchanged**: 474.7 KB minified / 144.5 KB gzipped. The
grounding checker runs in ai-service, not in the browser; the client only gained an
`unverified` field in the `ai` slice.

The lazy copilot chunk grew from 14.2 KB to **15.6 KB minified** (5.7 → **6.0 KB
gzipped**): the "couldn't verify" flag and its announcement.

## Phase 7: results

Where the numbers come from, so they can be re-measured:

- **Bundle:** `pnpm build && pnpm bundle:report` on the Phase 7 commit (`3a7b6fd`),
  re-run during Phase 9. Deterministic. CI enforces it (`performance.yml`).
- **Headless load:** `pnpm load` (Vitest; real reducers, a real gateway and a real
  ai-service in-process). Runs in CI with loose thresholds.
- **Browser:** `pnpm perf` (Playwright, production build, CPU throttled 4×), recorded
  locally at the end of Phase 7 on one developer laptop. **Not run in CI:** the numbers
  depend on the machine. Treat them as one machine's measurements, good for comparing
  builds and windows against each other, not as absolutes.

### Bundle

| Group                                                                    | Minified     | gzip -9      | Brotli (what is sent) |
| ------------------------------------------------------------------------ | ------------ | ------------ | --------------------- |
| `runtime`                                                                | 4.4 KB       | 1.9 KB       | 1.7 KB                |
| `framework` (react, react-dom, react-router)                             | 255.7 KB     | 79.7 KB      | 68.3 KB               |
| vendors (Redux Toolkit, Immer, react-redux, icons)                       | 38.4 KB      | 13.9 KB      | 12.6 KB               |
| `main` (app shell, state, design system)                                 | 39.3 KB      | 12.5 KB      | 11.1 KB               |
| **Initial JS, every page**                                               | **337.8 KB** | **108.1 KB** | **93.6 KB**           |
| Initial CSS                                                              | 44.9 KB      | 8.8 KB       | 7.6 KB                |
| Preloaded, run after hydration (realtime client, wire schemas, Zod mini) | 43.1 KB      | 14.2 KB      | 12.8 KB               |

Per route, on top of the initial scripts (budget: 60 KB each):

| Route            | Its own chunk | Everything a first visit downloads (minified / gzip / Brotli) |
| ---------------- | ------------- | ------------------------------------------------------------- |
| `dashboard`      | 15.7 KB       | 396.5 KB / 127.6 KB / 111.3 KB                                |
| `sessions`       | 39.7 KB       | 420.6 KB / 134.8 KB / 117.8 KB                                |
| `session-detail` | 52.1 KB       | 432.9 KB / 138.9 KB / 121.5 KB                                |

Two further lazy chunks load on demand: the copilot panel (19.9 KB minified, 7.5 KB
gzipped; it now carries its own AI schemas) and Web Vitals reporting (9.0 KB, loaded when
the browser is idle).

What moved the number, from 474.7 KB to 337.8 KB of initial JS:

1. **`zod/mini` in `packages/contracts`.** Full Zod was the largest dependency after
   React. The schemas were rewritten for the tree-shakeable API; Node services use the
   same schemas.
2. **Validation left the initial bundle entirely.** The realtime connection (client,
   wire schemas, Zod) is its own chunk: preloaded with the page at low priority, run
   after hydration. A server-rendered page is readable and interactive before any of it
   executes.
3. **Route-level splitting.** Each page is a chunk; the server sends the right one with
   the page, so there is no second waterfall ([ADR-003](adr/003-ssr-architecture.md),
   decision 8).
4. **Precompression at build time.** Brotli and gzip copies are written next to every
   text asset and served by content negotiation.

Splitting is not free: a first visit to the dashboard downloads 396.5 KB in total
against 474.7 KB before, a real saving of 16%, not the 29% the initial-JS figure
suggests. What changed more is _when_ code runs: less of it stands between the HTML and
an interactive page.

Phase 8 (accessibility fixes: focusable scroll areas, a heading for a failed page chunk)
added 0.1 KB: initial JS is **337.9 KB** on the merged code, the same 108.1 KB gzipped.

One open item: Rspack's own entrypoint warning still fires, because it counts JS and CSS
together (382.7 KB against 350 KB). CI enforces initial JS ≤ 350 KB. Which definition is
the budget is a decision for the developer (see the roadmap's carried-over items).

### Page load, before and after

Median of 5 cold loads, 4× CPU throttle. "Before" is the Phase 6 build served against
the same gateway.

| Page                         | Build  | Blocking time | FCP      | Until Live |
| ---------------------------- | ------ | ------------- | -------- | ---------- |
| Dashboard, 25 sessions       | before | 133 ms        | 164 ms   | 515 ms     |
|                              | after  | 94 ms         | 148 ms   | 532 ms     |
| Sessions, 25 sessions        | before | 187 ms        | 184 ms   | 690 ms     |
|                              | after  | 131 ms        | 184 ms   | 705 ms     |
| Session detail               | before | 133 ms        | 152 ms   | 563 ms     |
|                              | after  | 92 ms         | 132 ms   | 501 ms     |
| Sessions, **2,000 sessions** | before | 1,787 ms      | 388 ms   | 19,145 ms  |
|                              | after  | 159 ms        | 216 ms   | 909 ms     |
| Dashboard, **slow 4G**       | before | 146 ms        | 1,360 ms | 3,856 ms   |
|                              | after  | 110 ms        | 644 ms   | 1,912 ms   |

Reading it honestly:

- On a fast connection with little data, the gain is modest: about 30% less blocking time,
  FCP about the same. "Until Live" is up to 20 ms **later** on the dashboard and
  sessions list, because the connection now starts after hydration. That trade was made
  on purpose and is tracked in the roadmap.
- The large wins are where the old build had a real problem: 2,000 sessions (the table
  rendered every row; it is virtualised now, and the server renders only the top) and a
  slow network (less JavaScript ahead of first paint).
- LCP on the session page is ~700 ms in both builds: it is the timeline, which waits for
  data either way.

### Bursts

100 live sessions, 4× CPU throttle, one measured second of traffic delivered as many
small WebSocket frames, default 32 ms batching window.

| Page                                               | Rate     | p95 frame | Worst frame | Long tasks | DOM commits |
| -------------------------------------------------- | -------- | --------- | ----------- | ---------- | ----------- |
| Sessions list                                      | 50 /s    | 16.7 ms   | 16.8 ms     | 0          | 26          |
| Sessions list                                      | 200 /s   | 16.8 ms   | 16.8 ms     | 0          | 30          |
| Sessions list                                      | 1,000 /s | 16.7 ms   | 16.8 ms     | 0          | 29          |
| Dashboard                                          | 1,000 /s | 16.7 ms   | 16.8 ms     | 0          | 28          |
| Session page (events spread over 100 sessions)     | 1,000 /s | 16.8 ms   | 33.3 ms     | 0          | 22          |
| Session page, all 1,000 into one timeline (stress) | 1,000 /s | 16.8 ms   | 33.4 ms     | 0          | 21          |
| Sessions list, first burst after load (cold code)  | 1,000 /s | 16.8 ms   | 50 ms       | 0          | 26          |

The acceptance bar is p95 ≤ 34 ms, no frame over 100 ms, and at most 50 ms of blocking
time. A stricter bar (no frame over 40 ms) held in most runs but not all: about one run
in three had a single 50–67 ms frame in one scenario. That is recorded here and in the
roadmap rather than hidden behind a retry.

The batching window was chosen from the same scenario run at 0, 16, 32 and 100 ms:
the table and the reasoning are in [ADR-005](adr/005-event-batching.md). In short, every
window held 60 fps on this machine; 32 ms costs about 3.5× less script time than no
batching at 1,000 events/s.

### A 10,000-event timeline

| Measure                                     | Result                               |
| ------------------------------------------- | ------------------------------------ |
| Rows in the DOM                             | 14 (439 DOM nodes on the whole page) |
| Heap growth for 10,000 entries              | 3.3 MB                               |
| Scrolling at 4 screens/s                    | p95 16.7 ms, worst 16.8 ms           |
| Scrolling all 10,000 in one second (stress) | p95 16.8 ms, worst 16.8 ms           |
| Appending 200 events/s while at the bottom  | p95 16.7 ms, 23 commits              |

### Headless load scenarios (`pnpm load`)

| Scenario                                                 | Result                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1,000-event burst through the reducers, one batch        | 7.0 ms (about 144,000 events/s)                                                         |
| The same burst as 32 flushes vs 1,000 dispatches         | 18 ms vs 70 ms (3.8×)                                                                   |
| The same burst over 100 vs 1,000 sessions                | 3.8 ms vs 17.4 ms (linear)                                                              |
| Append 10 events to a 10,000-event timeline              | 0.11 ms (was 18 ms through an Immer draft)                                              |
| Build a 10,000-event timeline in 200 flushes             | 40 ms (0.2 ms per flush)                                                                |
| Gateway: 100 simulated sessions, 5 clients, 6,801 events | ingested at 31,400 events/s; delivered to every client in 217 ms; broadcast avg 0.32 ms |
| 200 reconnects                                           | 201 sockets created, never more than 1 open; timers back to baseline (4)                |
| 10 concurrent AI streams (mock)                          | first token 449 ms median, total 2,378 ms median; one stream alone 2,458 ms; 0 failed   |

These thresholds are loose on purpose (shared CI runners). They catch a change in
complexity (linear to quadratic, a leaked timer), not a few percent.

### Observability

Web Vitals (LCP, INP, CLS, FCP, TTFB), hydration time, timeline render duration, batch
sizes, reconnects, heartbeat RTT and AI request timings are emitted through
`packages/observability`. In development the **Metrics** tab of the reliability panel
shows them live. No production sink is wired: there is nowhere to send them in a demo.

### Not done

- Lighthouse has not been run; the final run is Phase 10.
- The browser scenarios have only been measured on one machine, and not on a real phone.
- "Until Live" regressed by up to 20 ms on two pages (above).
- The budget definition (JS only, or JS + CSS) is undecided (above).
