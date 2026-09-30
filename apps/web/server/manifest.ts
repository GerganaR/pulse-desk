import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AssetManifest } from "@/lib/bootstrap";

export class ManifestNotReadyError extends Error {
  constructor(file: string) {
    super(`Client asset manifest not found at ${file}. Is the client build running?`);
    this.name = "ManifestNotReadyError";
  }
}

/**
 * Production: read once and cache — assets are immutable for the lifetime of the process.
 * Development: re-read on every request because the dev server rewrites it after each
 * compile (cheap: a tiny local file).
 */
export function createManifestLoader(clientDist: string, { cache }: { cache: boolean }) {
  const file = path.join(clientDist, "asset-manifest.json");
  let cached: Promise<AssetManifest> | undefined;

  async function load(): Promise<AssetManifest> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as AssetManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ManifestNotReadyError(file);
      throw error;
    }
  }

  return function getManifest(): Promise<AssetManifest> {
    if (!cache) return load();
    cached ??= load().catch((error: unknown) => {
      cached = undefined; // don't cache failures
      throw error;
    });
    return cached;
  };
}
