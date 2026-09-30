import { selectSessionById, selectViewers } from "@pulsedesk/state";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  buttonStyles,
} from "@pulsedesk/ui";
import { Activity, ChevronLeft, RotateCw, SearchX } from "lucide-react";
import { Link, useParams } from "react-router";
import { useAppSelector } from "@/app/hooks";
import { PageHeader } from "@/components/PageHeader";
import { useWatchSession } from "@/features/realtime/RealtimeProvider";
import {
  SessionDetailsPanel,
  SessionDetailsPanelSkeleton,
} from "@/features/sessions/SessionDetailsPanel";
import { SessionViewers } from "@/features/sessions/SessionViewers";
import { SessionsLoadError } from "@/features/sessions/SessionsLoadError";
import { visitorDisplayName } from "@/features/sessions/presentation";
import { SessionTimeline, countVisibleEvents } from "@/features/sessions/timeline/SessionTimeline";
import { useSessionTimeline } from "@/features/sessions/useSessionTimeline";
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

function TimelineSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-5 p-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-1.5 pt-1">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const { isLoading, status, error, retry } = useSessionsSnapshot();
  const session = useAppSelector((state) => selectSessionById(state, sessionId));
  const viewers = useAppSelector((state) => selectViewers(state, sessionId));
  const { timeline, history, retry: retryTimeline } = useSessionTimeline(sessionId);
  useWatchSession(sessionId);

  if (status === "error" && !session) {
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

  if (history === "missing" || (!session && !isLoading && history === "ready")) {
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

  const events = timeline?.events ?? [];
  let activity;
  if (history === "error") {
    activity = (
      <div className="p-4">
        <ErrorState
          inline
          title="Couldn't load earlier activity"
          description={timeline?.error ?? undefined}
          action={
            <Button
              size="sm"
              onClick={retryTimeline}
              leadingIcon={<RotateCw aria-hidden="true" className="size-3.5" />}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  } else if ((history === "idle" || history === "loading") && events.length === 0) {
    activity = <TimelineSkeleton />;
  } else if (events.length === 0 || !session) {
    activity = (
      <EmptyState
        icon={<Activity className="size-5" />}
        title="No activity recorded yet"
        description="Page views, clicks and form interactions will appear here as they happen."
      />
    );
  } else {
    activity = (
      <SessionTimeline
        events={events}
        startedAt={session.startedAt}
        truncated={timeline?.truncated ?? false}
      />
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={session ? visitorDisplayName(session.visitor) : "Session"}
        description={<span className="font-mono">{sessionId}</span>}
        actions={<SessionViewers viewers={viewers} />}
      />
      <div className="grid gap-4 lg:h-[calc(100dvh-13.5rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-6">
        {session ? <SessionDetailsPanel session={session} /> : <SessionDetailsPanelSkeleton />}
        <Panel
          title="Live activity"
          headingId="session-activity-heading"
          meta={events.length > 0 ? <Badge>{countVisibleEvents(events)}</Badge> : undefined}
          className="h-[32rem] lg:h-auto"
          bodyClassName="overflow-hidden"
        >
          <div aria-busy={history === "loading" || undefined} className="h-full">
            {activity}
          </div>
        </Panel>
      </div>
    </>
  );
}
