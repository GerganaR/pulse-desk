import { Badge, Panel, Skeleton } from "@pulsedesk/ui";
import { lazy, Suspense } from "react";
import { useHydrated } from "@/lib/use-hydrated";

// The copilot is interactive only, so its code (conversation UI, streaming client,
// runner) is a separate chunk loaded after hydration, not part of the initial bundle.
const CopilotPanel = lazy(() => import("./CopilotPanel"));

function CopilotSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col">
      <div className="flex-1 space-y-3 p-4">
        <Skeleton className="ml-auto h-8 w-1/2 rounded-2xl" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <div className="space-y-3 border-t border-line p-3">
        <div className="flex gap-1.5">
          {["w-20", "w-28", "w-24"].map((width) => (
            <Skeleton key={width} className={`h-7 rounded-full ${width}`} />
          ))}
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** The session page's copilot column. */
export function Copilot({ sessionId, className }: { sessionId: string; className?: string }) {
  const hydrated = useHydrated();
  return (
    <Panel
      title="Copilot"
      headingId="session-copilot-heading"
      meta={<Badge tone="accent">AI</Badge>}
      className={className}
      bodyClassName="flex flex-col overflow-hidden"
    >
      {hydrated ? (
        <Suspense fallback={<CopilotSkeleton />}>
          <CopilotPanel sessionId={sessionId} />
        </Suspense>
      ) : (
        <CopilotSkeleton />
      )}
    </Panel>
  );
}
