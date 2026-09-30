import type { PulseStore } from "@pulsedesk/state";
import { useState } from "react";
import { useAppStore } from "@/app/hooks";
import { createAIRunner, type AIRunner } from "./ai-runner";
import { useAIFaults } from "./AIFaultsProvider";

// One runner per store (per tab), shared by every copilot panel and outliving them, so
// an answer keeps streaming while the agent looks at another page.
const runners = new WeakMap<PulseStore, AIRunner>();

export function useAIRunner(): AIRunner {
  const store = useAppStore();
  const faults = useAIFaults();
  const [runner] = useState(() => {
    let existing = runners.get(store);
    if (!existing) {
      existing = createAIRunner({
        dispatch: store.dispatch,
        getState: store.getState,
        getHeaders: () => faults?.headers() ?? {},
      });
      runners.set(store, existing);
    }
    return existing;
  });
  return runner;
}
