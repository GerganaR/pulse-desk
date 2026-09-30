import { Card, EmptyState, buttonStyles } from "@pulsedesk/ui";
import { SearchX } from "lucide-react";
import { Link, useParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();

  return (
    <>
      <PageHeader title="Session" description={<span className="font-mono">{sessionId}</span>} />
      <Card>
        <EmptyState
          icon={<SearchX className="size-5" />}
          title="Session unavailable"
          description="This session has no recorded activity yet."
          action={
            <Link to="/sessions" className={buttonStyles()}>
              Back to sessions
            </Link>
          }
        />
      </Card>
    </>
  );
}
