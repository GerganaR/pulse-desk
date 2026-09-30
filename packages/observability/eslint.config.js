import { base } from "@pulsedesk/eslint-config/base";

export default [
  ...base({ tsconfigRootDir: import.meta.dirname }),
  {
    // Log sinks are the one place output legitimately goes to the console; everything
    // else in the monorepo logs through a Logger instead.
    files: ["src/logger.ts"],
    rules: { "no-console": "off" },
  },
];
