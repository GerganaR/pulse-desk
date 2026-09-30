import { act } from "react";
import { hydrateRoot, type Root as ReactRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { BrowserRouter, StaticRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetManifest } from "@/lib/bootstrap";
import { App } from "./App";
import { Root } from "./Root";
import { resolveRouteHandle } from "./routes";

const assets: AssetManifest = { scripts: [], styles: ["/assets/css/main.css"] };

function serverRender(url: string): string {
  return renderToString(
    <Root assets={assets}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </Root>,
  );
}

/** Load server HTML as the live jsdom document, like a browser receiving the response. */
function loadDocument(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const target = document.documentElement;
  for (const { name } of [...target.attributes]) target.removeAttribute(name);
  for (const { name, value } of [...parsed.documentElement.attributes])
    target.setAttribute(name, value);
  target.innerHTML = parsed.documentElement.innerHTML;
}

let root: ReactRoot | undefined;

async function hydrateAt(clientUrl: string) {
  window.history.replaceState(null, "", clientUrl);
  const recoverableErrors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(
      document,
      <Root assets={assets}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Root>,
      { onRecoverableError: (error) => recoverableErrors.push(error) },
    );
  });
  return recoverableErrors;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});

describe("SSR hydration", () => {
  it.each(["/dashboard", "/sessions", "/sessions/ses_123", "/does-not-exist"])(
    "hydrates %s without mismatches",
    async (url) => {
      const consoleError = vi.spyOn(console, "error");
      loadDocument(serverRender(url));

      const errors = await hydrateAt(url);

      expect(errors).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
      expect(document.querySelector("h1")).not.toBeNull();
    },
  );

  it("detects a mismatch (negative control — proves the harness works)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadDocument(serverRender("/sessions"));

    const errors = await hydrateAt("/dashboard");

    expect(errors.length).toBeGreaterThan(0);
  });

  it("server-renders the page title into <head>", () => {
    loadDocument(serverRender("/sessions"));
    expect(document.title).toBe("Sessions · PulseDesk");
  });
});

describe("resolveRouteHandle", () => {
  it("redirects the root to the dashboard", () => {
    expect(resolveRouteHandle("/")).toMatchObject({ redirect: "/dashboard" });
  });

  it("returns 404 for unknown paths", () => {
    expect(resolveRouteHandle("/nope").status).toBe(404);
  });

  it.each(["/dashboard", "/sessions", "/sessions/abc"])("returns 200 for %s", (path) => {
    expect(resolveRouteHandle(path)).toEqual({ status: 200 });
  });
});
