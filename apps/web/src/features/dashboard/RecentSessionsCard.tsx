import { selectSessionsByRecentActivity } from "@pulsedesk/state";
import { Card, CardHeader, EmptyState, Skeleton } from "@pulsedesk/ui";
import { ArrowRight, Users } from "lucide-react";
import { Link } from "react-router";
import { useAppSelector } from "@/app/hooks";
import { SessionListItem } from "@/features/sessions/SessionListItem";

const LIMIT = 6;

export function RecentSessionsCard({
  loading,
  className,
}: {
  loading: boolean;
  className?: string;
}) {
  const sessions = useAppSelector(selectSessionsByRecentActivity);
  const recent = sessions.slice(0, LIMIT);

  return (
    <Card className={className}>
      <CardHeader
        title="Recent sessions"
        description="Most recently active visitors"
        actions={
          <Link
            to="/sessions"
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-accent hover:text-accent-hover"
          >
            View all
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        }
      />
      <div aria-busy={loading || undefined} className="border-t border-line">
        {loading ? (
          <ul aria-hidden="true">
            {Array.from({ length: LIMIT }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </li>
            ))}
          </ul>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No sessions yet"
            description="Sessions appear here the moment visitors land on your site."
          />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((session) => (
              <SessionListItem key={session.id} session={session} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
