import { test as base, expect } from "@playwright/test";

/**
 * Collects console errors, uncaught exceptions and CSP violations for every test and
 * fails the test if any occurred. Hydration mismatches surface as console errors, so
 * this turns "no hydration mismatch" into an assertion on every page, not a special case.
 */
export const test = base.extend<{ allowedErrors: RegExp[]; pageErrors: string[] }>({
  /** Per-test opt-in for errors that are the expected outcome (e.g. a deliberate 404). */
  allowedErrors: [[], { option: true }],

  pageErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(errors);
      const unexpected = errors.filter(
        (error) => !allowedErrors.some((pattern) => pattern.test(error)),
      );
      expect(unexpected, "page produced errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
