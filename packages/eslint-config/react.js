// @ts-check
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { base } from "./base.js";

/** @param {{ tsconfigRootDir: string }} options */
export function react(options) {
  return tseslint.config(
    ...base(options),
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: { globals: globals.browser },
      plugins: { "react-hooks": reactHooks },
      rules: {
        ...reactHooks.configs.recommended.rules,
      },
    },
    jsxA11y.flatConfigs.recommended,
  );
}
