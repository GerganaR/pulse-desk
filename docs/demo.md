# Demo script

A 20-step walkthrough of PulseDesk for an interview: the exact clicks, and what to say
at each one. It takes 12–15 minutes at a talking pace, or 6–7 if you only say the first
sentence of each step.

The order is deliberate: the product first (steps 1–6), then the two things that are
hard to do well, realtime reliability (7–12) and the AI copilot (13–17), then the
evidence (18–20).

## Before you start

```bash
nvm use && corepack enable && pnpm install
pnpm dev          # web :3000, gateway :4000, ai-service :4100, simulator
```

- Use `pnpm dev`, not `pnpm start`: the **Reliability** panel exists only in development
  and devtools builds.
- Open <http://localhost:3000> in a window about 1440 px wide (the session page is three
  columns from 1280 px). Wait for the pill in the top bar to read **Live**.
- Have a terminal visible for step 12, and the repository open in an editor for step 20.
- If `pnpm dev` exits within a second on Linux, it is the file-watcher limit, not the
  code: see [the README](../README.md#running-locally).
- The copilot uses the deterministic mock by default. That is the right choice for a
  demo: no quota, no network, the same answer every time. Mention that a real model is
  one environment variable away (step 17).

## Part 1: the product

### 1. Dashboard

**Do:** Land on `/dashboard`. Point at the tiles and the "Where visitors are now" card,
and wait a few seconds until a number changes.

**Say:** "This is a console for watching live visitor sessions. Everything on this page
is live: a simulator is posting visitor events to a gateway, and they reach this tab
over a WebSocket. Nothing here is polling."

### 2. It was rendered on the server

**Do:** View source (`Ctrl+U`), scroll to show real session data in the HTML, then close
it. Reload the page once and note there is no flash of empty content.

**Say:** "The first paint is server-rendered HTML with the data in it, streamed with
React 19's `renderToPipeableStream`. I built the SSR pipeline by hand instead of using
Next.js, because owning that boundary was the point: the server waits at most 250 ms for
data, and if the backend is slower it sends skeletons instead of making you wait."

### 3. Chart or table

**Do:** On the "Visitor activity" card, click **Table**, then **Chart**.

**Say:** "A small thing that shows a boundary: this toggle is component state, not Redux.
My rule is: if another route or the network cares, it's Redux; if only this component
cares, it's local; if it belongs in a link, it's the URL."

### 4. Sessions list

**Do:** Click **Sessions** in the sidebar. Click the **Active** filter, type `checkout`
in the search box, then copy the URL to show `?status=active&q=checkout`. Clear the search.

**Say:** "Filters live in the URL, so they survive a reload, work with the back button
and render correctly on the server. The table is virtualised: with 2,000 sessions the
old build took 19 seconds to go live and this one takes under one."

### 5. Theme without a flash

**Do:** Open the user menu (top right, **Jordan Lee**), choose **Dark**, then reload.

**Say:** "The theme is in a cookie, not localStorage, so the server renders the right
theme. No flash on load."

### 6. Open a session

**Do:** Click a row whose status is **Active** and whose page is `/checkout` or
`/contact-sales` (they have the richest timelines). Point at the three columns: details,
live activity, copilot. Wait for a new event to fade in.

**Say:** "This is one visitor's session. The timeline is live, and it says 'You started
viewing': presence travels over the same socket, which is one of the reasons this is a
WebSocket and not server-sent events."

## Part 2: realtime reliability

### 7. Open the reliability panel

**Do:** Click **Reliability** (bottom left). Point at the diagnostics: status, round
trip, cursor.

**Say:** "This panel only exists in development builds, and CI proves it: the production
bundle is checked for its marker, including in source maps. It injects faults by
wrapping the WebSocket transport, so the client can't tell them from a real network.
The cursor is the important number: every event has a sequence from one contiguous
stream, and the cursor is how far this tab has applied."

### 8. Disconnect

**Do:** Click **Disconnect**. Point at the pill: **Reconnecting · retry in Ns**. Wait
through one or two retries so the countdown grows.

**Say:** "The socket is cut and every reconnect attempt fails. The UI response is one
pill. No toast, no modal: short drops are routine, so they shouldn't nag. The retries
back off exponentially with jitter, so a thousand clients of a restarted gateway don't
reconnect in lock-step."

### 9. Reconnect and replay

**Do:** Wait until the visitor has done something (or about 10 seconds), then click
**Reconnect**. Point at the timeline: the missed events appear in order with a tint and
a small history marker.

**Say:** "On reconnect the client sends its cursor and the gateway replays exactly what
was missed. Each event is applied once and in order, and replayed ones are marked so
you can see what you missed. This flow is the flagship end-to-end test: it compares the
sequence numbers in the DOM with the gateway's own record."

### 10. A long outage

**Do:** Click **Disconnect** again and wait a little over 10 seconds for the banner
("Live updates paused"). Click **Retry now** in the banner (it fails: still cut), then
**Reconnect** in the panel. Point at the single toast: "Live updates restored".

**Say:** "Only after ten seconds does the UI get louder: a non-modal banner with a
manual retry. On recovery there is exactly one toast, and it says how many events were
caught up. The principle is that the pill always tells the truth and anything louder
has to be earned."

### 11. Lost, duplicated and reordered events

**Do:** In the panel: set **Drop events** to `3` and click **Drop**; click **Duplicate**;
click **Reorder**. Watch "Gaps / resyncs", "Duplicates dropped" and "Reorder buffer" in
the diagnostics as activity arrives. The timeline stays correct throughout.

**Say:** "These are the faults a reconnect doesn't cover. A dropped frame leaves a gap
in the sequence; the client holds later events for two seconds in case it's just
reordering, then resyncs on the same socket. Duplicates are dropped by sequence and by
event id. All of that is one pure class with exhaustive unit tests."

### 12. Latency, and a real outage

**Do:** In **Latency**, choose **1.5 s**: the pill turns **Degraded**. Choose **Off** and
close the panel. Then go to **Dashboard** and, in the terminal, restart only the gateway:

```bash
touch apps/realtime-gateway/src/main.ts   # the gateway runs under node --watch
```

The pill shows **Reconnecting**, then **Live**, with one toast: "The gateway restarted,
so sessions were reloaded from a fresh snapshot." Go back to **Sessions** and open an
active session again for Part 3.

**Say:** "Degraded is a health flag from an application-level heartbeat, separate from
connected or not. And this last one is real, not injected: the gateway keeps its log in
memory, so a restart is a new stream. The client notices the stream id changed and takes
a fresh snapshot instead of silently resuming with a gap. That's also the honest limit
of this demo, and the architecture doc says what production would need."

Do the restart from the dashboard, not a session page: the old stream's sessions are
gone, so an open session page correctly ends at "Session not found" until the simulator
has created new ones. If you would rather not touch the terminal mid-demo, skip the
restart and say it.

## Part 3: the AI copilot

### 13. Ask for a summary

**Do:** On a session page, in the copilot column, click **Summarise**. Watch the answer
stream in.

**Say:** "The copilot answers questions about this session. The answer streams as
newline-delimited JSON over a plain `fetch`, separately from the WebSocket, so neither
can take the other down. The browser only sends the session's id: the server builds
what the model sees from an allowlist, with no ids, names, city or timestamps."

### 14. Several at once, and cancel

**Do:** Click **What's blocking?** and immediately **Suggest reply**, so two answers
stream at once. Click **Cancel** on one of them mid-stream.

**Say:** "Requests are independent. Cancel is an `AbortController`, and it propagates all
the way: browser, web server, AI service, provider. The partial answer is kept. There's
an end-to-end test that checks the AI service recorded the stream as aborted."

### 15. Failure and retry

**Do:** Open **Reliability**, under **AI copilot** choose **Error 500**, and click **Key
events**: the turn fails with **Retry**. Set the fault to **Off** and click **Retry**.
Point at the pill: it stayed **Live** the whole time.

**Say:** "Failures are explained and retryable, and they don't touch the live feed. The
same control can make the model time out or stream slowly. These faults are enacted by
the real services, behind two gates, so the error paths you see are the real ones."

### 16. The grounding guard

**Do:** Under **AI copilot** choose **Ungrounded**, close the panel and click
**Summarise**. Point at the amber note under the answer: "Couldn't verify against this
session's events" with the quote and the reason. Set the fault back to **Off**.

**Say:** "This is the part I'd most like to talk about. A model will happily turn a
click on 'Upgrade' into 'they paid'. Every answer is checked on the server against the
exact context the model saw: a claim of a purchase, signup or error has to match a form
submission event. Here I've made the model invent a payment, and the guard flags it
with a reason. It flags instead of deleting, because the checker is rule-based and a
false positive shouldn't silently remove a true sentence."

### 17. What the guard can't do

**Do:** Open `apps/ai-service/src/evaluation/LIMITATIONS.md` in the editor (or just say it).

**Say:** "It's deterministic and explainable, and its recall is limited: it checks
outcome claims, not counts or sentiment, and it misses paraphrase it doesn't know. That
is written down next to the code. The same checker runs nine fixture sessions through
every quick action in CI, and `pnpm eval` runs them against a real model. I've only run
seven answers against a real model, on a free tier, and I say so rather than claim more."

## Part 4: the evidence

### 18. Metrics

**Do:** Open **Reliability** and switch to the **Metrics** tab. Point at Web Vitals,
reconnect counts, batch sizes and AI timings.

**Say:** "Everything I've shown emits metrics through one small typed API with pluggable
sinks. In development the sink is this view; in production it would be whatever the
platform uses."

### 19. Mobile

**Do:** Open DevTools device mode at 390 px (or narrow the window below 1280 px). The
three columns become **Details / Activity / Copilot** tabs. Start an answer, switch to
**Activity** and back.

**Say:** "Below 1280 px the columns become tabs, and every panel stays mounted, so
switching tabs never interrupts a stream."

### 20. The repository

**Do:** In the editor, show the tree (`apps/`, `packages/`), then open
`docs/roadmap.md` and scroll through the numbered decisions, then
`docs/ai-development-workflow.md`.

**Say:** "It's a pnpm and Turborepo monorepo: four apps, shared contracts validated at
every boundary, a framework-agnostic Redux layer. It was built in phases with an AI
assistant, under a loop where the assistant's output is checked like the copilot's
answers are: plans reviewed, tests mutation-checked, every plan change recorded as a
numbered decision. The docs also record what isn't done, which I think is the more
useful half."

## If something goes wrong

| Symptom                                  | What to do                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pill stuck on **Connecting**             | The gateway isn't running. Check the `pnpm dev` terminal; the web server logs `gateway.unreachable`  |
| The session you opened goes **Ended**    | Simulated visitors finish their journeys. Go back to **Sessions**, filter **Active**, open another   |
| Nothing to replay in step 9              | The visitor was quiet. Wait for the events counter in the details column to tick before reconnecting |
| Copilot says the service is unreachable  | ai-service isn't running (it is part of `pnpm dev`). The rest of the app is unaffected: say so       |
| A fault is still on from an earlier step | Reliability → set **Latency** and **AI copilot** to **Off**, click **Reconnect**                     |
| No **Reliability** button                | You are on a production build (`pnpm start`). Use `pnpm dev`                                         |

A failure during the demo is not a disaster here: the app is built to explain its own
failures, and showing that calmly is the demo.

## Questions this tends to raise

- **"Why not Next.js?"** [ADR-003](adr/003-ssr-architecture.md): the goal was to own
  and explain the SSR and hydration boundary; it's not a general recommendation.
- **"Why WebSocket and not SSE?"** [ADR-001](adr/001-websocket-vs-sse.md): presence,
  resync-on-the-same-stream and heartbeats need a client → server channel.
- **"Why Redux?"** [ADR-002](adr/002-redux-state-boundaries.md): a merged, deduplicated,
  ordered stream wants deterministic reducers and one serialisable snapshot for SSR.
- **"How would this scale?"** [architecture.md](architecture.md#scaling-what-this-demo-is-and-what-production-would-need):
  one gateway and an in-memory log today; partitioned durable log, stateless gateways
  and per-partition cursors in production. None of that is built, and the doc says so.
- **"How do you know the AI is right?"** You don't; you check what you can and say what
  you can't. [ADR-008](adr/008-rule-based-grounding-guard.md).
- **"How much of this did the AI write?"** Most of the code, under the loop in
  [ai-development-workflow.md](ai-development-workflow.md). The decisions, the reviews
  and the commits are human.
