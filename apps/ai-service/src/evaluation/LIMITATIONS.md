# Grounding checks: limitations

What the evaluation in this directory can and can't tell you. Read this before trusting a
green run, or a flag in the UI.

## What is checked

`grounding.ts` looks for **outcome claims** in an answer and checks each against the
session's `form_submit` events:

| Claim kind        | Example                               | Evidence that supports it                                    |
| ----------------- | ------------------------------------- | ------------------------------------------------------------ |
| `purchase`        | "they paid", "upgraded to Pro"        | a successful submit of a checkout/payment/billing form       |
| `signup`          | "signed up", "started a trial"        | a successful submit of a signup form                         |
| `contact_request` | "contacted sales", "asked for a demo" | a successful submit of a contact/sales/demo form             |
| `form_submission` | "submitted the checkout form"         | any submit of that form (a successful one if "successfully") |
| `error`           | "the card was declined"               | a failed submit (with a `declined` code for "declined")      |

Each claim is **asserted** or **negated**. A denial ("they haven't paid") is flagged only
when an event contradicts it. Clicks, page views and opened forms are never evidence of
an outcome: that's the rule the fixtures enforce ("Upgrade" click ≠ payment).

A clean result means **no recognised outcome claim is contradicted or unsupported**. It
does not mean the answer is correct.

## What rule-based checking can't catch

**Claims outside the taxonomy.** Counts ("viewed 7 pages" when it was 5), times, paths,
device, country, how long something took, intent or emotion ("frustrated", "about to
churn"), product facts ("Pro includes SSO"). None of these are checked. The system
prompt forbids inventing them; nothing verifies it.

**Paraphrase the patterns don't know.** "The order is in", "they're a Pro customer now",
"money changed hands" aren't recognised, so they're not checked. An unrecognised claim is
_unchecked_, not verified. Real-model reports (`pnpm eval`) are how new phrasings are
found; each one found should become a pattern and a test case.

**Scope heuristics.** Negation runs from the cue to the end of the clause. Clauses end at
sentence ends, `;`, `:`, brackets, dashes, contrast words ("but", "although") and
", and/then/so". So:

- "No errors, the payment went through" reads as a denied payment (no ", and").
- A denial that is narrowed ("no _repeated_ errors", "no _further_ payment") is skipped,
  because it's a statement about a count the checker doesn't track. The first
  evaluation run found this: the mock's "no repeated errors" was being flagged in
  sessions with exactly one error.
- Double negatives, irony and conditionals across sentences aren't understood.

**Hedges are skipped, not flagged.** "They probably paid" is a possibility, so it isn't
checked. A model that hedges every invention escapes the check, though a hedge is at
least visible to the reader.

**Coreference.** "They opened the signup form but haven't submitted it": "it" isn't
resolved, so the denial isn't checked against the signup form.

**Quoted text is ignored.** Quoted strings and URL paths are blanked before matching,
because they're visitor data (`Clicked "Upgrade to Pro"` is not an upgrade). A model that
puts its own claim in quotes escapes the check. A model that repeats a label _without_
quotes ("they clicked Complete purchase") may be flagged. That's usually right to flag:
it reads as a claim.

**The evidence model is this product's.** Only `form_submit` events count, and form ids
are matched to outcomes by name (`checkout`, `signup`, `contact_sales`, …). A real
deployment would need its own evidence (a payment-provider webhook, a CRM record) and its
own form mapping.

**Truncated context.** Past 200 events, older ones aren't sent to the model (the context
says how many). An asserted outcome that happened in the omitted part is flagged, and the
reason says evidence may be in events that weren't sent. Denials can't be checked against
omitted events either way, so they stand.

**Only complete answers are checked.** A failed or cancelled answer is shown as
incomplete and isn't checked. The check runs when the stream ends, so an invented
sentence is on screen, unflagged, for as long as the rest of the answer takes to stream.

## Provider nondeterminism

The mock is deterministic, so CI results are exact. Real models aren't: the OpenAI
provider uses temperature 0.2, and providers change models behind the same name. For a
real provider:

- one clean run proves little; use `pnpm eval --repeat 5` and read pass _rates_;
- a report is a snapshot of one model on one date (both are in the report);
- the real-provider run is local and opt-in (it needs a key and costs money), not a CI
  gate.

## Fixture coverage

Nine fixtures (`fixtures.ts`), shaped like the simulator's journeys: the hesitant buyer
from the brief, declined and recovered checkouts, successful and abandoned signups, an
enterprise contact, a docs reader, adversarial visitor strings, and a truncated history.
Every fixture is asked every quick action plus one or two questions (59 cases).

Not covered: languages other than English, several outcomes of the same kind in one
session, very long sessions within the 200-event window, answers that quote the agent's
question back, and anything from real traffic. `summaryMentions` is a weak completeness
check (a few expected phrases per summary). Helpfulness, tone and the safety of drafted
replies (for example promising a discount) aren't measured.

## Why not an LLM judge

A second model grading the first is nondeterministic, costs money per CI run, and its
verdicts need their own evaluation. Rules are deterministic, free, run on every answer in
production, and every verdict comes with a reason a person can check. The price is the
recall limits above. An LLM judge could be added to `pnpm eval` later, as a second
opinion on the cases the rules don't recognise, without replacing them.
