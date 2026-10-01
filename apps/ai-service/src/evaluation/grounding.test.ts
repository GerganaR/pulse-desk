import { GROUNDING_CLAIM_KINDS, type GroundingClaimKind } from "@pulsedesk/contracts";
import { describe, expect, it } from "vitest";
import { EVAL_FIXTURES, type EvalFixture } from "./fixtures.ts";
import { checkGrounding, extractClaims } from "./grounding.ts";

const fixture = (id: string): EvalFixture => {
  const found = EVAL_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`No fixture ${id}`);
  return found;
};

/** One plain statement of each outcome, and its denial. */
const CANONICAL: Record<GroundingClaimKind, { asserted: string; negated: string }> = {
  purchase: {
    asserted: "The visitor completed the payment.",
    negated: "The visitor didn't pay.",
  },
  signup: { asserted: "The visitor signed up.", negated: "The visitor hasn't signed up." },
  form_submission: {
    asserted: "The visitor submitted a form.",
    negated: "The visitor did not submit a form.",
  },
  error: { asserted: "The visitor ran into an error.", negated: "There were no errors." },
  contact_request: {
    asserted: "The visitor contacted sales.",
    negated: "The visitor never contacted sales.",
  },
};

describe("grounding checker agrees with each fixture's ground truth", () => {
  const cases = EVAL_FIXTURES.flatMap((f) =>
    GROUNDING_CLAIM_KINDS.map((kind) => [f.id, kind] as const),
  );

  it.each(cases)("%s: %s", (id, kind) => {
    const { context, supports } = fixture(id);
    const truth = supports.includes(kind);

    const asserted = checkGrounding(CANONICAL[kind].asserted, context).claims;
    expect(asserted.map((c) => [c.kind, c.polarity])).toEqual([[kind, "asserted"]]);
    expect(asserted[0]?.supported, asserted[0]?.reason).toBe(truth);

    const negated = checkGrounding(CANONICAL[kind].negated, context).claims;
    expect(negated.map((c) => [c.kind, c.polarity])).toEqual([[kind, "negated"]]);
    expect(negated[0]?.supported, negated[0]?.reason).toBe(!truth);
  });
});

describe("claim extraction", () => {
  const kinds = (answer: string) => extractClaims(answer).map((c) => `${c.polarity} ${c.kind}`);

  it("reads the brief's trap correctly: a click on Upgrade is not a claim of an upgrade", () => {
    expect(kinds('Clicked "Upgrade to Pro" on /pricing.')).toEqual([]);
    expect(kinds("The visitor upgraded to Pro.")).toEqual(["asserted purchase"]);
    expect(kinds("They clicked “Complete purchase” three times.")).toEqual([]);
  });

  it("ignores paths and quoted visitor strings", () => {
    expect(kinds("They viewed /checkout and /signup.")).toEqual([]);
    expect(kinds('The page title was "Payment successful - thank you for your purchase".')).toEqual(
      [],
    );
  });

  it.each([
    ["The visitor paid for the Pro plan.", ["asserted purchase"]],
    ["They have paid.", ["asserted purchase"]],
    ["The payment went through at 0:57.", ["asserted purchase"]],
    ["They checked out successfully.", ["asserted purchase"]],
    ["They checked out the docs.", []],
    ["They're interested in paid plans.", []],
    ["They looked at a paid tier.", []],
    ["They didn't complete the purchase.", ["negated purchase"]],
    [
      "Outcome: no purchase, signup or contact request is recorded.",
      ["negated purchase", "negated signup", "negated contact_request"],
    ],
    [
      "The visitor hasn't signed up, paid or contacted sales yet.",
      ["negated signup", "negated purchase", "negated contact_request"],
    ],
    ["They started a free trial.", ["asserted signup"]],
    ["They requested a demo.", ["asserted contact_request"]],
    ["They sent a contact request at 3:34.", ["asserted contact_request"]],
    ["The card was declined.", ["asserted error"]],
    ["The email address wasn't accepted.", ["asserted error"]],
    ["No errors, and the payment went through.", ["negated error", "asserted purchase"]],
    [
      "They submitted the checkout form twice, but the card was declined both times.",
      ["asserted form_submission", "asserted error"],
    ],
  ])("%s", (answer, expected) => {
    expect(kinds(answer)).toEqual(expected);
  });

  it("doesn't read a narrowed denial as a denial: one error isn't repeated errors", () => {
    expect(kinds("No repeated clicks, repeated errors or back-and-forth navigation.")).toEqual([]);
    expect(kinds("There were no further errors.")).toEqual([]);
    expect(kinds("There were no errors.")).toEqual(["negated error"]);
  });

  it("skips hedged statements and questions", () => {
    expect(kinds("They might have paid for the plan.")).toEqual([]);
    expect(kinds("They tried to submit the checkout form.")).toEqual([]);
    expect(kinds("It looks like they are about to upgrade.")).toEqual([]);
    expect(kinds("Did they pay, or did they leave?")).toEqual([]);
    expect(kinds("Did they pay? They signed up.")).toEqual(["asserted signup"]);
  });

  it("notes the form named and whether the answer says it succeeded", () => {
    const [claim] = extractClaims("They submitted the contact sales form successfully.");
    expect(claim).toMatchObject({
      kind: "form_submission",
      form: "contact sales",
      qualifier: "successfully",
    });
    expect(extractClaims("The checkout form was submitted.")[0]).toMatchObject({
      form: "checkout",
      qualifier: null,
    });
  });

  it("keeps times and decimals inside the quote", () => {
    expect(
      extractClaims("Outcome: they completed a purchase at 0:40 after 1.5 min.")[0]?.quote,
    ).toBe("they completed a purchase at 0:40 after 1.5 min");
  });

  it("quotes the clause from the original answer, visitor strings included", () => {
    const [claim] = extractClaims('Clicked "Pay now" at 0:12. Then they paid for the plan.');
    expect(claim?.quote).toBe("Then they paid for the plan");
  });
});

