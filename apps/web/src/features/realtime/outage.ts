/**
 * How long the connection must be down before the UI escalates beyond the status pill:
 * the banner appears, and recovery is announced with a toast. Shorter blips (a deploy, a
 * network switch) recover on their own and would only be noise.
 */
export const PROLONGED_OUTAGE_MS = 10_000;
