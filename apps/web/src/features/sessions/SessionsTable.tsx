import type { Session } from "@pulsedesk/contracts";
import { Avatar, Skeleton } from "@pulsedesk/ui";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useState, type Ref } from "react";
import { Link } from "react-router";
import { useHydrated } from "@/lib/use-hydrated";
import { deviceIcons, deviceLabels, visitorAvatarName, visitorDisplayName } from "./presentation";
import { LiveDuration, RelativeTime } from "./RelativeTime";
import { SessionStatusBadge } from "./SessionStatusBadge";

const headerCell = "px-4 py-2.5 text-left text-xs font-medium text-fg-muted first:pl-5 last:pr-5";
const cell = "px-4 py-3 first:pl-5 last:pr-5";

/**
 * Past this many rows only those near the viewport are rendered. A busy site has
 * hundreds of sessions, each row re-renders as its visitor moves, and the list re-sorts
 * on every event: the work should follow what's on screen, not what's in the store.
 *
 * 50 is about what the virtual list renders anyway (a screenful plus overscan), so below
 * it virtualising saves nothing. It was 100 at first; measured under a burst, 100 plain
 * rows cost twice the main-thread time of the virtual list (docs/performance.md).
 */
export const VIRTUALIZE_ROWS_ABOVE = 50;
/** Rows the server sends for a long list; the rest appear once the page is interactive. */
const SERVER_ROWS = 50;
/** A starting point only: rows are measured, because their height depends on the font. */
const ROW_HEIGHT_ESTIMATE = 61;
const COLUMN_COUNT = 7;

const SessionRow = memo(function SessionRow({
  session,
  index,
  rowRef,
}: {
  session: Session;
  /** Virtual list only: the row's position in the whole list. */
  index?: number;
  rowRef?: Ref<HTMLTableRowElement>;
}) {
  const name = visitorDisplayName(session.visitor);
  const DeviceIcon = deviceIcons[session.device];
  return (
    <tr
      ref={rowRef}
      data-index={index}
      // +2: aria-rowindex is 1-based, and the header is row 1.
      aria-rowindex={index === undefined ? undefined : index + 2}
      // The separator is each row's own border, not a sibling selector on the body
      // (`divide-y`): the list re-sorts constantly, and with a sibling selector every
      // re-sort made the browser restyle every row.
      className="relative border-t border-line transition-colors hover:bg-surface-hover"
    >
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

/** Keeps the table's height while rows outside the viewport aren't rendered. */
function Spacer({ height }: { height: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden="true" data-spacer="true" style={{ height }}>
      <td colSpan={COLUMN_COUNT} className="p-0" />
    </tr>
  );
}

/** The page scrolls, not the table, so rows are picked from the window's scroll position. */
function VirtualBody({ sessions }: { sessions: Session[] }) {
  // Where the rows start on the page. Measured when the body mounts and when the window
  // resizes (the filters above can wrap).
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const [bodyTop, setBodyTop] = useState(0);
  const attachBody = useCallback((element: HTMLTableSectionElement | null) => {
    setBody(element);
    if (element) setBodyTop(element.getBoundingClientRect().top + window.scrollY);
  }, []);
  useEffect(() => {
    if (!body) return;
    const measure = () => setBodyTop(body.getBoundingClientRect().top + window.scrollY);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [body]);

  const getItemKey = useCallback((index: number) => (sessions[index] as Session).id, [sessions]);
  const virtualizer = useWindowVirtualizer({
    count: sessions.length,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    getItemKey,
    overscan: 12,
    scrollMargin: bodyTop,
  });
  const rows = virtualizer.getVirtualItems();
  const first = rows[0];
  const last = rows.at(-1);

  return (
    <tbody ref={attachBody}>
      <Spacer height={first ? first.start - bodyTop : 0} />
      {rows.map((row) => (
        <SessionRow
          key={row.key}
          session={sessions[row.index] as Session}
          index={row.index}
          rowRef={virtualizer.measureElement}
        />
      ))}
      <Spacer height={last ? virtualizer.getTotalSize() - (last.end - bodyTop) : 0} />
    </tbody>
  );
}

export function SessionsTable({ sessions, caption }: { sessions: Session[]; caption: string }) {
  const hydrated = useHydrated();
  const long = sessions.length > VIRTUALIZE_ROWS_ABOVE;
  // The server (and the hydration pass) renders the top of a long list in full and
  // reserves the height of the rest, so the page doesn't jump when the rows take over.
  const serverRows = long && !hydrated ? sessions.slice(0, SERVER_ROWS) : sessions;

  return (
    <table
      className="w-full table-auto"
      aria-rowcount={long ? sessions.length + 1 : undefined}
      data-virtual={long && hydrated ? "true" : undefined}
    >
      <caption className="sr-only">{caption}</caption>
      <TableHead />
      {long && hydrated ? (
        <VirtualBody sessions={sessions} />
      ) : (
        <tbody>
          {serverRows.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
          <Spacer height={(sessions.length - serverRows.length) * ROW_HEIGHT_ESTIMATE} />
        </tbody>
      )}
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
