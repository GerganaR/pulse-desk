import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AssetManifest } from "@/lib/bootstrap";

const MANIFEST_NAME = "asset-manifest.json";

export class ManifestNotReadyError extends Error {
  constructor(source: string) {
    super(`Client asset manifest not available from ${source}. Is the client build running?`);
    this.name = "ManifestNotReadyError";
  }
}

export type ManifestSource =
  /** Production: the manifest written by `rspack build` next to the server bundle. */
  | { kind: "file"; clientDist: string }
  /**
   * Development: fetched from this instance's own Rspack dev server (served from memory).
   * Nothing is shared on disk, so concurrent dev instances on different ports can't
   * overwrite each other's asset URLs.
   */
  | { kind: "dev-server"; origin: string };

/**
 * Production: read once and cache — assets are immutable for the lifetime of the process.
 * Development: re-read on every request because the dev server recompiles continuously.
 */
export function createManifestLoader(source: ManifestSource, { cache }: { cache: boolean }) {
  let cached: Promise<AssetManifest> | undefined;

  const load =
    source.kind === "file"
      ? () => loadFile(source.clientDist)
      : () => loadFromDevServer(source.origin);

  return function getManifest(): Promise<AssetManifest> {
    if (!cache) return load();
    cached ??= load().catch((error: unknown) => {
      cached = undefined; // don't cache failures
      throw error;
    });
    return cached;
  };
}

async function loadFile(clientDist: string): Promise<AssetManifest> {
  const file = path.join(clientDist, MANIFEST_NAME);
  try {
    return JSON.parse(await readFile(file, "utf8")) as AssetManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ManifestNotReadyError(file);
    throw error;
  }
}

async function loadFromDevServer(origin: string): Promise<AssetManifest> {
  const url = `${origin}/${MANIFEST_NAME}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new ManifestNotReadyError(url); // dev server not listening yet
  }
  // The dev middleware waits for an in-progress compile, so 404 means "not emitted yet".
  if (!response.ok) throw new ManifestNotReadyError(url);
  return (await response.json()) as AssetManifest;
}
