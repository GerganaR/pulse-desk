import type { Session } from "@pulsedesk/contracts";
import { Avatar, Panel, Skeleton } from "@pulsedesk/ui";
import type { ReactNode } from "react";
import { deviceIcons, deviceLabels, visitorAvatarName, visitorDisplayName } from "./presentation";
import { LiveDuration, RelativeTime } from "./RelativeTime";
import { SessionStatusBadge } from "./SessionStatusBadge";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

export function SessionDetailsPanel({ session }: { session: Session }) {
  const name = visitorDisplayName(session.visitor);
  const DeviceIcon = deviceIcons[session.device];

  return (
    <Panel
      title="Session"
      headingId="session-details-heading"
      meta={<SessionStatusBadge status={session.status} />}
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <Avatar name={visitorAvatarName(session.visitor)} seed={session.visitor.id} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{name}</p>
          <p className="truncate text-sm text-fg-muted">
            {session.visitor.name ? `${session.visitor.label} · ` : ""}
            {session.visitor.city}, {session.visitor.country}
          </p>
        </div>
      </div>

      <div className="border-b border-line px-4 py-3">
        <p className="text-xs font-medium text-fg-subtle">
          {session.status === "closed" ? "Last page" : "Current page"}
        </p>
        <p className="mt-1 truncate font-mono text-sm text-fg">{session.currentPath}</p>
      </div>

      <dl className="divide-y divide-line px-4">
        <Field label="Duration">
          <LiveDuration startedAt={session.startedAt} endedAt={session.endedAt} />
        </Field>
        <Field label="Started">
          <RelativeTime timestamp={session.startedAt} />
        </Field>
        <Field label="Last activity">
          <RelativeTime timestamp={session.lastActivityAt} />
        </Field>
        <Field label="Device">
          <span className="inline-flex items-center gap-1.5">
            <DeviceIcon aria-hidden="true" className="size-4 text-fg-muted" />
            {deviceLabels[session.device]}
          </span>
        </Field>
        <Field label="Browser">
          {session.browser} on {session.os}
        </Field>
        <Field label="Referrer">{session.referrer ?? "Direct"}</Field>
        <Field label="Landing page">
          <span className="font-mono">{session.landingPath}</span>
        </Field>
        <Field label="Page views">
          <span className="tabular-nums">{session.pageViews}</span>
        </Field>
        <Field label="Events">
          <span className="tabular-nums">{session.eventCount}</span>
        </Field>
      </dl>
    </Panel>
  );
}

export function SessionDetailsPanelSkeleton() {
  return (
    <Panel title="Session" headingId="session-details-heading">
      <div aria-hidden="true" className="space-y-5 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    </Panel>
  );
}
