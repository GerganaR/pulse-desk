import { Navigate, matchRoutes, type RouteObject } from "react-router";
import { AppShell } from "@/components/shell/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { SessionDetailPage } from "@/pages/SessionDetailPage";
import { SessionsPage } from "@/pages/SessionsPage";

/** Route metadata the SSR server needs before rendering. */
export interface RouteHandle {
  status?: number;
  redirect?: string;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
    handle: { redirect: "/dashboard" } satisfies RouteHandle,
  },
  {
    element: <AppShell />,
    children: [
      { path: "dashboard", element: <DashboardPage /> },
      { path: "sessions", element: <SessionsPage /> },
      { path: "sessions/:sessionId", element: <SessionDetailPage /> },
      { path: "*", element: <NotFoundPage />, handle: { status: 404 } satisfies RouteHandle },
    ],
  },
];

/**
 * Resolve HTTP-level routing concerns (status code, redirects) from the same route table
 * the client renders, so the server can't drift from the UI.
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
