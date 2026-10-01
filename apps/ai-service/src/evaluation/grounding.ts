import {
  MAX_UNVERIFIED_CLAIMS,
  type AIContext,
  type GroundingClaimKind,
  type UnverifiedClaim,
} from "@pulsedesk/contracts";

/**
 * Rule-based grounding check: finds outcome claims in an answer ("they paid", "the card
 * was declined", "they haven't signed up") and verifies each against the session's
 * events. Deterministic, fast enough to run on every answer, and every verdict comes
 * with a reason a person can check.
 *
 * It's deliberately independent of the mock provider (no shared code), so the regression
 * suite isn't checking the mock against itself. What it can't catch: LIMITATIONS.md.
 *
 * Evidence is `form_submit` events only. Clicks, page views and opened forms are intent,
 * not outcomes: a click on "Upgrade to Pro" is not a purchase.
 */

export type ClaimPolarity = "asserted" | "negated";

export interface Claim {
  kind: GroundingClaimKind;
  /** "they paid" is asserted; "they haven't paid" is negated. */
  polarity: ClaimPolarity;
  /** The clause that makes the claim, from the original answer. */
  quote: string;
  /** form_submission: the form named ("checkout"), if any. */
  form: string | null;
  /** form_submission: the answer says it succeeded. error: the specific error named. */
  qualifier: "successfully" | "declined" | null;
}

export interface CheckedClaim extends Claim {
  supported: boolean;
  /** The evidence for the verdict, or what's missing. */
  reason: string;
}

export interface GroundingResult {
  claims: CheckedClaim[];
  /** Claims the session doesn't support, in answer order. */
  unverified: UnverifiedClaim[];
}

// ─── Extraction ─────────────────────────────────────────────────────────────────

const FORM_NAME = String.raw`(?:(?:the|a|an|their|your|this) )?(?:(?<form>[a-z][a-z ]{0,30}?) )?form`;

/**
 * Per kind: `pattern` finds claims in either polarity ("they paid", "they haven't paid").
 * `negatedOnly` finds base forms that only make a claim after a negation: "didn't pay",
 * "no purchase" (on their own, "pay" or "purchase" claim nothing).
 */