describe("verification", () => {
  it("flags an invented payment with the reason", () => {
    const { unverified } = checkGrounding(
      "The visitor tried twice. They completed the payment.",
      fixture("checkout-declined").context,
    );
    expect(unverified).toEqual([
      {
        kind: "purchase",
        quote: "They completed the payment",
        reason: "no checkout or payment form was submitted successfully",
      },
    ]);
  });

  it("flags a denial the events contradict, citing the evidence", () => {
    const { unverified } = checkGrounding(
      "They haven't paid.",
      fixture("checkout-recovered").context,
    );
    expect(unverified).toEqual([
      {
        kind: "purchase",
        quote: "They haven't paid",
        reason: "the checkout form was submitted successfully at 0:57",
      },
    ]);
  });

  it("cites the evidence for a supported claim", () => {
    const [claim] = checkGrounding(
      "The card was declined.",
      fixture("checkout-declined").context,
    ).claims;
    expect(claim).toMatchObject({
      supported: true,
      reason: "the checkout form failed at 0:40 (card_declined)",
    });
  });

  it("matches the named form, and requires success only when the answer claims it", () => {
    const { context } = fixture("checkout-declined");
    const verdict = (answer: string) => checkGrounding(answer, context).claims[0]?.supported;
    expect(verdict("They submitted the checkout form.")).toBe(true);
    expect(verdict("They submitted the payment form.")).toBe(true); // same kind of form
    expect(verdict("They submitted the checkout form successfully.")).toBe(false);
    expect(verdict("They submitted the newsletter form.")).toBe(false);
    expect(verdict("The card was declined.")).toBe(true);
    expect(verdict("The email address was invalid.")).toBe(true); // an error, not the error
  });

  it("says when evidence may be in events that weren't sent", () => {
    const [claim] = checkGrounding("They paid.", fixture("truncated-history").context).unverified;
    expect(claim?.reason).toBe(
      "no checkout or payment form was submitted successfully in the 4 events available (150 earlier ones weren't sent)",
    );
  });

  it("reports each unverified claim once", () => {
    const { unverified } = checkGrounding(
      "They completed the payment. They completed the payment.",
      fixture("hesitant-buyer").context,
    );
    expect(unverified).toHaveLength(1);
  });

  it("finds nothing to check in an answer without outcome claims", () => {
    expect(
      checkGrounding(
        "A desktop visitor from DE viewed /pricing twice.",
        fixture("hesitant-buyer").context,
      ),
    ).toEqual({ claims: [], unverified: [] });
  });
});
