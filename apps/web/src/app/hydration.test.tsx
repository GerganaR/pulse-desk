import {
  createPulseStore,
  snapshotReceived,
  type PulseApi,
  type RootState,
} from "@pulsedesk/state";
import { generateSessions } from "@pulsedesk/test-utils";
import { act } from "react";
import { hydrateRoot, type Root as ReactRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { BrowserRouter, StaticRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AssetManifest, PublicConfig } from "@/lib/bootstrap";
import { App } from "./App";
import { Root } from "./Root";
import { preloadAllRoutes, resolveRouteHandle } from "./routes";
import type { ThemePreference } from "./theme";

const assets: AssetManifest = { scripts: [], styles: ["/assets/css/main.css"] };
const SERVER_NOW = 1_760_000_000_000;
const sessions = generateSessions({ now: SERVER_NOW, seed: 42 });

const pending = () => new Promise<never>(() => {});
const api: PulseApi = { fetchSessionsSnapshot: pending, fetchSessionDetail: pending };
const config: PublicConfig = {
  gatewayUrl: "ws://gateway.test/ws",
  devTools: false,
  eventBatchMs: 32,
};

/** Inert WebSocket: hydration starts the realtime provider, but tests never touch the network. */
class SilentWebSocket {
  readyState = 0;
  addEventListener() {}
  send() {}
  close() {}
}

function storeFrom(preloadedState?: Partial<RootState>) {
  return createPulseStore({ preloadedState, extra: { api } });
}

interface RenderInput {
  url: string;
  theme?: ThemePreference;
  loaded?: boolean;
}

/** Mirrors server/ssr.ts: per-request store, server clock, then serialise state. */
function serverRender({ url, theme = "system", loaded = true }: RenderInput) {
  const store = storeFrom();
  if (loaded) store.dispatch(snapshotReceived({ streamId: "stream-1", sequence: 0, sessions }));
  const html = renderToString(
    <Root assets={assets} config={config} store={store} now={SERVER_NOW} theme={theme}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </Root>,
  );
  // Round-trip through JSON exactly like the bootstrap script does.
  const preloadedState = JSON.parse(JSON.stringify(store.getState())) as RootState;
  return { html, preloadedState };
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

async function hydrateAt(
  clientUrl: string,
  preloadedState: RootState,
  theme: ThemePreference = "system",
) {
  vi.stubGlobal("WebSocket", SilentWebSocket);
  window.history.replaceState(null, "", clientUrl);
  const recoverableErrors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(
      document,
      <Root
        assets={assets}
        config={config}
        store={storeFrom(preloadedState)}
        now={SERVER_NOW}
        theme={theme}
      >
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Pages are lazy chunks. The server loads them all before it accepts requests, and the
// browser has the page's chunk among its initial scripts; the tests start from the same
// place. Hydrating before a chunk has arrived is covered in lazy-route.test.tsx.
beforeAll(preloadAllRoutes);

describe("SSR hydration", () => {
  it.each([
    "/dashboard",
    "/sessions",
    "/sessions?status=active&q=pricing",
    `/sessions/${sessions[0]!.id}`,
    "/sessions/ses_missing",
    "/does-not-exist",
  ])("hydrates %s with live data without mismatches", async (url) => {
    // Time passes between the server render and hydration (network, JS download, a slow
    // device). Relative times ("now", "12s ago") must still hydrate identically: they use
    // the server's clock until hydration completes, then switch to the browser's.
    vi.useFakeTimers({ toFake: ["Date"], now: SERVER_NOW });
    const consoleError = vi.spyOn(console, "error");
    const { html, preloadedState } = serverRender({ url });
    loadDocument(html);
    vi.setSystemTime(SERVER_NOW + 7_000);

    const errors = await hydrateAt(url, preloadedState);

    expect(errors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(document.querySelector("h1")).not.toBeNull();
  });

  it("hydrates the loading state when SSR skipped data (budget exceeded)", async () => {
    const consoleError = vi.spyOn(console, "error");
    const { html, preloadedState } = serverRender({ url: "/dashboard", loaded: false });
    loadDocument(html);
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);

    const errors = await hydrateAt("/dashboard", preloadedState);
    expect(errors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("server-renders the theme preference onto <html> (no flash of wrong theme)", async () => {
    const { html, preloadedState } = serverRender({ url: "/dashboard", theme: "dark" });
    loadDocument(html);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(await hydrateAt("/dashboard", preloadedState, "dark")).toEqual([]);
  });

  it("detects a mismatch (negative control — proves the harness works)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { html, preloadedState } = serverRender({ url: "/sessions" });
    loadDocument(html);

    const errors = await hydrateAt("/dashboard", preloadedState);

    expect(errors.length).toBeGreaterThan(0);
  });

  it("server-renders the page title into <head>", () => {
    loadDocument(serverRender({ url: "/sessions" }).html);
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

  it.each([
    ["/dashboard", "dashboard"],
    ["/sessions", "sessions"],
    ["/sessions/abc", "session-detail"],
  ])("returns 200 and the page's chunk for %s", (path, chunk) => {
    expect(resolveRouteHandle(path)).toEqual({ status: 200, chunk });
  });

  it("names no chunk for pages in the main bundle", () => {
    expect(resolveRouteHandle("/nope").chunk).toBeUndefined();
  });
});
