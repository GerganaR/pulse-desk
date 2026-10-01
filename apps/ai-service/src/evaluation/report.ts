import type { CaseResult } from "./evaluate.ts";
import { passed } from "./evaluate.ts";

export interface EvalRunInfo {
  model: string;
  provider: "mock" | "openai";
  startedAt: string;
  repeat: number;
}

export interface EvalSummary {
  cases: number;
  passed: number;
  /** Provider failures (timeouts, HTTP errors); not scored. */
  errors: number;
  /** Answers the provider cut at its output limit: scored, but incomplete. */
  truncated: number;
  /** Extra attempts after the provider asked to slow down (429, 503). */
  retries: number;
  claims: number;
  unverifiedClaims: number;
  bannedPhrases: number;
  /** Summary facts found / expected. */
  mentions: { found: number; expected: number };
  latencyMs: { p50: number; p95: number };
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

export function summarise(results: readonly CaseResult[]): EvalSummary {
  const scored = results.flatMap((r) => (r.score ? [r.score] : []));
  const summaries = results.filter((r) => r.action === "summarize" && r.score);
  const expected = summaries.reduce((n, r) => n + r.fixture.summaryMentions.length, 0);
  const missing = summaries.reduce((n, r) => n + (r.score?.missing.length ?? 0), 0);
  return {
    cases: results.length,
    passed: scored.filter(passed).length,
    errors: results.filter((r) => r.error !== null).length,
    truncated: results.filter((r) => r.finishReason === "length").length,
    retries: results.reduce((n, r) => n + r.attempts - 1, 0),
    claims: scored.reduce((n, s) => n + s.claims.length, 0),
    unverifiedClaims: scored.reduce((n, s) => n + s.unverified.length, 0),
    bannedPhrases: scored.reduce((n, s) => n + s.banned.length, 0),
    mentions: { found: expected - missing, expected },
    latencyMs: {
      p50: Math.round(
        percentile(
          results.map((r) => r.durationMs),
          50,
        ),
      ),
      p95: Math.round(
        percentile(
          results.map((r) => r.durationMs),
          95,
        ),
      ),
    },
  };
}

const caseName = (r: CaseResult) =>
  `\`${r.fixture.id}\` · ${r.action}${r.prompt ? ` · "${r.prompt}"` : ""}`;
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

/** A Markdown report a reviewer can read without running anything. */
export function renderMarkdown(info: EvalRunInfo, results: readonly CaseResult[]): string {
  const summary = summarise(results);
  const lines = [
    `# Grounding evaluation: ${info.model}`,
    "",
    `- Provider: ${info.provider}${info.provider === "mock" ? " (the CI baseline; set OPENAI_API_KEY and OPENAI_MODEL to evaluate a real model)" : ""}`,
    `- Run: ${info.startedAt}, each case ${info.repeat === 1 ? "once" : `${info.repeat} times`}`,
    `- Checker: rule-based (apps/ai-service/src/evaluation/grounding.ts); see LIMITATIONS.md`,
    "",
    "| Measure | Result |",
    "| --- | --- |",
    `| Cases passed (no unverified, forbidden or banned claims) | ${summary.passed} / ${summary.cases - summary.errors} |`,
    `| Outcome claims checked | ${summary.claims} |`,
    `| Unverified claims | ${summary.unverifiedClaims} |`,
    `| Banned phrases | ${summary.bannedPhrases} |`,
    `| Expected summary facts mentioned | ${summary.mentions.found} / ${summary.mentions.expected} |`,
    `| Answers cut at the output limit | ${summary.truncated} |`,
    `| Provider errors | ${summary.errors} |`,
    `| Retries after rate limiting or overload | ${summary.retries} |`,
    `| Latency p50 / p95 | ${summary.latencyMs.p50} ms / ${summary.latencyMs.p95} ms |`,
    "",
    "## By fixture",
    "",
    "| Fixture | Passed | Unverified claims |",
    "| --- | --- | --- |",
  ];
  const fixtures = [...new Set(results.map((r) => r.fixture))];
  for (const fixture of fixtures) {
    const own = results.filter((r) => r.fixture === fixture);
    const ok = own.filter((r) => r.score && passed(r.score)).length;
    const unverified = own.reduce((n, r) => n + (r.score?.unverified.length ?? 0), 0);
    lines.push(
      `| \`${fixture.id}\`: ${cell(fixture.title)} | ${ok} / ${own.length} | ${unverified} |`,
    );
  }

  const problems = results.filter((r) => r.error !== null || (r.score && !passed(r.score)));
  lines.push("", "## Failures", "");
  if (problems.length === 0) lines.push("None.");
  for (const r of problems) {
    lines.push(`### ${caseName(r)}`, "");
    if (r.error) lines.push(`Provider error: ${r.error}`, "");
    for (const claim of r.score?.unverified ?? [])
      lines.push(
        `- **Unverified ${claim.kind}** (${claim.polarity}): "${claim.quote}": ${claim.reason}`,
      );
    for (const phrase of r.score?.banned ?? []) lines.push(`- **Banned phrase** ${phrase}`);
    lines.push("", "Answer:", "", indent(r.answer || "(empty)"), "");
  }

  const cut = results.filter((r) => r.finishReason === "length");
  if (cut.length > 0) {
    lines.push(
      "## Answers cut at the output limit",
      "",
      "Scored, but incomplete: a claim may be missing its end. Models that reason before",
      "answering spend the limit on reasoning; raise OPENAI_MAX_OUTPUT_TOKENS.",
      "",
    );
    for (const r of cut) lines.push(`- ${caseName(r)}: ${r.answer.length} characters`);
    lines.push("");
  }

  const gaps = results.filter((r) => r.score && r.score.missing.length > 0);
  if (gaps.length > 0) {
    lines.push(
      "## Summary facts not mentioned",
      "",
      "Not failures: a summary can be right and brief.",
      "",
    );
    for (const r of gaps) lines.push(`- ${caseName(r)}: ${r.score?.missing.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
