/**
 * `pnpm eval`: runs every evaluation case against a provider and writes a report.
 *
 * With OPENAI_API_KEY and OPENAI_MODEL set (OPENAI_BASE_URL optional), it evaluates that
 * model; otherwise the mock, which is what CI checks in `regression.test.ts`. Real models
 * are nondeterministic, so `--repeat N` asks each case N times.
 *
 *   pnpm eval [--repeat 3] [--fixture checkout-declined] [--concurrency 4] [--rpm 5]
 *
 * Real providers are asked one case at a time unless `--concurrency` says otherwise, and
 * rate limits (429) and overload (503) are retried after the wait the provider asks for.
 * `--rpm N` spaces requests to stay under a quota (a free tier may allow only 5 a minute).
 *
 * Exits 1 if any answer makes a claim its session doesn't support.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createMockProvider } from "../providers/mock.provider.ts";
import { createOpenAIProvider } from "../providers/openai.provider.ts";
import type { AIProvider } from "../providers/types.ts";
import { evalCases, passed, runCase, type CaseResult, type EvalCase } from "./evaluate.ts";
import { EVAL_FIXTURES } from "./fixtures.ts";
import { renderMarkdown, summarise, type EvalRunInfo } from "./report.ts";

const out = (line = "") => process.stdout.write(`${line}\n`);

const { values } = parseArgs({
  options: {
    repeat: { type: "string", default: "1" },
    fixture: { type: "string", multiple: true },
    concurrency: { type: "string" },
    rpm: { type: "string" },
    out: { type: "string", default: path.join(import.meta.dirname, "../../eval-reports") },
  },
});
const repeat = Math.max(1, Number(values.repeat) || 1);
const rpm = Number(values.rpm) > 0 ? Number(values.rpm) : null;

function chooseProvider(): { provider: AIProvider; kind: EvalRunInfo["provider"] } {
  const { OPENAI_API_KEY: apiKey, OPENAI_MODEL: model, OPENAI_BASE_URL: baseUrl } = process.env;
  if (apiKey && model)
    return {
      kind: "openai",
      provider: createOpenAIProvider({
        apiKey,
        model,
        baseUrl: (baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, ""),
        maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || undefined,
      }),
    };
  if (apiKey) out("OPENAI_API_KEY is set but OPENAI_MODEL isn't; using the mock provider.");
  return { kind: "mock", provider: createMockProvider({ tokenMs: 0, firstTokenDelayMs: 0 }) };
}

const fixtures = values.fixture
  ? EVAL_FIXTURES.filter((f) => values.fixture?.includes(f.id))
  : EVAL_FIXTURES;
if (fixtures.length === 0) {
  out(`No such fixture. Known: ${EVAL_FIXTURES.map((f) => f.id).join(", ")}`);
  process.exit(2);
}

const { provider, kind } = chooseProvider();
const real = kind !== "mock";
const concurrency = Math.max(1, Number(values.concurrency) || (real ? 1 : 4));

/** Spaces request starts so at most `rpm` begin in any minute. */
let nextSlot = 0;
async function paced() {
  if (!rpm) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 60_000 / rpm;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}
const info: EvalRunInfo = {
  model: provider.model,
  provider: kind,
  startedAt: new Date().toISOString(),
  repeat,
};
const queue: EvalCase[] = evalCases(fixtures).flatMap((c) => Array<EvalCase>(repeat).fill(c));
out(
  `Evaluating ${provider.model} (${kind}): ${queue.length} answers, ${concurrency} at a time` +
    (rpm ? `, at most ${rpm} a minute (about ${Math.ceil(queue.length / rpm)} min)` : ""),
);

const results: CaseResult[] = [];
let next = 0;
async function worker() {
  while (next < queue.length) {
    const index = next++;
    const evalCase = queue[index];
    if (!evalCase) return;
    await paced();
    const result = await runCase(provider, evalCase, {
      requestId: `req_eval_${String(index).padStart(8, "0")}`,
      retries: real ? 6 : 0,
    });
    results[index] = result;
    const ok = result.score && passed(result.score);
    process.stdout.write(ok ? "." : result.error ? "E" : "F");
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
out();

const summary = summarise(results);
const stamp = info.startedAt.replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
const base = path.join(values.out, `${stamp}-${provider.model.replaceAll(/[^\w.-]/g, "_")}`);
await mkdir(values.out, { recursive: true });
await writeFile(`${base}.md`, renderMarkdown(info, results));
await writeFile(
  `${base}.json`,
  JSON.stringify(
    {
      ...info,
      summary,
      results: results.map(({ fixture, ...r }) => ({ ...r, fixture: fixture.id })),
    },
    null,
    2,
  ),
);

out(
  `Passed ${summary.passed}/${summary.cases - summary.errors}; ` +
    `${summary.unverifiedClaims} unverified of ${summary.claims} claims; ` +
    `${summary.bannedPhrases} banned phrases; ${summary.errors} provider errors` +
    (summary.truncated ? `; ${summary.truncated} answers cut at the output limit` : "") +
    (summary.retries ? `; ${summary.retries} retries` : "") +
    ".",
);
out(`Report: ${path.relative(process.cwd(), `${base}.md`)}`);
process.exit(summary.passed === summary.cases ? 0 : 1);
