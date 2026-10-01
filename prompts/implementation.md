# Implementation

Use once a plan is approved. It keeps each step small, verified and honest.

```text
[context block from prompts/README.md]

Task: implement step {{n}} of the approved plan: {{step}}.
Plan: {{paste the approved plan, or its path}}.

How to work:
- Read every file before editing it, and match the surrounding code: naming, comment
  density, idioms. Prettier reflows code, so re-read a file before an exact-string edit.
- Make the smallest change that does the step. No drive-by refactors; list anything you
  noticed but didn't change.
- Put code on the right side of each boundary:
  - browser vs Node (Node packages have no DOM types);
  - production vs __DEVTOOLS__ (devtools code reachable only behind the constant);
  - the AI context built by toAIContext() on the server, never in the browser.
- Validate new inputs at the boundary with a schema in packages/contracts. A contract
  change must stay compatible with the other side (e.g. a new field has a default).
- New env var: add it to turbo.json (passThroughEnv or env) and to the README table.
- Write the test with the code (see prompts/test-generation.md). A step isn't done until
  its test would fail without it: break the code on purpose, watch the test fail,
  restore it.

After the step:
- Run the narrowest useful checks (the package's typecheck, lint and tests), then say
  exactly what ran and what it printed. If something unrelated fails, stop and report it
  with the output; don't paper over it (no retries-until-green, no raised timeouts, no
  skipped tests).
- If the step changes UI, check it in a real browser: light, dark, 390 px mobile, and
  1280 px. Run on spare ports (see README), and stop only the processes you started.
- Summarise: what changed (file:line), what was verified, what wasn't, and anything the
  plan got wrong.

Don't: commit, delete files you didn't create, raise budgets or limits, add `default:` to
a union switch, use non-null assertions outside tests, or render model output as HTML.
```

## Notes

- "Stop only the processes you started": identify them by the PID listening on the
  port. A broad `pkill -f node` would also kill the developer's own `pnpm dev`.
- The phase-level verification (all tasks with `--force`, E2E, `--repeat-each=5` on new
  specs) runs once at the end of the phase, not after every step.
