import { react } from "@pulsedesk/eslint-config/react";
import globals from "globals";

const nodeFiles = ["server/**", "scripts/**", "rspack.*.ts"];

export default [
  ...react({ tsconfigRootDir: import.meta.dirname }),
  {
    // Node-side code is type-checked by tsconfig.node.json (no DOM types for server code).
    files: nodeFiles,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: false,
        project: "./tsconfig.node.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
