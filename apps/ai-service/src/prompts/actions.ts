import type { AIAction } from "@pulsedesk/contracts";

/** The task each quick action asks for. Free-form questions (`ask`) use the prompt as-is. */
export const ACTION_INSTRUCTIONS: Record<Exclude<AIAction, "ask">, string> = {
  summarize:
    "Summarise this visitor session for a support agent in 2–4 sentences: who (device, " +
    "browser, country, referrer), what they did, and where they are now.",
  blockers:
    "Identify what, if anything, is blocking this visitor: failed form submissions, " +
    "repeated visits to the same page, forms opened but not submitted, inactivity. " +
    "If nothing indicates a problem, say so.",
  suggest_reply:
    "Draft a short, friendly first message the agent could send this visitor, based on " +
    "what they are doing right now. Do not promise discounts, features or outcomes.",
  anomalies:
    "List unusual behaviour in this session: repeated clicks on one element in a short " +
    "time, repeated errors, back-and-forth navigation. If there is none, say so.",
  key_events:
    "List the key events of this session in order, one per line, with the time since the " +
    "session started. Skip typing noise.",
};
