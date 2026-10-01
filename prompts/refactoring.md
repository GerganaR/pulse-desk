# Refactoring

Use to change structure without changing behaviour: extracting a module, merging
duplicates, renaming, moving code across a package boundary.

```text
[context block from prompts/README.md]

Task: refactor {{what}} so that {{why: the concrete problem, e.g. "the AI fault control
and the latency control duplicate the segmented radio markup"}}.

Before changing anything:
- Say which behaviour must stay identical, and which tests pin it. If none do, write
  characterisation tests first (see prompts/test-generation.md), run them green on the
  current code, and only then refactor.
- Check what depends on the code: grep the monorepo, including tests/, docs/ and
  scripts. packages/* export TS source, so a moved export breaks consumers at typecheck,
  not at build.

While refactoring:
- Keep each step behaviour-preserving and small enough to review as one diff. Don't
  combine a refactor with a fix or a feature; note the fix for a separate change.
- Keep the boundaries: don't pull devtools code out from behind __DEVTOOLS__, move
  browser code into a Node package's main entry, or widen what toAIContext() sends.
- Moving code into the main bundle's import graph costs initial JS. If the refactor
  changes chunking, measure before and after (method in docs/performance.md).
- Keep public names stable unless the rename is the point. Update docs that name the
  old path (README, docs/*.md, prompts/).

Afterwards: the same tests pass without edits to their assertions (edits to imports are
fine), plus the full check (pnpm turbo run lint typecheck test build build:devtools
--force). Report the bundle numbers if the web app changed.
```

## Notes

- "Tests pass without changing assertions" is the definition of behaviour-preserving
  here. A refactor that needs a changed assertion changed behaviour, and that should be
  said out loud.
- Past example: the reliability panel's latency control became a shared `Segmented`
  radio group in Phase 5, when the AI fault control needed the same markup.
