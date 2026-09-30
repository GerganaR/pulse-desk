import { Card, EmptyState } from "@pulsedesk/ui";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export function SessionsPage() {
  return (
    <>
      <PageHeader title="Sessions" description="Every active and recent visitor session." />
      <Card>
        <EmptyState
          icon={<Users className="size-5" />}
          title="No sessions to show"
          description="When visitors browse your site, their sessions are listed here in real time."
        />
      </Card>
    </>
  );
}
