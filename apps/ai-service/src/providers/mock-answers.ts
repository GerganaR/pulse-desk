import type { AIAction, AIContext, AIContextEvent } from "@pulsedesk/contracts";

/**
 * Deterministic answers composed only from facts in the context. The mock never says
 * anything an event doesn't show, which is what Phase 6's grounding checks will hold it
 * (and real providers) to.
 */
export function composeAnswer(action: AIAction, context: AIContext, prompt = ""): string {
  switch (action) {
    case "summarize":
      return withCoverage(summarize(context), context);
    case "blockers":
      return withCoverage(blockers(context), context);
    case "suggest_reply":
      return suggestReply(context);
    case "anomalies":
      return withCoverage(anomalies(context), context);
    case "key_events":
      return withCoverage(keyEvents(context), context);
    case "ask":
      return answerQuestion(prompt, context);
  }
}

type Of<K extends AIContextEvent["kind"]> = Extract<AIContextEvent, { kind: K }>;
const ofKind = <K extends AIContextEvent["kind"]>(context: AIContext, kind: K) =>
  context.events.filter((event): event is Of<K> => event.kind === kind);

export function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const formName = (formId: string) => formId.replaceAll("_", " ");

const FRIENDLY_ERRORS: Record<string, string> = {
  card_declined: "the card was declined",
  email_invalid: "the email address wasn't accepted",
  work_email_required: "the form asked for a work email address",
};
const friendlyError = (code: string | null) =>
  (code && FRIENDLY_ERRORS[code]) ?? `the form returned an error${code ? ` (${code})` : ""}`;

function withCoverage(answer: string, context: AIContext) {
  return context.omittedEvents > 0
    ? `${answer}\n\n(Based on the most recent ${plural(context.events.length, "event")}; ${context.omittedEvents} earlier ${context.omittedEvents === 1 ? "one isn't" : "ones aren't"} included.)`
    : answer;
}

/** Per form: submissions in order, and whether the last one failed. */
function formOutcomes(context: AIContext) {
  const forms = new Map<string, { submits: Of<"form_submit">[]; last: Of<"form_submit"> }>();
  for (const submit of ofKind(context, "form_submit")) {
    const form = forms.get(submit.formId);
    if (form) {
      form.submits.push(submit);
      form.last = submit;
    } else forms.set(submit.formId, { submits: [submit], last: submit });
  }
  return [...forms].map(([formId, { submits, last }]) => {
    const failures = submits.filter((s) => !s.success);
    return { formId, submits, failures, last, stillFailing: !last.success };
  });
}

function summarize(context: AIContext): string {
  const { session } = context;
  const origin = session.referrer ? `from ${session.referrer}` : "directly";
  const where =
    session.status === "closed"
      ? `The session has ended; the last page was ${session.currentPath}.`
      : `They are now on ${session.currentPath}${session.status === "idle" ? ", currently idle" : ""}.`;
  const lines = [
    `A ${session.device} visitor (${session.browser} on ${session.os}, ${session.country}) who arrived ${origin} on ${session.landingPath}. ` +
      `Over ${formatDuration(session.durationMs)} they viewed ${plural(session.pageViews, "page")}. ${where}`,
  ];

  const forms = formOutcomes(context).map(({ formId, submits, failures, last }) => {
    if (failures.length === 0) return `submitted the ${formName(formId)} form successfully`;
    if (last.success)
      return `submitted the ${formName(formId)} form successfully after ${plural(failures.length, "failed attempt")}`;
    return `tried to submit the ${formName(formId)} form ${submits.length === 1 ? "once" : `${submits.length} times`} without success (${friendlyError(last.errorCode)})`;
  });
  const submitted = new Set(ofKind(context, "form_submit").map((s) => s.formId));
  const openedOnly = [
    ...new Set(
      ofKind(context, "form_open")
        .map((f) => f.formId)
        .filter((id) => !submitted.has(id)),
    ),
  ].map((formId) => `opened the ${formName(formId)} form without submitting it`);
  const formFacts = [...forms, ...openedOnly];
  if (formFacts.length > 0) lines.push(`They ${formFacts.join("; they ")}.`);
  if (context.events.length > 0) lines.push(outcome(context));

  const clicks = [...new Set(ofKind(context, "click").map((c) => `"${c.label}"`))].slice(-3);
  if (clicks.length > 0) lines.push(`Clicked: ${clicks.join(", ")}.`);
  if (context.events.length === 0)
    lines.push("No activity has been recorded for this session yet.");
  return lines.join("\n\n");
}

