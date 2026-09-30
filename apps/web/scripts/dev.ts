/**
 * Development orchestrator for the web app.
 *
 *   ┌──────────────────────────┐        ┌──────────────────────────────┐
 *   │ Rspack dev server :3001  │        │ Rspack server build (watch)  │
 *   │ client bundle + HMR      │        │ dist/server/server.js        │
 *   └────────────┬─────────────┘        └──────────────┬───────────────┘
 *                │ asset-manifest.json                 │ on successful rebuild
 *                ▼                                     ▼
 *          ┌──────────────────────────────────────────────────┐
 *          │ SSR server :3000 (child process, restarted)      │
 *          └──────────────────────────────────────────────────┘
 *
 * Client edits hot-reload in place via React Refresh. Server-side edits rebuild the server
 * bundle and restart the SSR process; the old process is fully stopped before the new one
 * binds the port.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { type Configuration, rspack } from "@rspack/core";
import { RspackDevServer } from "@rspack/dev-server";

process.env.NODE_ENV ??= "development";

// Imported after NODE_ENV is set: the configs read it at module evaluation time.
const { default: clientConfig } = (await import("../rspack.client.config.ts")) as {
  default: Configuration;
};
const { default: serverConfig } = (await import("../rspack.server.config.ts")) as {
  default: Configuration;
};

const serverBundle = path.join(String(serverConfig.output?.path), "server.js");

const clientCompiler = rspack(clientConfig);
const devServer = new RspackDevServer(clientConfig.devServer || {}, clientCompiler);
await devServer.start();

const appUrl = `http://localhost:${process.env.PORT ?? 3000}`;

let child: ChildProcess | undefined;
let restarting = Promise.resolve();
let announced = false;

async function stopChild() {
  const current = child;
  child = undefined;
  if (!current || current.exitCode !== null) return;
  current.kill("SIGTERM");
  await once(current, "exit");
}

function restartServer() {
  restarting = restarting.then(async () => {
    await stopChild();
    child = spawn(process.execPath, ["--enable-source-maps", serverBundle], {
      stdio: "inherit",
      env: process.env,
    });
    if (!announced) {
      announced = true;
      // The dev server's own banner points at :3001 (assets only); make the real URL obvious.
      console.warn(`\n  ➜  PulseDesk:  \x1b[1;36m${appUrl}\x1b[0m  (open this one)\n`);
    }
  });
  return restarting;
}

const serverCompiler = rspack(serverConfig);
const watcher = serverCompiler.watch({ aggregateTimeout: 150 }, (error, stats) => {
  if (error) {
    console.error(error);
    return;
  }
  if (stats?.hasErrors()) {
    console.error(stats.toString({ colors: true, preset: "errors-only" }));
    return;
  }
  void restartServer();
});

async function shutdown() {
  await new Promise<void>((resolve) => watcher.close(() => resolve()));
  await stopChild();
  await devServer.stop();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
