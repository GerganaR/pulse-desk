# AI-assisted development workflow

PulseDesk is built with an AI coding assistant. This document describes the loop the
work goes through, who decides what at each step, and what that has caught, with
examples from this repository's history. The prompts for each step are in
[`prompts/`](../prompts/README.md).

The principle is the same one the copilot's grounding checks apply to model answers:
**AI output is checked, not trusted.** Code an assistant writes is a claim until a test,
a build or a real browser has confirmed it.

## The loop

```text
 requirement ──► AI plan ──► human review ──► AI implementation ──► tests
  (roadmap)     (decisions)   (approve/amend)   (small steps)        (mutation-checked)
                                                                        │
   human final review ◄── AI review ◄── full verification ◄─────────────┘
   (and the commit)       (the diff)    (cold CI run, E2E ×5, real browser)
```

| Step             | Who         | Output                                                  | Prompt                                                |
| ---------------- | ----------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Requirement      | Human       | A roadmap phase with "done when"                        | —                                                     |
| Plan             | AI          | Decisions with rejected alternatives, steps, risks      | [feature-planning.md](../prompts/feature-planning.md) |
| Plan review      | Human       | Approval, or changes to the plan                        | —                                                     |
| Implementation   | AI          | Small verified steps                                    | [implementation.md](../prompts/implementation.md)     |
| Tests            | AI          | Tests at the lowest useful level, each mutation-checked | [test-generation.md](../prompts/test-generation.md)   |
| Verification     | AI, then CI | Cold full run, E2E, `--repeat-each=5`, screenshots      | —                                                     |
| AI review        | AI          | Ranked findings on the diff                             | [code-review.md](../prompts/code-review.md)           |
| Final review     | Human       | The PR, using the template's AI-assistance section      | [PR template](../.github/pull_request_template.md)    |
| Commit and merge | Human       | —                                                       | —                                                     |

Refactors use [refactoring.md](../prompts/refactoring.md): characterisation tests first,
behaviour-preserving steps, the same assertions passing afterwards.

## Rules the assistant works under

