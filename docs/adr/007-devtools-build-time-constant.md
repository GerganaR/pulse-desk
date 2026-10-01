# ADR-007: Devtools behind a build-time constant, tested with a second build

- **Status:** Accepted
- **Date:** 2026-10-01 (decided in Phase 4, extended in Phase 5)

## Context

The reliability panel injects faults into a live connection: it cuts the network, drops,
duplicates and reorders events, adds latency, and makes the copilot time out, fail or
invent a claim. It is the best way to demonstrate and test recovery, and it must never
be reachable in production: it is a control surface for breaking the app.

Two requirements pull against each other:

- **It must not ship.** Not hidden, not disabled by a flag: absent from the artefact.
- **E2E tests must drive it**, and E2E runs against the production build, because that is
  the artefact worth testing (real SSR server, asset manifest, CSP, hashed assets).

## Decision

1. **`__DEVTOOLS__` is a build-time constant** (defined in `rspack.shared.ts`): `true` in
   development and in `pnpm build:devtools`, `false` in `pnpm build`. The panel is behind
   `__DEVTOOLS__ ? lazy(() => import(…)) : null` and the fault injector behind
   `__DEVTOOLS__ && config.devTools`, so in a production build the bundler removes the
   branches and the modules never enter the module graph.
2. **A second build for tests.** `pnpm build:devtools` makes the same production build
   with the constant on, into `dist-devtools/`. The E2E suite serves it on its own port
   for the specs that need the panel; every other spec runs against `dist/`, the exact
   artefact that ships.
3. **CI proves the exclusion, with a control.** Every devtools module uses the string
   `pulsedesk-devtools` at runtime. `check-devtools-excluded.ts` requires that marker to
   be absent from `dist/` (including source maps, whose `sourcesContent` would reveal a
   module that was bundled and then minified away) **and present** in `dist-devtools/`.
   The second half proves the check can find what it is looking for.
4. **Realtime faults are injected in the client**, by wrapping the transport
   (`createFaultInjector`). The client cannot tell it from a real network, and the
   gateway gets no debug routes and no extra attack surface.
5. **AI faults are enacted by the real services** (a deliberate exception to 4): the
   faults that matter there are server behaviour (ai-service's time limits, the proxy's
   error mapping). The choice travels as an `x-pulsedesk-ai-fault` header, and it is
   **doubly gated**: the web server forwards it only in devtools builds, and ai-service
   honours it only when started with `AI_DEBUG=1`.

## Alternatives considered

- **A runtime flag** (environment variable or config). One build, simpler pipeline. But
  the code ships to every user, the flag is one misconfiguration away from on, and "is
  the panel reachable in production?" becomes a question about every deployment instead
  of a property of the artefact.
- **`process.env.NODE_ENV !== "production"`** as the gate (the roadmap's original plan).
  It removes the code from production, but then E2E, which runs the production build,
  cannot use the panel. The flagship reliability test would have to run against a
  development build and stop testing what ships.
- **Gateway debug routes** to drop or delay events server-side. Closer to a real fault,
  but it adds endpoints that must themselves be kept out of production, and client-side
  injection already reaches every recovery path, including the server's replay and
  snapshot-on-expired-cursor. The one server-only path (slow-consumer backpressure) is
  covered by unit tests.
- **Mocking the network in Playwright** (`page.routeWebSocket`). Good for tests, but it
  gives nothing to a person in a demo, and the fault logic would live in test code where
  it cannot be unit-tested as a module.

## Consequences

- **Two builds in CI** (`build` and `build:devtools`), and two web servers in the E2E
  stack. Turbo caches both; the cost is seconds.
- **The devtools build is not the shipped artefact.** Specs that use it prove behaviour
  of the same code with one constant flipped. That gap is narrow but real, which is why
  only the specs that need the panel use it.
- **Turbo's strict env mode is part of the guard:** an outer `PULSEDESK_DEVTOOLS=1` does
  not reach `pnpm build`.
- **Both gates were mutation-checked:** removing either makes the CI check fail. E2E also
  checks that the production build ignores the AI fault header.
