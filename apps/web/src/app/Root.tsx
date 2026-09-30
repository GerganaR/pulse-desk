import { StrictMode, type ReactNode } from "react";
import type { AssetManifest } from "@/lib/bootstrap";
import { Document } from "./Document";

export interface RootProps {
  assets: AssetManifest;
  /** The router — StaticRouter on the server, BrowserRouter on the client. */
  children: ReactNode;
}

/**
 * The single tree both entry points render. Server and client must produce identical
 * markup, so everything except the router implementation lives here — providers added
 * later (store, config) are added once, not twice.
 */
export function Root({ assets, children }: RootProps) {
  return (
    <StrictMode>
      <Document assets={assets}>{children}</Document>
    </StrictMode>
  );
}
