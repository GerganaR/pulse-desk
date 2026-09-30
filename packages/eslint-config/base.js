// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared base config. Type-aware rules are enabled selectively: the ones that catch
 * real bugs in async/realtime code (floating promises, misused promises) are worth
 * the extra lint time; purely stylistic type-aware rules are not.
 *
 * @param {{ tsconfigRootDir: string }} options
 */
export function base({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        "dist/**",
        "dist-devtools/**",
        ".dev/**",
        "coverage/**",
        "*.config.{js,ts}",
        "**/*.d.ts",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      linterOptions: { reportUnusedDisableDirectives: "error" },
      rules: {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-explicit-any": "error",
        "no-console": ["warn", { allow: ["warn", "error"] }],
        eqeqeq: ["error", "smart"],
      },
    },
    {
      files: ["**/*.test.{ts,tsx}", "**/test/**"],
      rules: {
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
  );
}
