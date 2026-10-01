## What and why

<!-- One paragraph: what changes, and the problem it solves. Link the roadmap phase or item. -->

Roadmap: <!-- e.g. Phase 6, items 24–32 -->

## Decisions

<!-- Choices a reviewer should know about, with the alternative you rejected. Plan changes
belong in docs/roadmap.md as numbered items, in this PR. -->

## Verification

- [ ] `pnpm turbo run lint typecheck test build build:devtools --force`
- [ ] `pnpm --filter @pulsedesk/web check:devtools-excluded --strict`
- [ ] `pnpm format:check`
- [ ] `pnpm e2e`
- [ ] New or changed specs with `--repeat-each=5`: <!-- specs and result -->
- [ ] Real browser, light, dark, 390 px and 1280 px: <!-- screenshots below, or "no UI change" -->
- [ ] Bundle: initial JS before → after (method in docs/performance.md), or "unchanged"
- [ ] Docs updated: roadmap status and plan changes, README, affected docs/ADRs

<!-- Anything that failed, flaked or wasn't verified: say so here, with the output. -->

## Screenshots

## AI assistance

<!-- See docs/ai-development-workflow.md. Be specific; "used AI" tells a reviewer nothing. -->

- **Assistant and model:**
- **What it did:** <!-- planning / implementation / tests / review / docs -->
- **Prompts used:** <!-- prompts/*.md, and anything task-specific worth keeping -->
- **What a human decided or changed:** <!-- plan amendments, rejected suggestions and why -->
- **Mutation checks:** <!-- each guard, the line broken, the test that failed -->
- **Checked by hand:** <!-- what a person ran, read or clicked through, beyond CI -->
- **Not verified:** <!-- e.g. real-provider eval not run (no key) -->

## Risk and rollback

<!-- What could break in production, how you'd notice (metric, log, test), how to revert. -->
