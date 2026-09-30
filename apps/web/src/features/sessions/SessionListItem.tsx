import type { Session } from "@pulsedesk/contracts";
import { Avatar } from "@pulsedesk/ui";
import { memo } from "react";
import { Link } from "react-router";
import { deviceLabels, visitorAvatarName, visitorDisplayName } from "./presentation";
import { RelativeTime } from "./RelativeTime";
import { SessionStatusBadge } from "./SessionStatusBadge";

/**
 * Compact session row. Memoised: rows only re-render when their own session object
 * changes (entity adapter updates are structural, so untouched sessions keep identity).
 * Relative times tick inside <RelativeTime> without re-rendering the row.
 */
export const SessionListItem = memo(function SessionListItem({ session }: { session: Session }) {
  const name = visitorDisplayName(session.visitor);
  return (
    <li className="relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover">
      <Avatar name={visitorAvatarName(session.visitor)} seed={session.visitor.id} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Link
            to={`/sessions/${session.id}`}
            // Stretched link: the whole row is clickable, but only one link is announced.
            className="truncate outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-focus focus-visible:after:-outline-offset-2"
          >
            {name}
          </Link>
          {session.visitor.name && (
            <span className="hidden truncate text-xs font-normal text-fg-subtle sm:inline">
              {session.visitor.label}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          <span className="font-mono">{session.currentPath}</span>
          <span aria-hidden="true"> · </span>
          {session.visitor.city} · {deviceLabels[session.device]}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <SessionStatusBadge status={session.status} />
        <span className="text-xs text-fg-subtle">
          <RelativeTime timestamp={session.lastActivityAt} />
        </span>
      </div>
    </li>
  );
});
