import { selectHighlightedReplay, selectSessionById, selectViewers } from "@pulsedesk/state";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  buttonStyles,
} from "@pulsedesk/ui";
import { Activity, ChevronLeft, RotateCw, SearchX } from "lucide-react";
import { Link, useParams } from "react-router";
import { useAppSelector } from "@/app/hooks";
import { PageHeader } from "@/components/PageHeader";
import { Copilot } from "@/features/copilot/Copilot";
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

/** Tab panels below `xl` (only the active one shown, tall enough to work in); columns above. */
const panelClass =
  "flex min-h-0 flex-col h-[max(26rem,calc(100dvh-20rem))] lg:h-[max(28rem,calc(100dvh-17rem))] max-xl:data-[state=inactive]:hidden xl:h-auto [&>section]:flex-1";

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const { isLoading, status, error, retry } = useSessionsSnapshot();
  const session = useAppSelector((state) => selectSessionById(state, sessionId));
  const viewers = useAppSelector((state) => selectViewers(state, sessionId));
  const replayed = useAppSelector(selectHighlightedReplay);
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
        replayed={replayed}
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
      {/*
        Three columns on wide screens; below that, one panel at a time behind tabs. Every
        panel stays mounted either way (forceMount), so switching tabs keeps the timeline's
        scroll position and never interrupts an answer that is streaming.
      */}
      <Tabs defaultValue="activity">
        <TabList aria-label="Session views" className="mb-4 xl:hidden">
          <Tab value="details">Details</Tab>
          <Tab value="activity">Activity</Tab>
          <Tab value="copilot">Copilot</Tab>
        </TabList>
        <div className="grid grid-cols-1 xl:h-[calc(100dvh-13.5rem)] xl:min-h-[34rem] xl:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1.2fr)_minmax(0,1fr)] xl:gap-5">
          <TabPanel value="details" forceMount className={panelClass}>
            {session ? <SessionDetailsPanel session={session} /> : <SessionDetailsPanelSkeleton />}
          </TabPanel>
          <TabPanel value="activity" forceMount className={panelClass}>
            <Panel
              title="Live activity"
              headingId="session-activity-heading"
              meta={events.length > 0 ? <Badge>{countVisibleEvents(events)}</Badge> : undefined}
              className="h-full"
              bodyClassName="overflow-hidden"
            >
              <div aria-busy={history === "loading" || undefined} className="h-full">
                {activity}
              </div>
            </Panel>
          </TabPanel>
          <TabPanel value="copilot" forceMount className={panelClass}>
            <Copilot sessionId={sessionId} className="h-full" />
          </TabPanel>
        </div>
      </Tabs>
    </>
  );
}