/** Forms whose successful submission is a conversion, and how to say so. */
const CONVERSIONS: Record<string, string> = {
  checkout: "completed a purchase",
  signup: "signed up",
  contact_sales: "sent a contact request",
};

/**
 * The session's outcome. Guard: only a *successful* submission counts. A click on
 * "Upgrade to Pro", an opened checkout or a declined card is intent, not a purchase.
 * The evaluation suite fails if this guard is removed (see evaluation/).
 */
function outcome(context: AIContext): string {
  const achieved = Object.entries(CONVERSIONS).flatMap(([formId, text]) => {
    const submit = ofKind(context, "form_submit").find((s) => s.formId === formId && s.success);
    return submit ? [`${text} at ${formatOffset(submit.atMs)}`] : [];
  });
  return achieved.length > 0
    ? `Outcome: they ${achieved.join(" and ")}.`
    : "Outcome: no purchase, signup or contact request is recorded.";
}

function blockers(context: AIContext): string {
  const findings: string[] = [];
  for (const { formId, failures, stillFailing, last } of formOutcomes(context)) {
    if (failures.length === 0) continue;
    findings.push(
      stillFailing
        ? `• The ${formName(formId)} form failed ${plural(failures.length, "time")}: ${friendlyError(last.errorCode)} (last at ${formatOffset(last.atMs)}).`
        : `• The ${formName(formId)} form failed ${plural(failures.length, "time")} before a later attempt succeeded, so this no longer looks blocking.`,
    );
  }
  const submitted = new Set(ofKind(context, "form_submit").map((s) => s.formId));
  for (const formId of new Set(ofKind(context, "form_open").map((f) => f.formId)))
    if (!submitted.has(formId))
      findings.push(`• They opened the ${formName(formId)} form but haven't submitted it.`);
  for (const [path, count] of repeatedPages(context))
    findings.push(
      `• They viewed ${path} ${count} times, which can mean they're looking for something they can't find.`,
    );
  if (context.session.status === "idle")
    findings.push("• The session is idle: there has been no activity for a while.");

  return findings.length > 0
    ? `Possible blockers:\n${findings.join("\n")}`
    : "Nothing in the recorded activity suggests the visitor is stuck: no failed submissions, repeated pages or abandoned forms.";
}

