# Prompts

Prompts used to build PulseDesk with an AI assistant, one per step of the loop in
[docs/ai-development-workflow.md](../docs/ai-development-workflow.md).

| Prompt                                     | Use it to                                             |
| ------------------------------------------ | ----------------------------------------------------- |
| [feature-planning.md](feature-planning.md) | turn a roadmap item into a plan with decisions        |
| [implementation.md](implementation.md)     | implement an approved plan in small verified steps    |
| [test-generation.md](test-generation.md)   | write tests that would fail if the behaviour broke    |
| [code-review.md](code-review.md)           | review a diff for this codebase's known failure modes |
| [refactoring.md](refactoring.md)           | change structure without changing behaviour           |

Each prompt starts with the context block below. Paste it first, then the prompt, then
the task. Keep this block current: when a phase adds a boundary or a failure mode, add it
here, once, rather than to each prompt.

## Context block

```text
You are working on PulseDesk, a real-time session monitoring console with an AI copilot
(pnpm + Turborepo monorepo, Node 24, TypeScript 6, React 19). Read docs/roadmap.md first:
it is the source of truth for scope, decisions and every plan change.

Layout
- apps/web: React 19 custom streaming SSR (Rspack client + server builds), React Router,
  Redux. Same-origin API: /api/sessions*, POST /api/ai/chat (proxies ai-service).
- apps/realtime-gateway: HTTP + WebSocket; single writer assigns sequences; replay buffer.
- apps/event-simulator: scripted visitor journeys posted to the gateway.
- apps/ai-service: NDJSON streaming answers; mock (default) and OpenAI-compatible
  providers; grounding checker in src/evaluation/.
- packages/contracts (Zod schemas, protocol, toAIContext privacy boundary), state (Redux
  Toolkit slices), realtime-client (reconnect, heartbeat, sequencer), ui (design system),
  observability (logger, typed metrics), test-utils. tests/: Playwright E2E.

Rules that are easy to break
- Packages ship TS source, no build step. Node code: NodeNext, explicit .ts imports.
  apps/web and ui: Bundler resolution. erasableSyntaxOnly: no enums, no parameter
  properties. Node packages typecheck without DOM types (browser-only code goes behind a
  subpath export).
- Lint: exhaustive switches with no default for unions, no non-null assertions outside
  tests, no dynamic delete (use entity adapters), React Compiler rules (no setState in
  effects, no ref reads in render), jsx-a11y, no console.
- Turbo runs in strict env mode: a new env var goes in passThroughEnv (dev/start) or env
  (build). Read the installed turbo docs before changing turbo.json.
- Devtools code (reliability panel, fault injection) must be reachable only behind the
  __DEVTOOLS__ build constant. CI checks that dist/ has no devtools marker.
- Contracts are validated at every boundary (Zod). The AI context is built on the web
  server by toAIContext() from an allowlist; never spread a session into it.
- Model output is untrusted: render it as text, never as HTML or Markdown.
- The initial JS budget is exceeded on purpose (tracked in docs/performance.md). Never
  raise a limit or silence a warning to get green.

Known failure modes in this codebase
- Hydration: nothing time- or locale-dependent in render without a server-provided value
  (the clock uses useSyncExternalStore with the server's time as getServerSnapshot).
- StrictMode: effects run twice in development. Effects must be safe to start, stop and
  start again (the realtime client supports close() then connect() and keeps its
  cursor; abort-on-cleanup broke a deduped fetch once).
- CSP: strict nonce-based script-src, no 'unsafe-eval'. Zod runs jitless in the browser
  (packages/contracts/src/csp-safe.ts, imported first). No inline scripts or styles
  without the nonce.
- Reconnect: events are delivered exactly once, in sequence order, across reconnects,
  replays and gateway restarts ({streamId, sequence} cursors). Anything that touches
  delivery needs a test that asserts sequences, not timing.
- Tests: never assert on transient UI state; record it in the page and assert after, or
  assert a persistent outcome. The E2E fixture fails any test with a console error.

Working agreement
- Verify, then report: lint, typecheck, test, build, build:devtools
  (pnpm turbo run ... --force), the devtools-excluded check, format:check, pnpm e2e.
- Report failures as they are, with the output. Don't commit, delete files or change
  git state; the human does that.
```
