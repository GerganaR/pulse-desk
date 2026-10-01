# Test generation

Use to write tests for new or changed behaviour. The bar: each test fails if the
behaviour it names breaks, and passes reliably otherwise.

```text
[context block from prompts/README.md]

Task: write tests for {{behaviour}} in {{files}}.

Choose the lowest level that can see the behaviour:
- pure logic (reducers, selectors, sequencer, checker, context mapping): Vitest unit
  tests, table-driven where the input space is a list of cases;
- timing (backoff, heartbeat, batching, timeouts): fake timers or injected clocks and
  schedulers, never real sleeps;
- HTTP/WebSocket services: an in-process server on port 0 with a real client;
- React components: Testing Library, queried by role and name the way a user or screen
  reader finds them;
- user flows across the stack: Playwright in tests/e2e, only for what lower levels can't
  show (streaming in a real browser, reconnect, the production build).

Rules for this codebase:
- Assert outcomes, not implementation: sequences in DOM attributes (data-sequence), not
  "a function was called"; the chunk sent, not the internal buffer.
- Never assert on transient UI. Record it in the page as it happens (a MutationObserver
  writing to window) and assert afterwards, or assert on a state that persists.
- Don't depend on simulator timing: choose data that has what the test needs (e.g. an
  active session that already has page views), or create it.
- Expected console errors go in test.use({ allowedErrors: [...] }); any other console
  error fails the test.
- Locators are scoped: the reliability panel has two "Off" options, and a turn's
  flagged claims are list items too.
- Hydration tests render on the "server" with a fixed clock and hydrate with a skewed
  one, and include a negative control that proves a mismatch is detected.
- Name each test as the behaviour it guards ("a click on Upgrade is not a purchase").

For each guard you test, do a mutation check: say which line you would remove or
invert, run the test with it broken, confirm it fails, restore it. Report the result.

Then: run the new tests five times (E2E: --repeat-each=5), and report any failure with
its output, even if a rerun passes.
```

## Notes

- A one-off failure under `--repeat-each` is a finding, not noise. In Phase 6 one
  such failure turned out to be a newborn session with no events yet, and a gateway
  timeout turned out to be a heartbeat race. Both were fixed at the cause.
