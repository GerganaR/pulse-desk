import { act, Suspense, useState, type ComponentType } from "react";
import { hydrateRoot, type Root as ReactRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteBoundary } from "@/components/shell/RouteBoundary";
import { lazyRoute, type LazyRoute } from "./lazy-route";

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {label} {count}
    </button>
  );
}

const Page = () => <Counter label="page" />;

/** A loader the test resolves or rejects by hand, like a chunk still on the network. */
function deferredLoader() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<{ default: ComponentType }>((res, rej) => {
    resolve = () => res({ default: Page });
    reject = rej;
  });
  return { load: vi.fn(() => pending), resolve, reject };
}

function Shell({ route: Route }: { route: LazyRoute }) {
  return (
    <div>
      <Counter label="shell" />
      <Suspense fallback={<p>Loading page</p>}>
        <Route />
      </Suspense>
    </div>
  );
}

const button = (name: RegExp) =>
  [...document.querySelectorAll("button")].find((b) => name.test(b.textContent));

let root: ReactRoot | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("lazyRoute", () => {
  it("server-renders a preloaded route without a fallback", async () => {
    const route = lazyRoute(() => Promise.resolve({ default: Page }));
    await route.preload();

    const html = renderToString(<Shell route={route} />);

    expect(html).toContain("page");
    expect(html).not.toContain("Loading page");
  });

  it("renders the fallback on the server when the route was never preloaded", () => {
    // The control for the test above: without preload(), React.lazy suspends.
    const route = lazyRoute(() => Promise.resolve({ default: Page }));
    expect(renderToString(<Shell route={route} />)).toContain("Loading page");
  });

  it("hydrates the shell first, then the page when its chunk arrives", async () => {
    const consoleError = vi.spyOn(console, "error");
    const server = lazyRoute(() => Promise.resolve({ default: Page }));
    await server.preload();
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Shell route={server} />);
    document.body.append(container);

    // The browser's copy of the route: its chunk hasn't loaded yet.
    const chunk = deferredLoader();
    const recoverable: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, <Shell route={lazyRoute(chunk.load)} />, {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });

    // The server's HTML for the page is still there, and the shell already works.
    expect(button(/page/)?.textContent).toBe("page 0");
    expect(document.body.textContent).not.toContain("Loading page");
    await act(async () => button(/shell/)?.click());
    expect(button(/shell/)?.textContent).toBe("shell 1");
    // The page isn't hydrated yet: its click handler isn't attached.
    await act(async () => button(/page/)?.click());
    expect(button(/page/)?.textContent).toBe("page 0");

    await act(async () => {
      chunk.resolve();
      await Promise.resolve();
    });
    await act(async () => button(/page/)?.click());

    expect(button(/page/)?.textContent).toBe("page 1");
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("loads the chunk once, however often it is preloaded or rendered", async () => {
    const load = vi.fn(() => Promise.resolve({ default: Page }));
    const route = lazyRoute(load);
    await Promise.all([route.preload(), route.preload()]);
    renderToString(<Shell route={route} />);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("can retry a preload that failed", async () => {
    const load = vi
      .fn<() => Promise<{ default: ComponentType }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Page });
    const route = lazyRoute(load);

    await expect(route.preload()).rejects.toThrow("offline");
    await route.preload();

    expect(renderToString(<Shell route={route} />)).toContain("page");
  });
});

describe("RouteBoundary", () => {
  it("keeps the shell and explains when a page chunk fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const chunk = deferredLoader();
    const Route = lazyRoute(chunk.load);
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = hydrateRoot(
        container,
        <MemoryRouter>
          <Counter label="shell" />
          <RouteBoundary>
            <Route />
          </RouteBoundary>
        </MemoryRouter>,
        { onRecoverableError: () => {} },
      );
    });
    await act(async () => {
      chunk.reject(new Error("Loading chunk route-x failed"));
      await Promise.resolve();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "This page couldn't be loaded",
    );
    expect(button(/Reload/)).toBeDefined();
    await act(async () => button(/shell/)?.click());
    expect(button(/shell/)?.textContent).toBe("shell 1");
  });
});
