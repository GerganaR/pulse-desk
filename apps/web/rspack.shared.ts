import { readFileSync } from "node:fs";
import path from "node:path";
import type { RuleSetRule } from "@rspack/core";

export const rootDir = import.meta.dirname;
export const isDev = process.env.NODE_ENV !== "production";

export const CLIENT_DEV_PORT = Number(process.env.CLIENT_DEV_PORT ?? 3001);
/** Port of the SSR server — the URL developers actually open. */
export const SSR_PORT = Number(process.env.PORT ?? 3000);

export const paths = {
  src: path.join(rootDir, "src"),
  clientEntry: path.join(rootDir, "client/entry-client.tsx"),
  serverEntry: path.join(rootDir, "server/server.ts"),
  clientOutput: path.join(rootDir, "dist/client"),
  // Dev builds go to .dev/ so a running `pnpm dev` and a production `pnpm build` never
  // overwrite each other's bundles.
  serverOutput: path.join(rootDir, isDev ? ".dev/server" : "dist/server"),
};

/**
 * Public path the browser loads client assets from. In development the client bundle is
 * served by the Rspack dev server (HMR), while HTML still comes from the SSR server.
 */
export const clientPublicPath = isDev ? `http://localhost:${CLIENT_DEV_PORT}/` : "/assets/";

export const resolve = {
  extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
  // Internal packages ship TypeScript source; SWC compiles them like app code.
  // `tsConfig` lets Rspack honour the `@/` alias declared in tsconfig.json.
  tsConfig: path.join(rootDir, "tsconfig.json"),
};

/** Browser targets come from package.json `browserslist`, shared with Tailwind/Lightning CSS. */
const browserTargets: string[] = (
  JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { browserslist: string[] }
).browserslist;

/**
 * TypeScript/TSX through Rspack's built-in SWC loader. No Babel, no ts-loader: type
 * checking is a separate `tsc --noEmit` task so builds stay fast and deterministic.
 */
export function swcRule({
  target,
  refresh,
}: {
  target: "web" | "node";
  refresh: boolean;
}): RuleSetRule {
  return {
    test: /\.[cm]?tsx?$/,
    exclude: /node_modules/,
    loader: "builtin:swc-loader",
    type: "javascript/auto",
    options: {
      jsc: {
        parser: { syntax: "typescript", tsx: true },
        transform: {
          react: { runtime: "automatic", development: isDev, refresh },
        },
      },
      env: { targets: target === "web" ? browserTargets : ["node 24"] },
    },
  };
}
