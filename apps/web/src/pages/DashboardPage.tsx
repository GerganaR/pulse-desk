import { Card, EmptyState } from "@pulsedesk/ui";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live overview of visitor sessions across your site."
      />
      <Card>
        <EmptyState
          icon={<Activity className="size-5" />}
          title="No live sessions yet"
          description="Sessions appear here the moment visitors land on your site."
        />
      </Card>
    </>
  );
}
