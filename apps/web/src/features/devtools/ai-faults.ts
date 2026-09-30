import { AI_FAULT_HEADER, type AIFault } from "@pulsedesk/contracts";

/**
 * The reliability panel's AI fault selector. While a fault is selected, every copilot
 * request carries it as a header; devtools web builds forward it and an ai-service
 * started with AI_DEBUG=1 acts on it (see ai-service `faults.ts`).
 *
 * Development and devtools builds only (created behind `__DEVTOOLS__`); carries the
 * marker the production bundle check looks for.
 */
const MARKER = "pulsedesk-devtools";

export interface AIFaultSwitch {
  readonly origin: string;
  get(): AIFault | null;
  set(fault: AIFault | null): void;
  subscribe(listener: () => void): () => void;
  /** Headers to add to the next request. */
  headers(): Record<string, string>;
}

export function createAIFaultSwitch(): AIFaultSwitch {
  let fault: AIFault | null = null;
  const listeners = new Set<() => void>();
  return {
    origin: MARKER,
    get: () => fault,
    set(next) {
      fault = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    headers(): Record<string, string> {
      return fault ? { [AI_FAULT_HEADER]: fault } : {};
    },
  };
}