These are standing instructions (in the prompts' shared context block), each there
because the alternative went wrong or nearly did:

- **The roadmap is the source of truth.** Every decision that changes the plan becomes
  a numbered item in [roadmap.md](roadmap.md) in the same change,
  so a later session can't silently undo an earlier decision.
- **Verify, then report, including failures.** A report says what ran, what it printed
  and what wasn't checked. A failing test isn't retried until green or given a longer
  timeout; it's diagnosed.
- **No green by weakening the bar.** The bundle budget was exceeded from Phase 2 to
  Phase 6. The warning stayed on and the limit was never raised; Phase 7 brought the
  bundle under it (474.7 KB → 337.8 KB in that phase) and CI enforces it now.
- **The human owns irreversible actions.** The assistant doesn't commit, push or delete.
  It stops only processes it started, found by the PID on their port, never with a
  pattern kill that would take down the developer's own `pnpm dev`.
- **A guard isn't done until a mutation proves its test.** Break the code on purpose,
  watch the test fail, restore it.

## Examples from this repository

### The hydration harness has a negative control

`apps/web/src/app/hydration.test.tsx` renders the app on the "server", hydrates it in
jsdom, and fails on any hydration mismatch. A harness like that can pass because it's
broken: if mismatches were never reported, every test would be green. So it includes a
test that server-renders `/sessions` and hydrates as `/dashboard`, and asserts the
mismatch _is_ detected ("negative control: proves the harness works"). The same idea as a mutation
check, built into the suite permanently. The clock-skew test next to it (the browser's
clock 7 s ahead of the server's) guards the failure mode that live data makes most
likely.

### The Zod CSP finding

The web app sends a strict, nonce-based Content-Security-Policy with no
`'unsafe-eval'`. Zod 4 JIT-compiles object parsers with `new Function`, and _probes_
whether eval is allowed when each schema is constructed. Under this CSP the probe fails
safely, but the browser still reports a CSP violation for every schema module. That
would flood a CSP report endpoint and hide real attacks.

The easy fixes were wrong: allowing `'unsafe-eval'` weakens the policy, and ignoring the
console error hides it. The fix is `packages/contracts/src/csp-safe.ts`, a side-effect
module imported first in browser entry points that switches Zod to jitless mode before
any schema is built. Node services keep the faster JIT path. The E2E fixture fails any
test that logs a console error, so if the CSP noise came back, every spec would fail.

### The wrong-port dev confusion

In development the web app has two servers: SSR on 3000, and the client asset server
(HMR) on 3001. Opening 3001 in a browser gave "Cannot GET /", which looks like a broken
app rather than the wrong port. Commit `2bcd815` made the asset server redirect page
requests to the SSR port, and made `pnpm dev` announce the SSR URL explicitly. The lesson went into the working
agreement: verification runs on spare ports (web 3200, gateway 4200, ai-service 4260), so
it never collides with, or gets confused with, a `pnpm dev` the developer already has
open.

### Repeat runs find real races

- **Phase 4:** running the reliability E2E five times found that "Retry now" during an
  in-flight connection attempt fell back to the full backoff delay. It was fixed and got a
  unit test ([roadmap](roadmap.md), Phase 4 outcome).
- **Phase 6:** a copilot E2E failed once in 70 runs. The product was right: the test
  picked a session the simulator had created a moment earlier, and the copilot correctly
  said it had no events yet. The test now picks a session with activity.
- **Phase 6:** a gateway integration test had failed once in Phase 5 and been logged as
  "unexplained". In Phase 6 it failed twice in a row under the full parallel run. The
  cause: going live sends a heartbeat at once, and `checkConnection()` is a no-op while
  one is in flight, so the test's check never happened. Adding 300 ms of inbound
  latency with the fault injector reproduced it every time; waiting for the first round
  trip fixed it; the latency stays in the test to pin the case.

### Screenshots find what tests don't

The Phase 5 browser check at 390 px found that an implicit grid column let the
quick-action row widen the whole page past the viewport, and that the dev Reliability
toggle covered the mobile composer. No test failed; both were fixed and the layout rule
(`grid-cols-1` is required) was written down. In Phase 6 the check at 360 px showed the
AI fault control would overflow once it had five options; it wraps now.

### The evaluation evaluated the mock, and itself

Phase 6's first regression run against the mock failed four cases, and both kinds of
failure were real:

- **A mock bug.** The drafted reply echoed an unquoted, visitor-controlled page title:
  "…any questions about Payment successful - thank you for your purchase." An agent
  could have sent that. The mock now quotes titles and doesn't use them on the pricing
  branch.
- **A checker false positive.** "No repeated errors" was read as "no errors" and flagged
  in sessions with exactly one error. Denials narrowed by "repeated", "further" etc. are
  now skipped, and [LIMITATIONS.md](../apps/ai-service/src/evaluation/LIMITATIONS.md)
  says so.

Then the "done when" mutation: removing the success guard from the mock's outcome line
makes it claim a purchase for a declined checkout, and four tests fail, including the
HTTP-level test of the runtime guard.

### The first live run failed 58 times out of 59, usefully

The OpenAI-compatible provider had only ever met a fake stream. Its first real run, on a
free Gemini key, sent the evaluation's 59 requests four at a time into a quota of five a
minute. One answer came back. The fixes were to the tooling, not the bar: one request at
a time for real providers, `--rpm` pacing, and retries that wait as long as the provider
asks (Gemini says so in the error text, which the provider now reads without ever
showing the rest of that text to a user). A later run lost seven cases to a dropped
connection, so those are retried too.

Two things from that hour are written down as not known rather than smoothed over: one
model returned an answer cut off at both ends and then became too overloaded to
investigate, and the full 59 cases still haven't been run against a real model.

### Two environment problems that looked like code problems

- `pnpm dev` died in a second with nothing but an exit code. Turbo's full-screen view
  hid the error; with `--ui=stream` it was `EMFILE`: the machine had run out of
  file-watcher instances. Ports, the install and the Node version had all been checked
  first, and were all fine. It's in the README now.
- The development console filled with Content-Security-Policy violations. They were
  real: the dev policy allowed the asset server only as a WebSocket origin, so source maps
  fetched over HTTP were blocked. One line, development only; the production policy was
  checked to be unchanged.

## What the assistant is not used for

- Deciding scope or trade-offs. It proposes, with alternatives; the roadmap records what
  a human chose.
- Judging its own output as the only check. Its review is one input to a human review,
  after the tests and the real-browser check.
- Anything that needs credentials or leaves the machine: running against a paid model API
  (`pnpm eval` with a key) is a human's call.
