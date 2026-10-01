// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStaticHandler } from "./static";

let directory: string;
let server: http.Server;
let origin: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "pulsedesk-static-"));
  await mkdir(path.join(directory, "js"));
  await writeFile(path.join(directory, "js", "main.abc123.js"), "console.log('main')");
  // A sibling the handler must never reach.
  await writeFile(`${directory}-secret`, "secret");

  // Production settings: sirv lists the directory now, at startup.
  const handle = createStaticHandler(directory, { immutable: true, maxAge: 31_536_000 });
  server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?", 1)[0] ?? "/";
    void handle(req, res, pathname, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
  await rm(`${directory}-secret`, { force: true });
});

describe("static file handler", () => {
  it("serves a file with immutable caching", async () => {
    const response = await fetch(`${origin}/js/main.abc123.js?v=1`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("console.log('main')");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("serves the precompressed copy when the client accepts it", async () => {
    // Its own directory: the variants must exist when the handler lists the files.
    const compressed = await mkdtemp(path.join(os.tmpdir(), "pulsedesk-static-br-"));
    await writeFile(path.join(compressed, "app.js"), "console.log('plain')");
    await writeFile(path.join(compressed, "app.js.br"), brotliCompressSync("console.log('br')"));
    await writeFile(path.join(compressed, "app.js.gz"), gzipSync("console.log('gz')"));
    const handle = createStaticHandler(compressed, { brotli: true, gzip: true });
    const second = http.createServer((req, res) => {
      void handle(req, res, req.url ?? "/", () => res.writeHead(404).end());
    });
    await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(second.address() as AddressInfo).port}/app.js`;
    try {
      // fetch() decodes the body; the header says which copy was sent.
      const brotli = await fetch(url, { headers: { "Accept-Encoding": "br, gzip" } });
      expect(brotli.headers.get("content-encoding")).toBe("br");
      expect(await brotli.text()).toBe("console.log('br')");
      expect(brotli.headers.get("vary")).toContain("Accept-Encoding");

      const gzip = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
      expect(gzip.headers.get("content-encoding")).toBe("gzip");
      expect(await gzip.text()).toBe("console.log('gz')");

      const plain = await fetch(url, { headers: { "Accept-Encoding": "identity" } });
      expect(plain.headers.get("content-encoding")).toBeNull();
      expect(await plain.text()).toBe("console.log('plain')");
    } finally {
      await new Promise((resolve) => second.close(resolve));
      await rm(compressed, { recursive: true, force: true });
    }
  });

  it("answers 404 for a file that was removed after startup, and keeps serving", async () => {
    await rm(path.join(directory, "js", "main.abc123.js"));
    await writeFile(path.join(directory, "js", "other.def456.js"), "console.log('other')");

    // Without the existence check this request crashed the process (unhandled stream
    // error), so every request after it failed too.
    expect((await fetch(`${origin}/js/main.abc123.js`)).status).toBe(404);
    expect((await fetch(`${origin}/js/main.abc123.js`)).status).toBe(404);
    expect((await fetch(`${origin}/js/missing.js`)).status).toBe(404);
  });

  it("answers 404 for a directory and for a malformed path", async () => {
    expect((await fetch(`${origin}/js`)).status).toBe(404);
    expect((await fetch(`${origin}/js/%E0%A4%A.js`)).status).toBe(404);
  });

  it("never serves anything outside the directory", async () => {
    const outside = `/..%2F${path.basename(directory)}-secret`;
    const response = await fetch(origin + outside);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("secret");
  });
});