function repeatedPages(context: AIContext) {
  const counts = new Map<string, number>();
  for (const view of ofKind(context, "page_view"))
    counts.set(view.path, (counts.get(view.path) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= 3);
}

function suggestReply(context: AIContext): string {
  const failing = formOutcomes(context)
    .filter((form) => form.stillFailing)
    .sort((a, b) => b.last.atMs - a.last.atMs)[0];
  const currentTitle = ofKind(context, "page_view").findLast(
    (view) => view.path === context.session.currentPath,
  )?.title;

  let message: string;
  if (failing)
    message = `Hi there! I noticed ${friendlyError(failing.last.errorCode)} when you submitted the ${formName(failing.formId)} form. Would you like a hand getting it sorted?`;
  else if (context.session.currentPath.startsWith("/pricing"))
    message = `Hi! I see you're looking at our pricing. If you have any questions about the plans, I'm happy to help.`;
  else
    // Titles come from the visitor's browser, so they're quoted, never used as our words.
    message = `Hi! I'm here if you have any questions${currentTitle ? ` about the "${currentTitle}" page` : ""}. Happy to help.`;
  return `${message}\n\n(Draft: review before sending.)`;
}

function anomalies(context: AIContext): string {
  const findings: string[] = [];

  // Rage clicks: 3+ clicks on one element within 5 s.
  const clicks = ofKind(context, "click");
  const reported = new Set<string>();
  for (const [i, start] of clicks.entries()) {
    const burst = clicks.filter(
      (c, j) => j >= i && c.element === start.element && c.atMs - start.atMs <= 5_000,
    );
    if (burst.length >= 3 && !reported.has(start.element)) {
      reported.add(start.element);
      const spanMs = (burst.at(-1)?.atMs ?? start.atMs) - start.atMs;
      findings.push(
        `• ${burst.length} clicks on "${start.label}" within ${Math.max(1, Math.round(spanMs / 1_000))} s at ${formatOffset(start.atMs)}: possibly an unresponsive button.`,
      );
    }
  }

  for (const { formId, failures } of formOutcomes(context))
    if (failures.length >= 2)
      findings.push(
        `• Repeated errors on the ${formName(formId)} form (${plural(failures.length, "failed submission")}).`,
      );

  // Back-and-forth: A → B → A → B.
  const paths = ofKind(context, "page_view").map((view) => view.path);
  for (let i = 3; i < paths.length; i++) {
    const [a, b, c, d] = paths.slice(i - 3, i + 1);
    if (a === c && b === d && a !== b) {
      findings.push(`• Back-and-forth navigation between ${a} and ${b}.`);
      break;
    }
  }

  return findings.length > 0
    ? `Unusual behaviour:\n${findings.join("\n")}`
    : "No unusual patterns in the recorded activity: no repeated clicks, repeated errors or back-and-forth navigation.";
}

function describe(event: AIContextEvent): string | null {
  switch (event.kind) {
    case "page_view":
      return `Viewed ${event.path}`;
    case "click":
      return `Clicked "${event.label}" on ${event.path}`;
    case "form_open":
      return `Opened the ${formName(event.formId)} form`;
    case "form_submit":
      return event.success
        ? `Submitted the ${formName(event.formId)} form`
        : `Submitting the ${formName(event.formId)} form failed (${event.errorCode ?? "error"})`;
    case "closed":
      return "Session ended";
    case "status":
      return event.status === "idle" ? "Went idle" : null;
    case "typing":
      return null;
  }
}

const MAX_KEY_EVENTS = 10;

function keyEvents(context: AIContext): string {
  const lines = context.events.flatMap((event) => {
    const text = describe(event);
    return text ? [`• ${formatOffset(event.atMs)}  ${text}`] : [];
  });
  if (lines.length === 0) return "No key events have been recorded for this session yet.";
  const shown = lines.slice(-MAX_KEY_EVENTS);
  const intro =
    lines.length > shown.length
      ? `The ${shown.length} most recent key events:`
      : "Key events, in order:";
  return `${intro}\n${shown.join("\n")}`;
}

/** The mock can't read language; it routes on keywords and says so when it can't. */
function answerQuestion(prompt: string, context: AIContext): string {
  const q = prompt.toLowerCase();
  if (/block|stuck|problem|issue|error|fail|wrong/.test(q))
    return withCoverage(blockers(context), context);
  if (/reply|message|say|respond|write|draft/.test(q)) return suggestReply(context);
  if (/unusual|odd|weird|anomal|suspicious|strange/.test(q))
    return withCoverage(anomalies(context), context);
  if (/key|timeline|events|happened|steps|did they/.test(q))
    return withCoverage(keyEvents(context), context);
  return withCoverage(
    `I can only answer from this session's recorded activity. Here's what it shows:\n\n${summarize(context)}`,
    context,
  );
}
