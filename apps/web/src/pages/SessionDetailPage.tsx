import { selectSessionById } from "@pulsedesk/state";
import { Card, EmptyState, Panel, buttonStyles } from "@pulsedesk/ui";
import { Activity, ChevronLeft, SearchX } from "lucide-react";
import { Link, useParams } from "react-router";
import { useAppSelector } from "@/app/hooks";
import { PageHeader } from "@/components/PageHeader";
import {
  SessionDetailsPanel,
  SessionDetailsPanelSkeleton,
} from "@/features/sessions/SessionDetailsPanel";
import { SessionsLoadError } from "@/features/sessions/SessionsLoadError";
import { visitorDisplayName } from "@/features/sessions/presentation";
import { useSessionsSnapshot } from "@/features/sessions/useSessionsSnapshot";

function BackLink() {
  return (
    <Link
      to="/sessions"
      className="mb-3 inline-flex items-center gap-1 rounded-md text-sm text-fg-muted hover:text-fg"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Sessions
    </Link>
  );
}

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const { isLoading, status, error, retry } = useSessionsSnapshot();
  const session = useAppSelector((state) => selectSessionById(state, sessionId));

  if (status === "error") {
    return (
      <>
        <BackLink />
        <PageHeader title="Session" />
        <Card>
          <SessionsLoadError error={error} onRetry={retry} />
        </Card>
      </>
    );
  }

  if (!session && !isLoading) {
    return (
      <>
        <BackLink />
        <PageHeader title="Session not found" />
        <Card>
          <EmptyState
            icon={<SearchX className="size-5" />}
            title="This session isn't available"
            description="It may have ended a while ago and aged out of recent history, or the link is incorrect."
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

  return (
    <>
      <BackLink />
      <PageHeader
        title={session ? visitorDisplayName(session.visitor) : "Session"}
        description={<span className="font-mono">{sessionId}</span>}
      />
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-6">
        {session ? <SessionDetailsPanel session={session} /> : <SessionDetailsPanelSkeleton />}
        <Panel title="Live activity" headingId="session-activity-heading" className="min-h-80">
          <EmptyState
            icon={<Activity className="size-5" />}
            title="No activity recorded yet"
            description="Page views, clicks and form interactions for this session will appear here as they happen."
          />
        </Panel>
      </div>
    </>
  );
}
