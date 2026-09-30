import { defineConfig } from "@rspack/cli";
import { isDev, paths, resolve, rootDir, swcRule } from "./rspack.shared.ts";

/**
 * Server bundle: the Node HTTP server, the SSR pipeline and the React tree, emitted as a
 * single ESM file. Dependencies are bundled (not externalised) so the production artefact
 * is self-contained and resolves exactly the same module graph as the client — the
 * `react-dom/server` "node" export condition is picked because `target` is node.
 *
 * CSS is never imported on this side: styles enter the graph only via entry-client.tsx,
 * and the server emits <link> tags from the client's asset manifest instead.
 */
export default defineConfig({
  name: "server",
  context: rootDir,
  mode: isDev ? "development" : "production",
  target: "node24",
  entry: { server: paths.serverEntry },
  output: {
    path: paths.serverOutput,
    filename: "[name].js",
    chunkFilename: "chunks/[name].js",
    module: true,
    chunkFormat: "module",
    library: { type: "module" },
    clean: true,
  },
  resolve,
  devtool: "source-map",
  externalsPresets: { node: true },
  module: {
    rules: [swcRule({ target: "node", refresh: false })],
  },
  optimization: {
    // Readable stack traces matter more than bytes on the server.
    minimize: false,
  },
});
