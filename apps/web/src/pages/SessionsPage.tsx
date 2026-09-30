import { selectFilteredSessions } from "@pulsedesk/state";
import { Card, EmptyState, buttonStyles } from "@pulsedesk/ui";
import { SearchX, Users } from "lucide-react";
import { useDeferredValue } from "react";
import { Link, useSearchParams } from "react-router";
import { useAppSelector } from "@/app/hooks";
import { PageHeader } from "@/components/PageHeader";
import { SessionFilters } from "@/features/sessions/SessionFilters";
import { SessionsLoadError } from "@/features/sessions/SessionsLoadError";
import { SessionsTable, SessionsTableSkeleton } from "@/features/sessions/SessionsTable";
import { STATUS_FILTERS, parseStatusFilter } from "@/features/sessions/filters";
import { useSessionsSnapshot } from "@/features/sessions/useSessionsSnapshot";

export function SessionsPage() {
  const { isLoading, status: loadStatus, error, retry } = useSessionsSnapshot();
  const [searchParams] = useSearchParams();
  const statusFilter = parseStatusFilter(searchParams.get("status"));
  const query = searchParams.get("q") ?? "";
  // The input updates immediately; filtering the list can lag a frame behind while typing.
  const deferredQuery = useDeferredValue(query);
  const sessions = useAppSelector((state) =>
    selectFilteredSessions(state, statusFilter, deferredQuery),
  );
  const totalCount = useAppSelector((state) => state.sessions.ids.length);
  const filterLabel = STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ?? "All";

  let content;
  if (loadStatus === "error") {
    content = <SessionsLoadError error={error} onRetry={retry} />;
  } else if (isLoading) {
    content = <SessionsTableSkeleton />;
  } else if (totalCount === 0) {
    content = (
      <EmptyState
        icon={<Users className="size-5" />}
        title="No sessions to show"
        description="When visitors browse your site, their sessions are listed here in real time."
      />
    );
  } else if (sessions.length === 0) {
    content = (
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="No matching sessions"
        description={
          deferredQuery
            ? `Nothing matches “${deferredQuery}” in ${filterLabel.toLowerCase()} sessions.`
            : `There are no ${filterLabel.toLowerCase()} sessions right now.`
        }
        action={
          <Link to="/sessions" replace className={buttonStyles()}>
            Clear filters
          </Link>
        }
      />
    );
  } else {
    content = (
      <div className="overflow-x-auto">
        <SessionsTable
          sessions={sessions}
          caption={`${filterLabel} sessions, most recently active first`}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Sessions" description="Every active and recent visitor session." />
      <div className="space-y-4">
        <SessionFilters status={statusFilter} query={query} />
        <Card className="overflow-hidden" aria-busy={isLoading || undefined}>
          {content}
        </Card>
        {!isLoading && sessions.length > 0 && (
          <p className="text-xs text-fg-subtle" aria-live="polite">
            Showing {sessions.length} of {totalCount} sessions
          </p>
        )}
      </div>
    </>
  );
}
