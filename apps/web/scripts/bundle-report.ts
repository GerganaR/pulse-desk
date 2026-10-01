/**
 * Reports what a browser downloads for the production build, and enforces the budget.
 *
 *   node scripts/bundle-report.ts            print the report for dist/
 *   node scripts/bundle-report.ts --check    also exit 1 if a budget is exceeded (CI)
 *   node scripts/bundle-report.ts --json     machine-readable (for docs/performance.md)
 *
 * "Initial" is what the asset manifest lists as `scripts`: what every page must download,
 * parse and run before it can hydrate. That is what the budget limits. Two more groups
 * are fetched with the page but don't block hydration: the page's own route chunk, and
 * the realtime chunk (preloaded, run after hydration). Moving code out of "initial" isn't
 * free, so the report also prints everything a first visit downloads per route.
 *
 * Sizes are bytes on disk (minified) and `gzip -9`, the same method as every table in
 * docs/performance.md, so numbers are comparable across phases. The Brotli column is the
 * precompressed copy the server actually sends to browsers.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

/** Minified bytes of JavaScript every page loads. Never raise this to get green. */
export const INITIAL_JS_BUDGET = 350_000;
/** Minified bytes any single route may add on top of the initial scripts. */
export const ROUTE_JS_BUDGET = 60_000;

interface Manifest {
  scripts: string[];
  styles: string[];
  routes?: Record<string, string[]>;
  preload?: string[];
}

interface Size {
  file: string;
  bytes: number;
  gzip: number;
  /** Size of the precompressed `.br` copy the server sends to browsers (0 if not built). */
  brotli: number;
}

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = path.join(appDir, process.argv.includes("--devtools") ? "dist-devtools" : "dist");
const clientDir = path.join(outDir, "client");
const check = process.argv.includes("--check");
const json = process.argv.includes("--json");

async function sizeOf(file: string): Promise<Size> {
  const content = await readFile(path.join(clientDir, file));
  const brotli = await stat(path.join(clientDir, `${file}.br`)).then(
    (info) => info.size,
    () => 0,
  );
  return { file, bytes: content.length, gzip: gzipSync(content, { level: 9 }).length, brotli };
}

const total = (sizes: Size[]) =>
  sizes.reduce(
    (sum, s) => ({
      bytes: sum.bytes + s.bytes,
      gzip: sum.gzip + s.gzip,
      brotli: sum.brotli + s.brotli,
    }),
    { bytes: 0, gzip: 0, brotli: 0 },
  );
const add = (...sizes: ReturnType<typeof total>[]) =>
  total(sizes.map((size) => ({ file: "", ...size })));

/** Manifest URLs are public paths (`/assets/js/x.js`); files live under dist/client. */
const toFile = (url: string) => url.replace(/^\/assets\//, "");

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`;
const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

let manifest: Manifest;
try {
  manifest = JSON.parse(
    await readFile(path.join(clientDir, "asset-manifest.json"), "utf8"),
  ) as Manifest;
} catch {
  console.error(`✗ ${path.relative(appDir, clientDir)} has no asset manifest: run \`pnpm build\`.`);
  process.exit(1);
}

const initialJs = await Promise.all(manifest.scripts.map((url) => sizeOf(toFile(url))));
const initialCss = await Promise.all(manifest.styles.map((url) => sizeOf(toFile(url))));
const routes = await Promise.all(
  Object.entries(manifest.routes ?? {}).map(async ([name, urls]) => ({
    name,
    files: await Promise.all(urls.map((url) => sizeOf(toFile(url)))),
  })),
);

const deferred = await Promise.all((manifest.preload ?? []).map((url) => sizeOf(toFile(url))));

const accounted = new Set(
  [...initialJs, ...deferred, ...routes.flatMap((r) => r.files)].map((s) => s.file),
);
const allJs = (await readdir(path.join(clientDir, "js")))
  .filter((name) => name.endsWith(".js"))
  .map((name) => `js/${name}`);
const otherLazy = await Promise.all(allJs.filter((file) => !accounted.has(file)).map(sizeOf));

const initial = total(initialJs);
const css = total(initialCss);
const after = total(deferred);

const failures: string[] = [];
if (initial.bytes > INITIAL_JS_BUDGET)
  failures.push(
    `Initial JS is ${kb(initial.bytes)}, over the ${kb(INITIAL_JS_BUDGET)} budget by ${kb(initial.bytes - INITIAL_JS_BUDGET)}.`,
  );
for (const route of routes) {
  const size = total(route.files).bytes;
  if (size > ROUTE_JS_BUDGET)
    failures.push(
      `Route "${route.name}" adds ${kb(size)}, over the ${kb(ROUTE_JS_BUDGET)} per-route budget.`,
    );
}

if (json) {
  process.stdout.write(
    `${JSON.stringify({ initialJs, initialCss, deferred, routes, otherLazy, initial, css, failures }, null, 2)}\n`,
  );
} else {
  const column = (text: string) => text.padStart(10);
  const row = (label: string, size: { bytes: number; gzip: number; brotli: number }) =>
    `  ${label.padEnd(44)} ${column(kb(size.bytes))} ${column(kib(size.gzip))} ${column(
      size.brotli > 0 ? kib(size.brotli) : "–",
    )}\n`;
  let out = `\nBundle report: ${path.relative(appDir, clientDir)}\n`;
  out += `  ${"".padEnd(44)} ${column("minified")} ${column("gzip -9")} ${column("brotli")}\n`;
  out += `\nInitial JavaScript (every page)\n`;
  for (const s of initialJs) out += row(s.file, s);
  out += row("Total", initial);
  out += `  ${"Budget".padEnd(44)} ${column(kb(INITIAL_JS_BUDGET))}\n`;
  out += `\nInitial CSS\n`;
  for (const s of initialCss) out += row(s.file, s);
  if (deferred.length > 0) {
    out += `\nPreloaded, run after hydration (every page)\n`;
    for (const s of deferred) out += row(s.file, s);
  }
  if (routes.length > 0) {
    out += `\nPer route (the page's own chunk)\n`;
    for (const route of routes) out += row(route.name, total(route.files));
    out += `\nEverything a first visit downloads (initial + preloaded + the route)\n`;
    for (const route of routes) out += row(route.name, add(initial, after, total(route.files)));
  }
  if (otherLazy.length > 0) {
    out += `\nOther lazy chunks (loaded on demand)\n`;
    for (const s of otherLazy) out += row(s.file, s);
  }
  process.stdout.write(`${out}\n`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`${check ? "✗" : "!"} ${failure}`);
  if (check) process.exit(1);
} else if (!json) {
  console.warn("✓ Within budget.");
}
