# Feature planning

Use before writing code for a roadmap phase or item. The output is reviewed by a human
before anything is implemented.

```text
[context block from prompts/README.md]

Task: plan {{roadmap phase or item, e.g. "Phase 6: AI quality"}}.

Before planning, read:
- docs/roadmap.md: the phase's deliverables, "done when", and every numbered plan change
  (they record decisions you must not silently reverse);
- the docs and ADRs for the areas it touches (docs/*.md, docs/adr/*);
- the code it will change. Quote file paths; don't describe code you haven't opened.

Produce:
1. What "done" means, restated as checks someone could run. If the roadmap's
   "done when" is vague, propose a concrete test for it.
2. Key decisions (at most five). For each: the choice, the alternative you rejected, and
   why, in terms of this codebase (bundle budget, privacy boundary, SSR, devtools
   exclusion, test determinism, ...). Flag any decision that changes a contract in
   packages/contracts or the wire protocol.
3. Where each part lives (package or app, file), respecting the boundaries: browser vs
   Node, production vs __DEVTOOLS__, server-built AI context.
4. Steps, each small enough to verify on its own, in order, with the test that proves
   each one.
5. Risks: which known failure modes (hydration, StrictMode, CSP, reconnect ordering,
   flaky E2E) this could hit, and how the plan avoids them.
6. Roadmap changes this plan implies (new numbered items), and what's deliberately out of
   scope.

Rules:
- Don't start implementing. Don't pad: no restating the task, no generic best practices.
- If something the plan depends on is unknown, say what you'd check, not what you assume.
```

## Notes

- The plan for each phase is stated in a few lines at the start of the work, and the
  decisions it records end up as numbered "plan changes" in the roadmap.
- A good plan names the mutation that proves the main guard works. Phase 6's did:
  "removing the success guard in the mock makes CI fail".
