import type { PulseStore } from "@pulsedesk/state";
import { renderToPipeableStream, type RenderToPipeableStreamOptions } from "react-dom/server";
import { StaticRouter } from "react-router";
import { App } from "@/app/App";
import { Root } from "@/app/Root";
import type { ThemePreference } from "@/app/theme";
import type { AssetManifest, PublicConfig } from "@/lib/bootstrap";

export { preloadAllRoutes, resolveRouteHandle } from "@/app/routes";

export interface RenderOptions extends RenderToPipeableStreamOptions {
  url: string;
  assets: AssetManifest;
  config: PublicConfig;
  store: PulseStore;
  now: number;
  theme: ThemePreference;
}

/** Server counterpart of entry-client.tsx: same <Root>, different router. */
export function render({ url, assets, config, store, now, theme, ...options }: RenderOptions) {
  return renderToPipeableStream(
    <Root assets={assets} config={config} store={store} now={now} theme={theme}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </Root>,
    options,
  );
}
