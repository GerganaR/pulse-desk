import { lazy, type ComponentType, type ReactNode } from "react";

export interface LazyRoute {
  (): ReactNode;
  /** Load the route's chunk. Safe to call repeatedly; a failed load can be retried. */
  preload(): Promise<void>;
}

/**
 * A route component in its own chunk, which still server-renders in the first flush.
 *
 * `React.lazy` alone always suspends once, even when its module is already loaded, so on
 * the server the page would stream in behind a fallback and need JavaScript to appear.
 * Here a loaded module is rendered directly:
 *
 * - Server: every route is preloaded at startup, so pages render synchronously into the
 *   shell (the HTML is complete without JavaScript).
 * - Browser, first load: the server adds the route's chunk to the page's scripts. If it
 *   has run by the time React hydrates, the page hydrates in the same pass. If not, the
 *   Suspense boundary around the route stays as server HTML and hydrates when the chunk
 *   arrives (selective hydration); the shell is interactive meanwhile.
 * - Browser, navigation: the router updates inside a transition, so the current page
 *   stays on screen until the next route's chunk has loaded.
 */
export function lazyRoute(load: () => Promise<{ default: ComponentType }>): LazyRoute {
  let Loaded: ComponentType | undefined;
  let loading: Promise<{ default: ComponentType }> | undefined;

  const loadOnce = () =>
    (loading ??= load().then(
      (module) => {
        Loaded = module.default;
        return module;
      },
      (error: unknown) => {
        loading = undefined; // a failed download (offline, a deploy) can be retried
        throw error;
      },
    ));

  const Lazy = lazy(loadOnce);

  function Route() {
    const Component = Loaded ?? Lazy;
    return <Component />;
  }
  Route.preload = async () => {
    await loadOnce();
  };
  return Route;
}
