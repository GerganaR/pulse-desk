import type { Rng, SitePath } from "@pulsedesk/test-utils";

/**
 * A journey is a scripted intent with variation. Steps are abstract; the simulation
 * turns them into protocol events with realistic timing.
 */
export type Step =
  | { kind: "view"; path: SitePath }
  | { kind: "click"; element: string; label: string }
  | {
      kind: "form";
      formId: string;
      fields: readonly string[];
      failureRate: number;
      errorCode: string;
    }
  /** Visitor goes quiet long enough for the gateway to mark the session idle. */
  | { kind: "pause" }
  | { kind: "leave"; reason: "tab_closed" | "navigated_away" }
  /** Stops sending entirely; the gateway closes the session after its inactivity timeout. */
  | { kind: "abandon" };

type JourneyBuilder = (rng: Rng) => Step[];

const maybe = (rng: Rng, probability: number, steps: Step[]): Step[] =>
  rng.chance(probability) ? steps : [];
const end = (rng: Rng): Step[] =>
  rng.chance(0.2)
    ? [{ kind: "abandon" }]
    : [{ kind: "leave", reason: rng.chance(0.7) ? "tab_closed" : "navigated_away" }];

export const JOURNEYS: Record<string, { weight: number; build: JourneyBuilder }> = {
  evaluator: {
    weight: 0.28,
    build: (rng) => [
      { kind: "view", path: "/" },
      { kind: "view", path: "/features" },
      ...maybe(rng, 0.5, [{ kind: "view", path: "/integrations" }]),
      { kind: "view", path: "/pricing" },
      { kind: "click", element: "cta_start_trial", label: "Start free trial" },
      { kind: "view", path: "/signup" },
      {
        kind: "form",
        formId: "signup",
        fields: ["email", "company"],
        failureRate: 0.25,
        errorCode: "email_invalid",
      },
      ...maybe(rng, 0.6, [{ kind: "view", path: "/docs/getting-started" }]),
      ...end(rng),
    ],
  },
  enterpriseBuyer: {
    weight: 0.16,
    build: (rng) => [
      { kind: "view", path: "/pricing" },
      { kind: "view", path: "/pricing/enterprise" },
      { kind: "view", path: "/customers" },
      ...maybe(rng, 0.4, [{ kind: "pause" }]),
      { kind: "view", path: "/pricing/enterprise" },
      { kind: "click", element: "cta_contact_sales", label: "Contact sales" },
      { kind: "view", path: "/contact-sales" },
      {
        kind: "form",
        formId: "contact_sales",
        fields: ["name", "work_email", "company", "team_size", "message"],
        failureRate: 0.15,
        errorCode: "work_email_required",
      },
      ...end(rng),
    ],
  },
  upgrader: {
    weight: 0.16,
    build: (rng) => [
      { kind: "view", path: "/pricing" },
      { kind: "click", element: "cta_upgrade_pro", label: "Upgrade to Pro" },
      { kind: "view", path: "/checkout" },
      {
        kind: "form",
        formId: "checkout",
        fields: ["card_name", "card_number", "billing_country"],
        failureRate: 0.35,
        errorCode: "card_declined",
      },
      ...maybe(rng, 0.5, [
        {
          kind: "form",
          formId: "checkout",
          fields: ["card_number"],
          failureRate: 0.2,
          errorCode: "card_declined",
        },
      ]),
      ...end(rng),
    ],
  },
  /** The AI-evaluation fixture from the brief: strong buying signals, no purchase. */
  hesitantBuyer: {
    weight: 0.14,
    build: (rng) => [
      { kind: "view", path: "/pricing" },
      { kind: "view", path: "/pricing/enterprise" },
      { kind: "view", path: "/pricing" },
      { kind: "click", element: "cta_upgrade_pro", label: "Upgrade to Pro" },
      { kind: "pause" },
      ...end(rng),
    ],
  },
  docsReader: {
    weight: 0.16,
    build: (rng) => [
      { kind: "view", path: "/docs/getting-started" },
      { kind: "view", path: "/blog/realtime-dashboards" },
      ...maybe(rng, 0.6, [{ kind: "view", path: "/integrations" }]),
      ...maybe(rng, 0.5, [{ kind: "pause" }]),
      ...end(rng),
    ],
  },
  bouncer: { weight: 0.1, build: () => bounce() },
};

function bounce(): Step[] {
  return [
    { kind: "view", path: "/" },
    { kind: "leave", reason: "navigated_away" },
  ];
}

export function pickJourney(rng: Rng): { name: string; steps: Step[] } {
  let roll = rng.next();
  for (const [name, journey] of Object.entries(JOURNEYS)) {
    roll -= journey.weight;
    if (roll <= 0) return { name, steps: journey.build(rng) };
  }
  return { name: "bouncer", steps: bounce() }; // only reachable through float rounding
}
