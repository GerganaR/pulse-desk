# Code review

Use on a diff before the human's final review. The goal is findings a reviewer can act
on, ranked by severity, with no padding.

```text
[context block from prompts/README.md]

Task: review this change. {{git diff main...HEAD, or the PR}}
Intent: {{what the change is meant to do; link the roadmap item}}

Check, in this order:
1. Correctness. Does it do what the intent says, including the error, cancel, timeout
   and empty cases? Trace one concrete input through the changed code.
2. This codebase's failure modes:
   - Hydration: time, locale or random values in render without a server value.
   - StrictMode: effects that aren't safe to run, clean up and run again.
   - CSP: new inline script/style, eval-like code, a new origin the CSP doesn't allow.
   - Realtime: anything that could drop, duplicate or reorder events, or reset the
     {streamId, sequence} cursor.
   - AI: model output rendered as markup; session data reaching a model without
     toAIContext(); a prompt that mixes data with instructions; claims the grounding
     checker should catch but doesn't.
   - Devtools code reachable in the production bundle (outside __DEVTOOLS__).
   - Browser-only APIs in Node packages; Node APIs in the client bundle.
3. Boundaries and contracts: inputs validated with contracts schemas; a wire change
   compatible both ways; new env vars in turbo.json.
4. Tests: would each test fail if the behaviour broke? Is any test asserting on
   transient UI, real timing, or simulator luck? Is a guard untested?
5. Cost: initial bundle growth (anything imported by the main chunk), per-token or
   per-event work in React render, unbounded growth (maps, logs, conversations).

For each finding: file:line, what goes wrong, a concrete scenario that triggers it, and
the smallest fix. Mark it CONFIRMED (you traced it) or PLAUSIBLE (needs checking).
Leave out style preferences that lint or Prettier would catch, and "consider adding
tests" without saying which test.

If you find nothing serious, say so plainly.
```

## Notes

- The review is a second look, not the verification. It doesn't replace running the
  checks, and a clean review of an untested change is still an untested change.
- Findings go to the human, who decides. The assistant doesn't apply review fixes
  unasked.
