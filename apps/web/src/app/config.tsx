import { createContext, use, type ReactNode } from "react";
import type { PublicConfig } from "@/lib/bootstrap";

const ConfigContext = createContext<PublicConfig | null>(null);

/** Runtime config injected by the server (same value during SSR and hydration). */
export function ConfigProvider({
  config,
  children,
}: {
  config: PublicConfig;
  children: ReactNode;
}) {
  return <ConfigContext value={config}>{children}</ConfigContext>;
}

export function useConfig(): PublicConfig {
  const config = use(ConfigContext);
  if (!config) throw new Error("useConfig() requires <ConfigProvider>");
  return config;
}
