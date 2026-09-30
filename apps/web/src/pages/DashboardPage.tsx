import { PageHeader } from "@/components/PageHeader";
import { ActivityCard } from "@/features/dashboard/ActivityCard";
import { LivePagesCard } from "@/features/dashboard/LivePagesCard";
import { RecentSessionsCard } from "@/features/dashboard/RecentSessionsCard";
import { StatsGrid } from "@/features/dashboard/StatsGrid";
import { SessionsLoadError } from "@/features/sessions/SessionsLoadError";
import { useSessionsSnapshot } from "@/features/sessions/useSessionsSnapshot";
import { Card } from "@pulsedesk/ui";

export function DashboardPage() {
  const { isLoading, status, error, retry } = useSessionsSnapshot();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live overview of visitor sessions across your site."
      />
      {status === "error" ? (
        <Card>
          <SessionsLoadError error={error} onRetry={retry} />
        </Card>
      ) : (
        <div className="space-y-4 lg:space-y-6">
          <StatsGrid loading={isLoading} />
          <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
            <ActivityCard loading={isLoading} className="lg:col-span-2" />
            <LivePagesCard loading={isLoading} />
          </div>
          <RecentSessionsCard loading={isLoading} />
        </div>
      )}
    </>
  );
}
