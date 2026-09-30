import { createContext, use, useState, type ReactNode } from "react";
import { useConfig } from "@/app/config";
import { createAIFaultSwitch, type AIFaultSwitch } from "@/features/devtools/ai-faults";

const AIFaultsContext = createContext<AIFaultSwitch | null>(null);

/**
 * Shares the dev AI fault switch between the reliability panel (which sets it) and the
 * copilot (which sends it). `__DEVTOOLS__` is a build-time constant, so a production
 * build has `null` here and never includes the switch.
 */
export function AIFaultsProvider({ children }: { children: ReactNode }) {
  const { devTools } = useConfig();
  const [faults] = useState(() => (__DEVTOOLS__ && devTools ? createAIFaultSwitch() : null));
  return <AIFaultsContext value={faults}>{children}</AIFaultsContext>;
}

/** Null unless this is a devtools build with devtools enabled. */
export function useAIFaults(): AIFaultSwitch | null {
  return use(AIFaultsContext);
}
