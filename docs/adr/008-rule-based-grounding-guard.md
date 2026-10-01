# ADR-008: A rule-based grounding guard, run in ai-service on every answer

- **Status:** Accepted
- **Date:** 2026-10-01 (decided in Phase 6)

## Context

The copilot summarises a visitor's session for an agent who may act on it: reply to the
visitor, escalate, or assume a sale happened. The failure that matters most is a
confident, wrong statement about an **outcome**: "they completed the payment" when the
visitor clicked "Upgrade" and left. A model produces that readily, because the click
looks like the start of a purchase.

The system prompt tells the model not to infer outcomes. A prompt is an instruction, not
a guarantee, so something has to check the answer. Three questions follow: what checks
it, where the check runs, and what happens when it finds something.

## Decision

1. **A deterministic, rule-based checker** (`apps/ai-service/src/evaluation/grounding.ts`).
   It finds outcome claims in the answer (purchase, signup, contact request, form
   submission, error), each asserted or denied, and verifies them against the session's
   `form_submit` events. Clicks, page views and opened forms are intent, never evidence.
   Every verdict carries a reason a person can check ("no checkout or payment form was
   submitted successfully").
2. **It runs in ai-service, on every complete answer, before the stream ends.** The
   verdict travels in the final NDJSON chunk: `done.unverified: [{kind, quote, reason}]`
   (default `[]`, so older clients still parse).
3. **Unverified claims are flagged, not removed.** The answer stays visible; the UI adds
   "Couldn't verify against this session's events:" with each quote and reason, and the
   screen-reader announcement says how many claims couldn't be verified.
4. **The same checker is the regression suite.** Nine fixtures × every quick action and
   question (59 cases) run against the mock provider in CI and fail on any unverified
   claim. `pnpm eval` runs the same cases against a real model, locally and opt-in.
5. **Its limits are written down** in
   [LIMITATIONS.md](../../apps/ai-service/src/evaluation/LIMITATIONS.md), next to the code.

## Alternatives considered

### An LLM judge

A second model grading the first catches paraphrase and claims outside any taxonomy,
which rules cannot. It was rejected as the guard because:

- it is nondeterministic, so CI would flake or need pass-rate thresholds;
- it costs a model call per answer, in production and in every CI run;
- it adds latency to the end of every stream;
- its verdicts need their own evaluation: the problem moves, it doesn't go away;
- a verdict without a checkable reason is hard for an agent to act on.

It remains a reasonable **second opinion in `pnpm eval`** for the cases rules don't
recognise, and nothing in the design prevents adding it there.

### Checking in the browser

The browser has the session and could run the same rules. Rejected for two reasons:
the checker needs the **exact context the model saw**, and the browser only has its own,
possibly newer, copy of the session; and it would have added to the initial bundle,
which was over budget at the time. In ai-service the checker costs the client nothing.

### Blocking or rewriting the answer

Removing a flagged sentence, or withholding the answer, makes a rule-based false
positive destructive: a correct statement would silently disappear. Flagging keeps the
human in the loop and makes a false positive cheap (a visible note the agent can
dismiss by reading the timeline next to it).

### Structured output instead of prose

Asking the model for `{ outcome: "none" | "purchase" | … }` would make the claim trivially
checkable. It also removes most of what a summary is for, and it does not cover the
free-form questions. Worth revisiting for a dedicated "outcome" field alongside prose.

### Relying on the prompt

The first evaluation run is the argument against: the _mock_, written by hand to be
grounded, echoed an unquoted visitor-controlled page title ("…questions about Payment
successful - thank you for your purchase") into a drafted reply.

## Consequences

- **High precision, limited recall.** A clean result means no _recognised_ outcome claim
  is unsupported. Claims outside the taxonomy (counts, durations, sentiment, product
  facts), paraphrase the patterns don't know, and hedged statements are not checked. An
  unrecognised claim is unchecked, not verified.
- **The check runs when the stream ends.** An invented sentence is on screen, unflagged,
  for as long as the rest of the answer takes. Failed and cancelled answers are not
  checked; they are already marked incomplete.
- **The evidence model is this product's.** Only `form_submit` events count, and forms
  map to outcomes by name. A real deployment would need its own evidence (a payment
  webhook, a CRM record).
- **It is testable end to end.** A dev fault ("Ungrounded") makes the model append a
  claim the session doesn't support, so the guard can be demonstrated and E2E-tested
  against the real services. Removing the mock's success guard fails four tests;
  removing the guard's wiring fails the HTTP test and the E2E test.
- **A real model has barely been measured.** Seven live answers, all clean. That shows
  the pipeline works; it says almost nothing about how often a real model would be
  flagged, or would escape the rules.
