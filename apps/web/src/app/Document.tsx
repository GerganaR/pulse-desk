import type { ReactNode } from "react";
import type { AssetManifest } from "@/lib/bootstrap";
import { useTheme } from "./theme";

export interface DocumentProps {
  assets: AssetManifest;
  children: ReactNode;
}

/**
 * The full HTML document, rendered by React on the server and hydrated with
 * `hydrateRoot(document, …)` on the client. Rendering the whole document (rather than
 * string-templating a shell around a #root div) lets React 19 own <head>: pages declare
 * <title>/<meta> inline and React hoists them, and stylesheets with `precedence` are
 * deduplicated and ordered by React.
 */
export function Document({ assets, children }: DocumentProps) {
  const { theme } = useTheme();
  return (
    // "system" leaves the attribute off so the CSS media query decides.
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta
          name="description"
          content="PulseDesk — monitor live website sessions and get AI-assisted context in real time."
        />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {assets.styles.map((href) => (
          <link key={href} rel="stylesheet" href={href} precedence="default" />
        ))}
        {/*
          Fetched alongside the page's scripts, run after hydration. Low priority, like
          React's own script preloads: at the default (high) these competed with the
          stylesheet on a slow connection and delayed first paint by about 200 ms.
        */}
        {assets.preload?.map((href) => (
          <link key={href} rel="preload" as="script" href={href} fetchPriority="low" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
