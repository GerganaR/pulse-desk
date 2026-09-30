import { ACTIVITY_BUCKET_MS, alignToActivityBucket, selectSessionActivity } from "@pulsedesk/state";
import { Button, Card, CardContent, CardHeader, Skeleton } from "@pulsedesk/ui";
import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { useAppSelector } from "@/app/hooks";
import { useNow } from "@/lib/clock";
import { ActivityChart, ActivityTable } from "./ActivityChart";

export function ActivityCard({ loading, className }: { loading: boolean; className?: string }) {
  // Bucket-granular clock: this card re-renders when a 5-minute boundary passes, not every second.
  const alignedNow = alignToActivityBucket(useNow(ACTIVITY_BUCKET_MS));
  const buckets = useAppSelector((state) => selectSessionActivity(state, alignedNow));
  // Chart vs table is a view preference for this card only: local state, not Redux.
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <Card className={className}>
      <CardHeader
        title="Visitor activity"
        description="Sessions started per 5 minutes, last hour"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            aria-pressed={view === "table"}
            leadingIcon={
              view === "chart" ? (
                <Table2 aria-hidden="true" className="size-3.5" />
              ) : (
                <BarChart3 aria-hidden="true" className="size-3.5" />
              )
            }
          >
            {view === "chart" ? "Table" : "Chart"}
          </Button>
        }
      />
      <CardContent aria-busy={loading || undefined}>
        {loading ? (
          <Skeleton className="h-44 w-full" />
        ) : view === "chart" ? (
          <ActivityChart buckets={buckets} alignedNow={alignedNow} />
        ) : (
          <ActivityTable buckets={buckets} alignedNow={alignedNow} />
        )}
      </CardContent>
    </Card>
  );
}
