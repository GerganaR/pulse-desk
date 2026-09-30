# Realtime reliability

How PulseDesk keeps the live view correct when the connection isn't: drops, stalls,
lost frames, duplicates and reordering. The guarantee is simple to state:

> Every event is applied **exactly once, in sequence order**, whatever happens to the
> connection, and the UI says what's going on without nagging.

Code: `packages/realtime-client` (client), `apps/realtime-gateway/src/websocket`
(server), `apps/web/src/features/realtime` (UI). Protocol: `packages/contracts/src/protocol.ts`.
Transport choice: [ADR-001](adr/001-websocket-vs-sse.md).

## The foundation: one contiguous sequence

The gateway is the single writer. Its event log assigns every event the next number in
one global sequence (1, 2, 3, …, no holes). Everything else builds on that:

- **Ordering** is by `sequence`, never by timestamp (clocks skew; sequences don't).
- **Gap detection** is arithmetic: after applying _n_, the next event must be _n + 1_.
- **Resume** is a cursor: `{ streamId, sequence }` = "I have applied everything up to here".
- **Stream epochs**: the demo log lives in memory, so a gateway restart begins a new
  stream (new `streamId`) whose sequences restart at 1. A cursor from another epoch is
  never resumed; the client gets a fresh snapshot instead of a silent gap.

Every snapshot (HTTP for SSR, or over the socket) carries the sequence it reflects, so
the handoff from server-rendered data to live data has no gap and no overlap.

## Failure modes and what handles them

| Failure                                    | Detected by                                          | Recovery                                                            | Where                              |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| Socket closed (server restart, network)    | `close` event                                        | Reconnect with backoff, resume from cursor, replay                  | client + gateway handshake         |
| Socket silently dead (sleep, NAT timeout)  | Heartbeat: no `pong` within 6 s                      | Abandon the socket at once (no close handshake), reconnect          | client heartbeat                   |
| Slow link                                  | Pong RTT > 1 s, or a pong overdue > 1 s              | **Degraded** status; probes every 2 s until healthy                 | client heartbeat                   |
| Lost frame(s), mid-stream                  | Next event's sequence skips ahead                    | Hold later events; after 2 s, **resync** on the same socket         | `EventSequencer` + client          |
| Lost frame(s), stream then quiet           | `pong.headSequence` > applied position               | Same as above                                                       | `EventSequencer.observeHead`       |
| Out-of-order delivery                      | Sequence ahead of expected                           | Reorder buffer releases them in order when the gap fills            | `EventSequencer`                   |
| Duplicate delivery (replay overlap, retry) | `sequence ≤ applied`, or same sequence while pending | Dropped                                                             | `EventSequencer`                   |
| Same event sequenced twice upstream        | `eventId` already applied (bounded LRU, 5,000 ids)   | Dropped, and its slot counts as applied (no false gap)              | `EventSequencer`                   |
| Offline for longer than the replay buffer  | Gateway: cursor older than the log's oldest entry    | Fresh `snapshot`; the client replaces session state                 | gateway `canResumeFrom`            |
| Gateway restarted (new epoch)              | Cursor `streamId` ≠ current stream                   | Fresh `snapshot`; timelines from the old epoch are dropped          | gateway + `timelines` slice        |
| Browser offline                            | `offline` event / `navigator.onLine`                 | Pause retries (no wasted backoff); retry immediately on `online`    | `bindBrowserLifecycle`             |
| Tab hidden for a long time                 | `visibilitychange`                                   | On return: skip remaining backoff, send a heartbeat now             | `bindBrowserLifecycle`             |
| Slow consumer (client can't keep up)       | Gateway: socket `bufferedAmount` > 8 MiB             | Close with 4008; client reconnects and replay recovers it           | gateway `ConnectionManager`        |
| Flapping gateway (accepts then drops)      | —                                                    | Backoff resets only after 10 s live, so retries keep backing off    | client                             |
| Presence flicker on a short reconnect      | —                                                    | `presence.left` waits 5 s; a reconnect in time takes over the watch | gateway `ConnectionManager`        |
| Malformed frame                            | Zod decode fails                                     | Counted and ignored; the connection stays up                        | client (and gateway for its input) |

## Client state machine

```text
  idle ──connect()──► connecting ──open──► syncing ──snapshot / sync.completed──► live
                          ▲                   │  ▲                                  │
                          │                   │  └──── gap not filled in time ──────┤
                          │                   │        (resync: hello, same socket) │
                          │                   └────────── socket lost ──────────────┤
                          └──── timer ◄──── reconnecting ◄──────────────────────────┘
  any ──close()──► closed (terminal until connect())
```

Health is separate from lifecycle: `degraded` (and `rttMs`) describe a _live_ socket, so
"live but slow" doesn't need a status of its own. `network` mirrors what the browser
reports.

## The sequencer (reorder buffer + dedupe)

`EventSequencer` is pure and synchronous, which makes it easy to test exhaustively:

```text
applied = 6, incoming [7, 9, 8, 8, 10]
  7   contiguous → apply
  9   early → hold (gap at 8, start the 2 s gap timer)
  8   fills the gap → apply 8, then the held 9
  8   stale → drop
  10  contiguous → apply
```

Why a grace period before resyncing? Most gaps are reordering, not loss: the missing
event is usually a few milliseconds behind. Resyncing immediately would turn every
reorder into a round trip.

**Resync** re-sends `hello` with the applied cursor _on the same socket_. The gateway
runs the normal handshake again (welcome → `sync.started` → replay → `sync.completed`),
synchronously, so no broadcast can interleave. Events already held in the reorder buffer
arrive again in the replay and are dropped as duplicates. Nothing about the connection
(presence, watches) is torn down.

## Reconnect and backoff

- **Equal jitter**: `delay = ceiling/2 + random × ceiling/2`, `ceiling = min(30 s, 1 s × 2^(attempt−1))`.
  Without jitter, every client of a restarted gateway reconnects in lock-step. Full
  jitter spreads load slightly better but can retry after ~0 ms, which reads oddly in a
  "retrying in 4s" UI. Equal jitter keeps a floor. (The roadmap originally said full
  jitter; see its Phase 4 notes.)
- **Reset only after stability**: the attempt counter resets after the connection has
  been live for 10 s, not on connect. Otherwise a gateway that accepts and immediately
  drops would be hammered at the minimum delay forever.
- **`reconnectNow()`** (the banner's "Retry now", the `online` event, a tab returning)
  skips the remaining wait. If an attempt is already in flight, it doesn't open a second
  socket; it marks that attempt so a failure retries at once instead of waiting out the
  backoff. (An E2E flake found this race; there's a unit test for it now.)
- **Resume**: the new socket's `hello` carries the cursor; the gateway replays what was
  missed, in 500-event frames, framed by `sync.started` / `sync.completed`.

## Heartbeat

The gateway already pings at the WebSocket protocol level to find dead _clients_ (15 s).
Browsers can't see those pings, so the client runs its own application-level heartbeat
to find a dead _server_ and measure latency:

- `ping { nonce, sentAt }` right after going live, then every 10 s; one in flight at a time.
- `pong` arrives → RTT; `pong.headSequence` also feeds gap detection.
- Pong overdue by 1 s → degraded; RTT over 1 s → degraded; while degraded, probe every 2 s.
- No pong in 6 s → the socket is abandoned and replaced. Its eventual `close` event is
  ignored, like every event from a replaced socket.

Background tabs have throttled timers (down to once a minute in Chrome), which can only
make detection _later_, never produce a false timeout. On becoming visible after 5 s+,
the client pings immediately.

## Server-side backpressure

Broadcasts are serialised once and written to every live socket. A socket whose send
backlog (`bufferedAmount`) exceeds 8 MiB is closed with **4008 "Slow consumer"** and
destroyed if it hasn't closed 2 s later. Replay makes this safe: the client reconnects
with its cursor and catches up. The threshold sits well above a full replay burst, so a
healthy client catching up isn't mistaken for a slow one.

Other limits: at most 1,000 connections (HTTP 503 at upgrade), 16 KiB client frames, 20
invalid messages before a socket is closed (1008).

## What the user sees

The principle: the status pill always tells the truth; anything louder must be earned.

| Situation                                              | UI                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| First load                                             | Pill: **Connecting**, then **Live**                                                                           |
| Short drop (< 10 s)                                    | Pill: **Reconnecting · retry in 4s**. Nothing else.                                                           |
| Catch-up replay / resync                               | Pill: **Catching up · 23 events**                                                                             |
| Slow connection                                        | Pill: **Degraded · 1.5 s**                                                                                    |
| Browser offline                                        | Pill: **Offline · no network**                                                                                |
| Outage ≥ 10 s                                          | Non-modal banner: "Live updates paused · for 42s", with **Retry now**. Gone as soon as it's live.             |
| Recovery after a prolonged outage                      | One toast: "Live updates restored · Caught up on 23 missed events."                                           |
| Recovery by snapshot (gateway restart or long offline) | One toast explaining that sessions were reloaded.                                                             |
| Replayed events in a timeline                          | Brief tint plus a small history marker (`data-replayed`); screen readers hear "caught up after reconnecting". |

There is no toast per reconnect. The status pill uses `role="status"`, and only the label
is announced (the countdown and latency are `aria-hidden`), so screen readers aren't
spammed.

## Developer reliability panel

Development and devtools builds have a **Reliability** button (bottom left) that opens a
non-modal panel, so the timeline stays visible while you break things:

- **Diagnostics**: status, RTT, cursor, reconnect attempts, gaps/resyncs, reorder buffer,
  duplicates and stale events dropped, time since the last event.
- **Faults**, injected by wrapping the transport (`createFaultInjector`,
  `@pulsedesk/realtime-client/fault-injection`). The client can't tell it apart from a
  real network:

  | Control            | What it does                                           | Expected recovery                                   |
  | ------------------ | ------------------------------------------------------ | --------------------------------------------------- |
  | Disconnect         | Abnormal close (1006); new sockets fail until restored | Reconnecting with backoff; banner after 10 s        |
  | Reconnect          | Restores the network and retries at once               | Replay of missed events, in order, highlighted      |
  | Latency            | Delays every inbound frame (order preserved)           | Degraded above 1 s; recovers within ~2 s of removal |
  | Drop N             | Removes the next N events in transit                   | Gap → 2 s grace → resync on the same socket         |
  | Duplicate next     | Delivers the next event twice                          | Dropped; the timeline never shows it twice          |
  | Reorder next batch | Delivers the next batch after the one behind it        | Reorder buffer; no resync needed                    |

- **Log** of injected faults, newest first.

### Keeping it out of production

`__DEVTOOLS__` is a build-time constant (`rspack.shared.ts`): true in development and in
`pnpm build:devtools`, false in `pnpm build`. The panel is behind
`__DEVTOOLS__ ? lazy(() => import(...)) : null`, and the fault injector behind
`__DEVTOOLS__ && config.devTools`, so a production build has neither the chunk nor the
modules. Turbo's strict env mode also keeps an outer `PULSEDESK_DEVTOOLS=1` from
reaching `pnpm build`.

`apps/web/scripts/check-devtools-excluded.ts` (run in CI) proves it. Every devtools
module uses the string `pulsedesk-devtools` at runtime, so minification keeps it:

- `dist/` must not contain the marker anywhere, **including source maps**. A module that
  was bundled and then minified away would still appear in `sourcesContent`, so a pass
  means the modules never entered the module graph.
- `dist-devtools/` **must** contain it. That's the control that proves the check can
  find what it's looking for.

Removing either gate makes the check fail (verified by doing exactly that).

## Tests

| Level                | File                                                        | Covers                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (pure)          | `realtime-client/src/sequencer.test.ts`                     | Reorder, dedupe by sequence and by eventId, trailing gaps, snapshot resets                                                                                                                                                                                                                    |
| Unit (fake timers)   | `realtime-client/src/client.test.ts`                        | Exact backoff schedule for seeded jitter, stability reset, heartbeat timeout/degraded/probing, gap timeout → resync, offline, `close()` leaves no timers                                                                                                                                      |
| Unit                 | `realtime-client/src/fault-injection.test.ts`               | Every fault, latency never reorders, cut sockets go silent                                                                                                                                                                                                                                    |
| Unit                 | `realtime-gateway/src/websocket/connection-manager.test.ts` | Backpressure, `pong.headSequence`                                                                                                                                                                                                                                                             |
| Integration          | `realtime-gateway/src/reliability.integration.test.ts`      | Real client ↔ real gateway: socket killed mid-stream under load → contiguous replay; lost frames → same-socket resync; trailing gap; duplicate + reorder; expired cursor → snapshot                                                                                                           |
| Integration          | `realtime-gateway/src/gateway.integration.test.ts`          | Presence grace period                                                                                                                                                                                                                                                                         |
| Component            | `web/src/features/realtime/connection-status.test.tsx`      | Every indicator state; banner threshold, text and retry                                                                                                                                                                                                                                       |
| E2E (devtools build) | `tests/e2e/reliability.spec.ts`                             | **Flagship**: disconnect via the panel → Reconnecting → events produced meanwhile → reconnect → missed events appear once, in order, marked replayed → Live. Plus: banner and single toast, drop/duplicate/reorder keep the timeline equal to the gateway's record, latency → Degraded → Live |

The E2E specs assert on `data-sequence` attributes compared with the gateway's own record
of the session, never on timing. The guards were mutation-checked: disabling eventId
dedupe, head tracking, the gap timer, the heartbeat timeout, the backoff reset, offline
pausing, the presence grace or (for the flagship) cursor resume each makes a test fail.

## Known limits and production path

- **Single gateway, in-memory log.** Replay depth is the ring buffer (10,000 events);
  past that, a snapshot. The production path (Phase 9 docs) is a durable partitioned log
  (Redis Streams, Kafka) with per-partition cursors, and gateways fanned out through
  pub/sub. The client protocol already carries the pieces that needs (`streamId`,
  cursors, snapshots with positions).
- **Presence identity is unauthenticated** (it comes from the client's `hello`).
- **Client-side retention** of ended sessions in long-lived tabs is Phase 7 work.
- **Heartbeat thresholds are fixed**, not adaptive to the connection's normal RTT.