const PATTERNS: { kind: GroundingClaimKind; pattern: RegExp; negatedOnly: RegExp }[] = [
  {
    kind: "purchase",
    pattern: new RegExp(
      [
        String.raw`\bpurchased\b`,
        String.raw`\bbought\b`,
        // Not the adjective: "paid plans", "a paid tier".
        String.raw`\bpaid\b(?! (?:plans?|tiers?|versions?|features?|accounts?|subscriptions?|customers?|options?|products?|users?)\b)`,
        String.raw`\bmade (?:a|the|their) (?:purchase|payment)\b`,
        String.raw`\bcompleted (?:a |the |their )?(?:purchase|payment|checkout|order|upgrade)\b`,
        String.raw`\bpayment (?:went through|succeeded|was (?:successful|accepted|processed|completed))\b`,
        String.raw`\bupgraded\b`,
        String.raw`\bplaced (?:an|the|their) order\b`,
        String.raw`\bbecame a (?:paying )?customer\b`,
        String.raw`\bchecked out(?= *(?:$|[.,;!)]|successfully))`,
      ].join("|"),
      "gi",
    ),
    negatedOnly: /\b(?:pay|paid|payment|purchase|buy|upgrade)\b/gi,
  },
  {
    kind: "signup",
    pattern: new RegExp(
      [
        String.raw`\bsigned up\b`,
        String.raw`\bregistered\b`,
        String.raw`\bcreated (?:an|a|their) (?:\w+ )?account\b`,
        String.raw`\bstarted (?:a|the|their) (?:free )?trial\b`,
        String.raw`\b(?:completed|finished) (?:the |their )?(?:signup|sign-up|registration)\b`,
      ].join("|"),
      "gi",
    ),
    negatedOnly: /\b(?:sign up|sign-?up|register|registration|create an account)\b/gi,
  },
  {
    kind: "contact_request",
    pattern: new RegExp(
      [
        String.raw`\bcontacted (?:sales|the sales team|support|us|the team)\b`,
        String.raw`\breached out\b`,
        String.raw`\brequested (?:a |an )?(?:demo|call|callback|quote|meeting)\b`,
        String.raw`\b(?:sent|submitted) (?:a |an |the |their )?(?:contact request|enquiry|inquiry|sales (?:enquiry|inquiry|request)|message to sales)\b`,
        String.raw`\basked (?:to be contacted|for (?:a )?(?:demo|call|quote))\b`,
      ].join("|"),
      "gi",
    ),
    negatedOnly:
      /\b(?:contact (?:sales|us|the team)|reach out|request a (?:demo|call)|contact request)\b/gi,
  },
  {
    kind: "form_submission",
    pattern: new RegExp(
      [
        String.raw`\b(?<ok1>successfully )?(?:re-?)?submitted ${FORM_NAME}(?<ok2> successfully)?\b`,
        String.raw`\bthe (?:(?<form3>[a-z][a-z ]{0,30}?) )?form was submitted(?<ok3> successfully)?\b`,
      ].join("|"),
      "gi",
    ),
    negatedOnly: new RegExp(String.raw`\bsubmit ${FORM_NAME}\b`, "gi"),
  },
  {
    kind: "error",
    pattern:
      /\b(?:failed(?! to\b)|fails|failing|failures?|errors?|declined|rejected|invalid|(?:was|were)(?: not|n't|n’t) accepted|(?:was|were) refused)\b/gi,
    negatedOnly: /\bfail\b/gi,
  },
];

/** Words before a claim (in the same clause) that negate it. */
const NEGATION =
  /\b(?:not|never|no|none|nothing|without|neither|nor|yet to|rather than|instead of|failed to|unable to|cannot)\b|n['’]t\b/i;

/** A word right before a denied claim that narrows it: "no repeated errors", "no further payment". */
const NARROWED =
  /\b(?:repeated|multiple|several|further|more|other|new|additional|unusual|second)\s+$/i;

/** Words before a claim (in the same clause) that make it a possibility, not a statement. */
const HEDGE =
  /\b(?:may|might|could|would|should|perhaps|possibly|probably|likely|unlikely|if|whether|unless|seems?|appears?|tried to|trying to|tries to|attempt(?:s|ed|ing)? to|about to|ready to|wants? to|wanted to|plans? to|planning to|going to|consider(?:s|ed|ing)?|interested in|intends? to)\b/i;

/**
 * Visitor-supplied strings (quoted labels and titles) and URL paths aren't the answer's
 * own words: `Clicked "Upgrade to Pro"` doesn't claim an upgrade. They're blanked out
 * (same length, so positions still match the original) before claims are looked for.
 */
function maskForeignText(text: string): string {
  const blank = (match: string) => " ".repeat(match.length);
  return text
    .replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, blank)
    .replace(/(?<=^|[\s(])\/[\w\-/.]*/gm, blank);
}

/**
 * Sentence ends, clause separators and contrast words bound a negation's scope:
 * "they didn't pay; the card was declined" has two clauses. Commas don't, so a negated
 * list ("hasn't signed up, paid or contacted sales") stays negated, except before a
 * conjunction that starts a new statement (", and", ", then", ", so"). Times ("0:40") and
 * decimals ("1.5 s") don't end anything.
 */
const CLAUSE_BOUNDARY =
  /[!?\n;()•—–]|[.:](?!\d)|,\s*(?:and|then|so|which)\b|\b(?:but|however|although|though|whereas|while)\b/gi;

interface Clause {
  start: number;
  end: number;
  question: boolean;
}

function clauses(masked: string): Clause[] {
  const spans: Clause[] = [];
  let start = 0;
  for (const boundary of masked.matchAll(CLAUSE_BOUNDARY)) {
    spans.push({ start, end: boundary.index, question: boundary[0] === "?" });
    start = boundary.index + boundary[0].length;
  }
  spans.push({ start, end: masked.length, question: false });
  // Earlier clauses of a question belong to it ("Did they pay, and then leave?").
  for (let i = spans.length - 2; i >= 0; i--) {
    const [span, next] = [spans[i], spans[i + 1]];
    if (span && next?.question && !/[.!\n;:]/.test(masked.slice(span.end, next.start)))
      span.question = true;
  }
  return spans.filter((span) => masked.slice(span.start, span.end).trim() !== "");
}

/** Every outcome claim in the answer, with its polarity. Hedged and questioned ones are skipped. */
export function extractClaims(answer: string): Claim[] {
  const masked = maskForeignText(answer);
  const found: [at: number, claim: Claim][] = [];

  for (const clause of clauses(masked)) {
    if (clause.question) continue;
    const text = masked.slice(clause.start, clause.end);
    const inClause = new Set<string>();
    for (const { kind, pattern, negatedOnly } of PATTERNS) {
      const matches = [
        ...[...text.matchAll(pattern)].map((match) => ({ match, needsNegation: false })),
        ...[...text.matchAll(negatedOnly)].map((match) => ({ match, needsNegation: true })),
      ];
      for (const { match, needsNegation } of matches) {
        const before = text.slice(0, match.index);
        if (HEDGE.test(before)) continue;
        const negated = NEGATION.test(before);
        if (needsNegation && !negated) continue;
        // "No repeated errors" denies repetition, not errors: a count this can't check.
        if (negated && NARROWED.test(before)) continue;
        const groups = match.groups ?? {};
        const named = (groups.form ?? groups.form3)?.trim().toLowerCase();
        const form = named && !/^(?:the|a|an)$/.test(named) ? named : null;
        const qualifier =
          kind === "form_submission" && (groups.ok1 || groups.ok2 || groups.ok3)
            ? "successfully"
            : kind === "error" && /declined/i.test(match[0])
              ? "declined"
              : null;
        // One claim per kind, form, qualifier and polarity in a clause ("hasn't paid for
        // the plan" matches both pattern sets).
        const key = `${kind}|${form}|${qualifier}|${negated}`;
        if (inClause.has(key)) continue;
        inClause.add(key);
        found.push([
          clause.start + match.index,
          {
            kind,
            polarity: negated ? "negated" : "asserted",
            quote: answer.slice(clause.start, clause.end).trim().replace(/\s+/g, " "),
            form,
            qualifier,
          },
        ]);
      }
    }
  }
  return found.sort(([a], [b]) => a - b).map(([, claim]) => claim);
}

// ─── Verification ───────────────────────────────────────────────────────────────

type Submit = Extract<AIContext["events"][number], { kind: "form_submit" }>;

/** Which forms count as which outcome, by id ("checkout", "contact_sales", …). */
const OUTCOME_FORMS: Record<"purchase" | "signup" | "contact_request", RegExp> = {
  purchase: /checkout|payment|billing|purchase|order|subscribe/,
  signup: /sign_?up|register|trial|create_account/,
  contact_request: /contact|demo|sales|quote/,
};

const OUTCOME_NAMES: Record<keyof typeof OUTCOME_FORMS, string> = {
  purchase: "no checkout or payment form was submitted successfully",
  signup: "no signup form was submitted successfully",
  contact_request: "no contact form was submitted successfully",
};

const offset = (ms: number) => {
  const total = Math.floor(ms / 1_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
const formLabel = (formId: string) => formId.replaceAll("_", " ");
/**
 * Whether a form named in an answer is this form: "contact sales" names `contact_sales`,
 * and "payment form" names `checkout` (same kind of outcome).
 */
function sameForm(named: string, formId: string) {
  const label = formLabel(formId);
  if (label === named || label.startsWith(`${named} `)) return true;
  const id = named.replaceAll(" ", "_");
  return Object.values(OUTCOME_FORMS).some((forms) => forms.test(id) && forms.test(formId));
}

function describeSubmit(submit: Submit) {
  return submit.success
    ? `the ${formLabel(submit.formId)} form was submitted successfully at ${offset(submit.atMs)}`
    : `the ${formLabel(submit.formId)} form failed at ${offset(submit.atMs)} (${submit.errorCode ?? "error"})`;
}

/** The events that would prove a claim, in session order. */
function evidence(claim: Claim, submits: readonly Submit[]): Submit[] {
  switch (claim.kind) {
    case "purchase":
    case "signup":
    case "contact_request": {
      const forms = OUTCOME_FORMS[claim.kind];
      return submits.filter((submit) => submit.success && forms.test(submit.formId));
    }
    case "form_submission":
      return submits.filter(
        (submit) =>
          (claim.form === null || sameForm(claim.form, submit.formId)) &&
          (claim.qualifier !== "successfully" || submit.success),
      );
    case "error":
      return submits.filter(
        (submit) =>
          !submit.success &&
          (claim.qualifier !== "declined" || /declin/.test(submit.errorCode ?? "")),
      );
  }
}

function missing(claim: Claim): string {
  switch (claim.kind) {
    case "purchase":
    case "signup":
    case "contact_request":
      return OUTCOME_NAMES[claim.kind];
    case "form_submission": {
      const form = claim.form ? `the ${claim.form} form` : "any form";
      return claim.qualifier === "successfully"
        ? `${form} was never submitted successfully`
        : `${form} was never submitted`;
    }
    case "error":
      return claim.qualifier === "declined"
        ? "no submission was declined"
        : "no submission failed or returned an error";
  }
}

function verify(claim: Claim, context: AIContext): CheckedClaim {
  const submits = context.events.filter((event): event is Submit => event.kind === "form_submit");
  const found = evidence(claim, submits);
  if (claim.polarity === "asserted") {
    const first = found[0];
    if (first) return { ...claim, supported: true, reason: describeSubmit(first) };
    const unseen =
      context.omittedEvents > 0
        ? ` in the ${context.events.length} events available (${context.omittedEvents} earlier ones weren't sent)`
        : "";
    return { ...claim, supported: false, reason: `${missing(claim)}${unseen}` };
  }
  // A denial is contradicted by evidence. Without evidence it stands: "hasn't paid" is
  // the safe direction, and omitted events can't be checked either way.
  const contradiction = found.at(-1);
  return contradiction
    ? { ...claim, supported: false, reason: describeSubmit(contradiction) }
    : { ...claim, supported: true, reason: missing(claim) };
}

/** Extracts the answer's outcome claims and verifies each against the session. */
export function checkGrounding(answer: string, context: AIContext): GroundingResult {
  const claims = extractClaims(answer).map((claim) => verify(claim, context));
  const unverified: UnverifiedClaim[] = [];
  const seen = new Set<string>();
  for (const { supported, kind, quote, reason } of claims) {
    const key = `${kind}\u0000${quote}`;
    if (supported || seen.has(key)) continue;
    seen.add(key);
    unverified.push({ kind, quote: quote.slice(0, 300), reason: reason.slice(0, 300) });
  }
  return { claims, unverified: unverified.slice(0, MAX_UNVERIFIED_CLAIMS) };
}
