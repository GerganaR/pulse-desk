import { Navigate, matchRoutes, type RouteObject } from "react-router";
import { AppShell } from "@/components/shell/AppShell";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { lazyRoute, type LazyRoute } from "./lazy-route";

/**
 * Each page is its own chunk: a visitor to the dashboard doesn't download the session
 * timeline, and the other way round. The chunk names are the keys of `routes` in the
 * asset manifest, which is how the server knows which script to send with a page.
 */
const pages = {
  dashboard: lazyRoute(() =>
    import(/* webpackChunkName: "route-dashboard" */ "@/pages/DashboardPage").then((m) => ({
      default: m.DashboardPage,
    })),
  ),
  sessions: lazyRoute(() =>
    import(/* webpackChunkName: "route-sessions" */ "@/pages/SessionsPage").then((m) => ({
      default: m.SessionsPage,
    })),
  ),
  "session-detail": lazyRoute(() =>
    import(/* webpackChunkName: "route-session-detail" */ "@/pages/SessionDetailPage").then(
      (m) => ({ default: m.SessionDetailPage }),
    ),
  ),
} satisfies Record<string, LazyRoute>;

export type RouteChunk = keyof typeof pages;

/** Route metadata the SSR server needs before rendering. */
export interface RouteHandle {
  status?: number;
  redirect?: string;
  /** The lazy chunk this route renders, if any. */
  chunk?: RouteChunk;
}

const page = (chunk: RouteChunk) => {
  const Page = pages[chunk];
  return { element: <Page />, handle: { chunk } satisfies RouteHandle };
};

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
    handle: { redirect: "/dashboard" } satisfies RouteHandle,
  },
  {
    element: <AppShell />,
    children: [
      { path: "dashboard", ...page("dashboard") },
      { path: "sessions", ...page("sessions") },
      { path: "sessions/:sessionId", ...page("session-detail") },
      // Small, and the answer to any mistyped URL: not worth a round trip.
      { path: "*", element: <NotFoundPage />, handle: { status: 404 } satisfies RouteHandle },
    ],
  },
];

/**
 * Resolve HTTP-level routing concerns (status code, redirects, which chunk to send) from
 * the same route table the client renders, so the server can't drift from the UI.
 */
export function resolveRouteHandle(
  pathname: string,
): Required<Pick<RouteHandle, "status">> & RouteHandle {
  const matches = matchRoutes(routes, pathname) ?? [];
  const handle = matches.reduce<RouteHandle>(
    (acc, match) => ({ ...acc, ...(match.route.handle as RouteHandle | undefined) }),
    {},
  );
  return { status: 200, ...handle };
}

/** Load every page chunk: at server startup, and in the browser once it is idle. */
export async function preloadAllRoutes(): Promise<void> {
  await Promise.all(Object.values(pages).map((route) => route.preload()));
}

/** Load the chunk for one URL, e.g. before rendering it in a test. */
export async function preloadRouteFor(pathname: string): Promise<void> {
  const { chunk } = resolveRouteHandle(pathname);
  if (chunk) await pages[chunk].preload();
}
