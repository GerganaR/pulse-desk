import type { Session } from "@pulsedesk/contracts";
import { Avatar, Skeleton } from "@pulsedesk/ui";
import { memo } from "react";
import { Link } from "react-router";
import { deviceIcons, deviceLabels, visitorAvatarName, visitorDisplayName } from "./presentation";
import { LiveDuration, RelativeTime } from "./RelativeTime";
import { SessionStatusBadge } from "./SessionStatusBadge";

const headerCell = "px-4 py-2.5 text-left text-xs font-medium text-fg-muted first:pl-5 last:pr-5";
const cell = "px-4 py-3 first:pl-5 last:pr-5";

const SessionRow = memo(function SessionRow({ session }: { session: Session }) {
  const name = visitorDisplayName(session.visitor);
  const DeviceIcon = deviceIcons[session.device];
  return (
    <tr className="relative transition-colors hover:bg-surface-hover">
      <td className={cell}>
        <div className="flex items-center gap-3">
          <Avatar name={visitorAvatarName(session.visitor)} seed={session.visitor.id} />
          <div className="min-w-0">
            <Link
              to={`/sessions/${session.id}`}
              className="block truncate text-sm font-medium text-fg outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-focus focus-visible:after:-outline-offset-2"
            >
              {name}
            </Link>
            <p className="truncate text-xs text-fg-subtle">
              {session.visitor.name ? session.visitor.label : session.id}
            </p>
          </div>
        </div>
      </td>
      <td className={cell}>
        <SessionStatusBadge status={session.status} />
      </td>
      <td className={`${cell} hidden max-w-56 md:table-cell`}>
        <span className="block truncate font-mono text-[13px] text-fg">{session.currentPath}</span>
      </td>
      <td className={`${cell} hidden text-sm text-fg-muted lg:table-cell`}>
        {session.visitor.city}, {session.visitor.country}
      </td>
      <td className={`${cell} hidden lg:table-cell`}>
        <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <DeviceIcon aria-hidden="true" className="size-4" />
          {deviceLabels[session.device]} · {session.browser}
        </span>
      </td>
      <td className={`${cell} hidden text-right text-sm text-fg-muted xl:table-cell`}>
        <LiveDuration startedAt={session.startedAt} endedAt={session.endedAt} />
      </td>
      <td className={`${cell} text-right text-sm whitespace-nowrap text-fg-muted`}>
        <RelativeTime timestamp={session.lastActivityAt} />
      </td>
    </tr>
  );
});

function TableHead() {
  return (
    <thead className="border-b border-line bg-surface-muted/60">
      <tr>
        <th scope="col" className={headerCell}>
          Visitor
        </th>
        <th scope="col" className={headerCell}>
          Status
        </th>
        <th scope="col" className={`${headerCell} hidden md:table-cell`}>
          Current page
        </th>
        <th scope="col" className={`${headerCell} hidden lg:table-cell`}>
          Location
        </th>
        <th scope="col" className={`${headerCell} hidden lg:table-cell`}>
          Device
        </th>
        <th scope="col" className={`${headerCell} hidden text-right xl:table-cell`}>
          Duration
        </th>
        <th scope="col" className={`${headerCell} text-right`}>
          Last active
        </th>
      </tr>
    </thead>
  );
}

export function SessionsTable({ sessions, caption }: { sessions: Session[]; caption: string }) {
  return (
    <table className="w-full table-auto">
      <caption className="sr-only">{caption}</caption>
      <TableHead />
      <tbody className="divide-y divide-line">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </tbody>
    </table>
  );
}

export function SessionsTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <table className="w-full" aria-hidden="true">
      <TableHead />
      <tbody className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i}>
            <td className={cell}>
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </td>
            <td className={cell}>
              <Skeleton className="h-5 w-16 rounded-full" />
            </td>
            <td className={`${cell} hidden md:table-cell`}>
              <Skeleton className="h-3.5 w-32" />
            </td>
            <td className={`${cell} hidden lg:table-cell`}>
              <Skeleton className="h-3.5 w-24" />
            </td>
            <td className={`${cell} hidden lg:table-cell`}>
              <Skeleton className="h-3.5 w-28" />
            </td>
            <td className={`${cell} hidden xl:table-cell`}>
              <Skeleton className="ml-auto h-3.5 w-12" />
            </td>
            <td className={cell}>
              <Skeleton className="ml-auto h-3.5 w-14" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
