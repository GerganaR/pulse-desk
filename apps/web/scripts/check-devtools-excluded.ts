/**
 * Proves the developer reliability tooling is absent from the production build.
 *
 *   node scripts/check-devtools-excluded.ts            checks dist/ (and dist-devtools/ if built)
 *   node scripts/check-devtools-excluded.ts --strict   dist-devtools/ must exist too (CI)
 *
 * Every devtools module carries the marker "pulsedesk-devtools" in a string it uses at
 * runtime, so minification keeps it. Source maps are scanned too: a module that was
 * bundled and then minified away would still show up in `sourcesContent`, so a clean
 * result means the modules never entered the production module graph at all.
 *
 * The devtools build is the control: it must contain the marker. That proves the check
 * can find what it's looking for, so a pass on dist/ means something.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MARKER = "pulsedesk-devtools";
const appDir = path.resolve(import.meta.dirname, "..");
const strict = process.argv.includes("--strict");

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(js|mjs|css|map|json|html)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

async function filesWithMarker(dir: string): Promise<string[] | null> {
  let files: string[];
  try {
    files = await filesUnder(dir);
  } catch {
    return null; // not built
  }
  if (files.length === 0) return null;
  const hits: string[] = [];
  for (const file of files) {
    if ((await readFile(file, "utf8")).includes(MARKER)) hits.push(path.relative(appDir, file));
  }
  return hits;
}

let failed = false;

const production = await filesWithMarker(path.join(appDir, "dist"));
if (production === null) {
  console.error("✗ dist/ is missing: run `pnpm build` first.");
  failed = true;
} else if (production.length > 0) {
  console.error(`✗ Devtools code found in the production build:\n  ${production.join("\n  ")}`);
  failed = true;
} else {
  console.warn("✓ Production build (dist/) contains no devtools code.");
}

const control = await filesWithMarker(path.join(appDir, "dist-devtools"));
if (control === null) {
  const message = "dist-devtools/ is missing: run `pnpm build:devtools` for the control check.";
  if (strict) {
    console.error(`✗ ${message}`);
    failed = true;
  } else {
    console.warn(`! ${message}`);
  }
} else if (control.length === 0) {
  console.error(`✗ The devtools build has no "${MARKER}" marker, so this check proves nothing.`);
  failed = true;
} else {
  console.warn(`✓ Control: the devtools build contains the marker (${control.length} files).`);
}

process.exit(failed ? 1 : 0);
