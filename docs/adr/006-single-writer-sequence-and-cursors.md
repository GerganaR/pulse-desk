# ADR-006: One contiguous sequence from a single writer, resumed by cursor

- **Status:** Accepted
- **Date:** 2026-10-01 (decided in Phase 3, extended in Phases 3–4)

## Context

The console must show every visitor event exactly once and in order, across reconnects,
lost frames, duplicates and server restarts ([realtime-reliability.md](../realtime-reliability.md)).
That requires an answer to three questions that every later mechanism depends on: what
defines order, how a client says where it is, and how either side can tell that
something is missing.

Events come from producers (the simulator, standing in for a real collector) with their
own clocks, and also from the gateway itself: inactivity transitions and agent presence.

## Decision

1. **The gateway is the single writer.** Everything that enters the stream goes through
   `EventPipeline.publish`: validated producer events, sweeper transitions, presence.
   The event log assigns each event the next number in **one global sequence with no
   holes** (1, 2, 3, …).
2. **Order is by `sequence`, never by timestamp.** Timestamps are data for display.
3. **A cursor is `{ streamId, sequence }`**: "I have applied everything up to here in
   this stream." The client sends it in `hello`; the gateway replays what follows, framed
   by `sync.started` / `sync.completed`.
4. **Every snapshot carries the position it reflects**, whether it arrives over HTTP (for
   SSR) or over the socket. The client resumes from the snapshot's position, so the
   handoff from server-rendered data to live data has no gap and no overlap.
5. **Stream epochs.** The log lives in memory, so a restart begins a new stream with a
   new `streamId` and sequences from 1. A cursor from another epoch is never resumed:
   the client gets a fresh snapshot instead of a silent gap. (Added in Phase 3 after
   dev `--watch` reloads produced exactly that silent gap.)
6. **`pong` carries `headSequence`.** Without it, losing the _last_ events before a quiet
   period is undetectable until the next event arrives. (Added in Phase 4.)
7. **The log sits behind an interface** (`EventLog`: `append`, `readAfter`,
   `oldestSequence`, `headSequence`), with an in-memory ring buffer of 10,000 events as
   the only implementation. A cursor older than the buffer gets a snapshot.
8. **Producers post over HTTP** (`POST /ingest`), not the WebSocket. Ingest and fan-out
   are different concerns, HTTP retries are simple, and the gateway drops producer
   retries by `eventId`.

## Why contiguity matters

A contiguous sequence turns reliability into arithmetic that needs no coordination:

| Question                                     | Answer                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| Is this event a duplicate?                   | `sequence ≤ applied`                                       |
| Is something missing?                        | `sequence > applied + 1`                                   |
| Did the stream end quietly with events lost? | `pong.headSequence > applied`                              |
| Can this client be resumed?                  | `cursor.sequence ≥ oldestSequence − 1` and same `streamId` |
| Where does replay start?                     | `readAfter(cursor.sequence)`                               |

With gaps allowed in the numbering (for example per-producer sequences, or ids that are
only monotonic), the client could detect reordering but never loss.

## Alternatives considered

- **Order by event timestamp.** No coordination needed, and it survives multiple
  writers. But producer clocks skew, two events can share a millisecond, and a timestamp
  cannot reveal a missing event. Rejected as the ordering key.
- **Per-session sequences.** This is where the production design goes (see below). It
  was not chosen for the demo because the dashboard and sessions list consume _all_
  sessions: with per-session sequences the client would track a cursor per session
  (thousands), and "is anything missing?" would need a per-session head from the server.
  One global sequence gives one cursor and one comparison.
- **Hybrid logical clocks / vector clocks.** They solve ordering across several writers.
  There is one writer; the machinery would be unused.
- **At-least-once with idempotent reducers only** (no sequence, dedupe by `eventId`).
  Handles duplicates, not loss or order. The `eventId` dedupe is kept as a second line
  (a bounded LRU on the client, a bounded set at ingest) for the case where the same
  event is sequenced twice upstream.
- **Events over the WebSocket from producers.** One fewer protocol, but it couples
  producer backpressure and reconnects to the fan-out path.

## Consequences

- **The gateway is a single point of failure and a throughput ceiling.** This is the
  price of the decision, and it is accepted for a demo. A restart loses the replay
  history; clients recover by snapshot and say so in one toast.
- **Every client receives every event.** There are no subscriptions: a global sequence
  with holes filtered out per client would break the contiguity check. Subscriptions
  need per-partition sequences.
- **Replay depth is bounded** by the ring buffer, not by time.
- **The production path is a change of scope, not of idea.** With a partitioned durable
  log (Kafka, Redis Streams) partitioned by session or tenant: offsets are contiguous
  per partition, a cursor becomes `{ partition → offset }`, and the client runs one
  sequencer per subscribed partition. `streamId`, snapshot-with-position, the handshake
  and the dedupe rules carry over. [architecture.md](../architecture.md#scaling-what-this-demo-is-and-what-production-would-need)
  describes that path and says plainly that none of it is built.
