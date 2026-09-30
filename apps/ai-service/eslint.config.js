import { base } from "@pulsedesk/eslint-config/base";
import globals from "globals";

export default [
  ...base({ tsconfigRootDir: import.meta.dirname }),
  { languageOptions: { globals: globals.node } },
];
