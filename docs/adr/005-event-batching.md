# ADR-005: Batch realtime events into one Redux dispatch per window

- **Status:** Accepted
- **Date:** 2026-10-01 (decided in Phase 3, measured and kept in Phase 7)

## Context

Events arrive from the WebSocket whenever the gateway has them: a trickle in normal
traffic, hundreds per second in a burst, and several hundred at once when a reconnect
replays what was missed. Each event changes a session row, possibly a timeline, possibly
presence, and every dashboard aggregate derived from them.

Dispatching one Redux action per event means one reducer pass, one round of selector
recomputation and (after React's own batching within a task) one render per WebSocket
frame. ADR-002 already named this as the cost of putting the stream in Redux: "realtime
events must be batched before dispatch."

## Decision

Events are buffered between the realtime client and the store, and applied as **one
action per window**:

```text
socket frames ─► sequencer ─► batcher.push() ─► buffer ─► flush after 32 ms, or at 1,000 events
                                                            └─► dispatch(eventsReceived(batch))
                                                                  sessions, timelines and presence
                                                                  update in one reducer pass → one render
```

- **Window: 32 ms** (about two frames), a `setTimeout` started by the first event into an
  empty buffer. Latency added: at most one window.
- **Size cap: 1,000 events** flushes at once, so a burst cannot build an unbounded buffer.
- **`eventsReceived(batch)` is a single shared action** that the `sessions`, `timelines`
  and `presence` slices all handle. The reducers apply a batch's events in sequence order, through
  the same projection the gateway uses.
- **A snapshot clears the buffer** instead of flushing it: the snapshot supersedes
  anything pending.
- **`sync.completed` flushes first**, so replayed events are on screen before the UI
  says it has caught up. Stopping the connection flushes too: nothing buffered is lost.
- **The window is runtime configuration** (`PUBLIC_EVENT_BATCH_MS`, 0–1,000 ms), injected
  with the page's bootstrap data. A deployment can trade latency for renders without a
  rebuild, and the performance tests compare windows against one build.

Copilot text uses the same idea with a different clock: the runner buffers tokens and
dispatches at most once per animation frame per request (see
[ai-copilot.md](../ai-copilot.md#state-and-rendering)).

## Measurements

Sessions list, 100 live sessions, CPU throttled 4×, one measured second of traffic
delivered as many small frames (`pnpm perf`, Phase 7). "Commits" are DOM commits during
the measurement; script time is main-thread JavaScript.

| Window          | 200 events/s: commits | script     | 1,000 events/s: commits | script     |
| --------------- | --------------------- | ---------- | ----------------------- | ---------- |
| 0 ms (per task) | 202                   | 593 ms     | 157                     | 646 ms     |
| 16 ms           | 51                    | 241 ms     | 49                      | 261 ms     |
| **32 ms**       | **30**                | **174 ms** | **29**                  | **182 ms** |
| 100 ms          | 12                    | 102 ms     | 12                      | 164 ms     |

Headless, reducers only: 1,000 events over 100 sessions cost 18 ms as 32 flushes and
70 ms as 1,000 dispatches (3.8×).

Every window kept frames at 16.7 ms p95 in this scenario, including 0 ms: React already
coalesces renders within a task, and the table is virtualised. So the window does not
buy smoothness on this hardware. It buys **main-thread time**: about 3.5× less script at
1,000 events/s than no batching, which is the headroom a slower device or a heavier page
would need.

## Alternatives considered

- **No batching, rely on React's automatic batching.** React batches state updates within
  one task, but each WebSocket message is its own task, so every frame from the socket
  still costs a dispatch, a selector pass and a commit. Measured above: 5–7× the commits.
- **`requestAnimationFrame` as the clock.** The natural choice for visual updates, and
  what the copilot text uses. Rejected for the feed because background tabs don't get
  animation frames: events would pile up for as long as the tab is hidden, and the
  dashboard's counts would be stale the instant it became visible. A timer keeps a
  hidden tab's store current (throttled, but bounded by the size cap).
- **A longer window (100 ms).** Fewer commits still, and the measured cost is lower.
  Rejected as the default because it becomes visible as lag in the one place a person
  watches events arrive one at a time (a session timeline), and the saving from 32 ms to
  100 ms is small next to the saving from 0 ms to 32 ms. It stays available per
  deployment.
- **Batching in a Redux middleware or enhancer** (e.g. `autoBatchEnhancer`). That
  coalesces _subscriber notifications_, but still runs one reducer pass per event. With
  normalised state and several slices reacting to each event, the reducer passes are the
  cost worth removing.
- **Batching on the gateway.** It already sends events in frames when it has several,
  and replay uses 500-event frames. Client-side batching is still needed: the client
  cannot rely on how a server or a proxy happens to frame messages.

## Consequences

- Up to 32 ms of added latency per event. Imperceptible next to network latency, and
  measured as such (the "Live" indicator and time-to-live numbers are in
  [performance.md](../performance.md)).
- Anything that must observe events in order with other signals has to go through the
  batcher's rules: that is why snapshots clear it and `sync.completed` flushes it.
- Reducers must stay cheap for large batches. The timeline reducer was rewritten in
  Phase 7 to avoid Immer proxy overhead at the 10,000-entry cap (18 ms → 0.2 ms per
  flush), a cost that only appears once batches are large.
- Client-side retention piggybacks on the flush: a batch containing `session.closed` is
  the only moment a tab can go past its retention of ended sessions, so that is when it
  is checked.
