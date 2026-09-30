import { renderToPipeableStream, type RenderToPipeableStreamOptions } from "react-dom/server";
import { StaticRouter } from "react-router";
import { App } from "@/app/App";
import { Root } from "@/app/Root";
import type { AssetManifest } from "@/lib/bootstrap";

export { resolveRouteHandle } from "@/app/routes";

export interface RenderOptions extends RenderToPipeableStreamOptions {
  url: string;
  assets: AssetManifest;
}

/** Server counterpart of entry-client.tsx: same <Root>, different router. */
export function render({ url, assets, ...options }: RenderOptions) {
  return renderToPipeableStream(
    <Root assets={assets}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </Root>,
    options,
  );
}
