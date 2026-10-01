import type { RealtimeEvent } from "@pulsedesk/contracts";
import { cx, type Tone } from "@pulsedesk/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, History } from "lucide-react";
import { memo, Profiler, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCount, formatOffset } from "@/lib/format";
import { metrics } from "@/lib/metrics";
import { useHydrated } from "@/lib/use-hydrated";
import { presentationOf, type EventPresentation } from "./describe-event";

const iconTones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-muted",
  accent: "bg-accent-soft text-accent",
  live: "bg-live-soft text-live",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/**
 * Above this many entries only the rows near the viewport are in the DOM. Below it the
 * list renders in full: complete for assistive technology, and the same on the server.
 */
export const VIRTUALIZE_ABOVE = 100;

/**
 * Row heights are fixed (titles and details truncate to one line), so the virtual list
 * knows every offset without measuring: no layout shift, and switching between the full
 * and the virtual list keeps the scroll position. The classes and numbers must agree.
 */
const ROW_HEIGHT = 44;
const ROW_WITH_DETAIL_HEIGHT = 56;
const rowHeightClass = { [ROW_HEIGHT]: "h-11", [ROW_WITH_DETAIL_HEIGHT]: "h-14" } as const;
const PADDING = 16;
/** More new rows than this in one update appear without the fade-in. */
const MAX_ANIMATED_ROWS = 5;
const NOTE_HEIGHT = 32;
/** How close to the end still counts as "at the bottom". */
const STICK_WITHIN_PX = 48;
/**
 * Rows rendered beyond each edge of the viewport. The list re-renders in the same frame as
 * the scroll event, so this only has to cover a fast fling; every extra row is mounted and
 * unmounted again on each jump (measured: at 10 it cost frames when scrolling fast).
 */
const OVERSCAN = 4;

interface TimelineEntry {
  event: RealtimeEvent;
  presentation: EventPresentation;
}

const heightOf = (entry: TimelineEntry) =>
  entry.presentation.detail ? ROW_WITH_DETAIL_HEIGHT : ROW_HEIGHT;

const TimelineItem = memo(function TimelineItem({
  event,
  presentation,
  startedAt,
  isNew,
  replayed,
  highlight,
  isLast,
  offset,
  position,
}: TimelineEntry & {
  startedAt: number;
  /** Arrived in the latest update: fades in. */
  isNew: boolean;
  /** Delivered by a replay after a reconnect/resync, rather than live. */
  replayed: boolean;
  /** Replayed while this page was open: gets the tint that fades over a few seconds. */
  highlight: boolean;
  isLast: boolean;
  /** Virtual list only: distance from the top of the list. */
  offset?: number;
  /** Virtual list only: where this row sits in the whole list, for assistive technology. */
  position?: { index: number; total: number };
}) {
  const { icon: Icon, title, detail, tone } = presentation;
  return (
    <li
      data-sequence={event.sequence}
      data-replayed={replayed || undefined}
      aria-posinset={position ? position.index + 1 : undefined}
      aria-setsize={position?.total}
      // Placed with `top`, not a transform: the fade-in animates `transform` and keeps its
      // end value, which would override the row's position and send it to the top.
      style={offset === undefined ? undefined : { top: offset }}
      className={cx(
        "flex gap-3",
        rowHeightClass[detail ? ROW_WITH_DETAIL_HEIGHT : ROW_HEIGHT],
        offset === undefined ? "relative" : "absolute inset-x-0",
        isNew && "motion-safe:animate-fade-in",
      )}
    >
      {/* connector line between items */}
      {!isLast && (
        <span aria-hidden="true" className="absolute top-8 bottom-0 left-[13px] w-px bg-line" />
      )}
      <span
        aria-hidden="true"
        className={cx(
          "relative flex size-7 shrink-0 items-center justify-center rounded-full",
          iconTones[tone],
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div
        className={cx(
          "-mx-1.5 min-w-0 flex-1 self-start rounded-md px-1.5 pt-0.5",
          highlight && "animate-replay-highlight",
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm text-fg">
            {title}
            {replayed && <span className="sr-only"> (caught up after reconnecting)</span>}
          </p>
          {replayed && (
            <History aria-hidden="true" className="ml-auto size-3 shrink-0 self-center text-info" />
          )}
          <span
            className="shrink-0 font-mono text-xs text-fg-subtle tabular-nums"
            title="Time since session start"
          >
            {formatOffset(event.timestamp - startedAt)}
          </span>
        </div>
        {detail && <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{detail}</p>}
      </div>
    </li>
  );
});

interface ListProps {
  entries: TimelineEntry[];
  startedAt: number;
  replayed: { fromSequence: number; toSequence: number } | null;
  /** Rows after this sequence arrived in the latest update and fade in. */
  newAfter: number;
  /** Rows after this sequence arrived while the page was open. */
  mountedAt: number;
  /** Space above the first row (the "earlier activity" note). */
  paddingStart: number;
}

const rowProps = (
  entries: TimelineEntry[],
  index: number,
  { startedAt, replayed, newAfter, mountedAt }: ListProps,
) => {
  // Callers only pass indexes inside `entries`.
  const entry = entries[index] as TimelineEntry;
  const { sequence } = entry.event;
  const wasReplayed =
    replayed !== null && sequence >= replayed.fromSequence && sequence <= replayed.toSequence;
  return {
    ...entry,
    startedAt,
    isLast: index === entries.length - 1,
    isNew: sequence > newAfter,
    replayed: wasReplayed,
    highlight: wasReplayed && sequence > mountedAt,
  };
};

function FullList(props: ListProps) {
  const { entries } = props;
  return (
    <ol aria-label="Session activity" style={{ paddingTop: props.paddingStart }}>
      {entries.map((entry, index) => (
        <TimelineItem key={entry.event.sequence} {...rowProps(entries, index, props)} />
      ))}
    </ol>
  );
}

function VirtualList({
  scrollElement,
  ...props
}: ListProps & { scrollElement: HTMLDivElement | null }) {
  const { entries, paddingStart } = props;
  const estimateSize = useCallback(
    (index: number) => heightOf(entries[index] as TimelineEntry),
    [entries],
  );
  const getItemKey = useCallback(
    (index: number) => (entries[index] as TimelineEntry).event.sequence,
    [entries],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable functions by design; this component isn't compiled.
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize,
    getItemKey,
    overscan: OVERSCAN,
    // The scroll position is often set from a layout effect here (see `shiftScroll`), where
    // React can't flush synchronously; a normal update still lands before paint.
    useFlushSync: false,
    paddingStart,
    scrollMargin: PADDING,
  });

  return (
    <ol
      aria-label="Session activity"
      data-virtual="true"
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <TimelineItem
          key={row.key}
          {...rowProps(entries, row.index, props)}
          offset={row.start - PADDING}
          position={{ index: row.index, total: entries.length }}
        />
      ))}
    </ol>
  );
}

export interface SessionTimelineProps {
  events: RealtimeEvent[];
  startedAt: number;
  truncated: boolean;
  /** Sequence range of the most recent replay, whose events get a replay marker. */
  replayed?: { fromSequence: number; toSequence: number } | null;
}

/**
 * Chronological activity feed, newest at the bottom.
 *
 * - Follows new events only while the reader is at the bottom. Scrolling up to read
 *   history is never interrupted: the view stays put (also when old entries are trimmed
 *   above it) and a "N new events" button offers the way back.
 * - Long timelines are virtualised (see `VIRTUALIZE_ABOVE`): thousands of events cost
 *   the same to render as a screenful.
 * - Items that arrive after mount fade in, so live activity is noticeable without being
 *   loud. Events that arrived through a replay (after a reconnect or a resync) carry a
 *   small marker and a brief tint instead of a toast.
 * - The server (and the hydration pass) renders at most the latest `VIRTUALIZE_ABOVE`
 *   entries; the rest appear once the page is interactive.
 */
export function SessionTimeline({
  events,
  startedAt,
  truncated,
  replayed = null,
}: SessionTimelineProps) {
  const all = useMemo(
    () =>
      events.flatMap((event) => {
        const presentation = presentationOf(event);
        return presentation ? [{ event, presentation }] : [];
      }),
    [events],
  );

  const hydrated = useHydrated();
  const virtual = hydrated && all.length > VIRTUALIZE_ABOVE;
  const entries = useMemo(
    () => (hydrated || all.length <= VIRTUALIZE_ABOVE ? all : all.slice(-VIRTUALIZE_ABOVE)),
    [all, hydrated],
  );
  const earlierHidden = truncated || entries.length < all.length;
  const paddingStart = earlierHidden ? NOTE_HEIGHT : 0;
  const lastSequence = entries.at(-1)?.event.sequence ?? 0;

  // The scroll container, twice. As a ref for scrolling it. As state for the virtual
  // list, which is a descendant: a descendant's layout effects run before an ancestor's
  // ref is attached, so it would never see the ref. As state, the element arrives in a
  // re-render (before paint) that the virtualizer can observe.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    setScrollElement(element);
  }, []);
  // Captured once: a replay tints only what arrived while the page was open.
  const [mountedAt] = useState(lastSequence);
  // What arrived in the latest update fades in. Tracked as "the newest entry before this
  // update", so rows don't fade again when they scroll back into view, and a flood (more
  // than a few rows at once, which nobody can read anyway) doesn't animate a whole screen.
  const [arrival, setArrival] = useState({ last: lastSequence, before: lastSequence });
  if (arrival.last !== lastSequence) setArrival({ last: lastSequence, before: arrival.last });
  const arrived = entries.length > 0 ? countAfter(entries, arrival.before) : 0;
  const newAfter = arrived <= MAX_ANIMATED_ROWS ? arrival.before : Infinity;
  const [pinned, setPinned] = useState(true);
  /** The newest entry when the reader left the bottom: later ones are "new" to them. */
  const [seenSequence, setSeenSequence] = useState(lastSequence);

  const unseen = pinned ? 0 : countAfter(entries, seenSequence);

  const previous = useRef({ entries, paddingStart });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const before = previous.current;
    previous.current = { entries, paddingStart };
    if (!element) return;
    if (pinned) {
      scrollToEnd(element);
      return;
    }
    // Not following: keep what the reader is looking at in place when entries above it
    // are trimmed (the per-session cap) or the note above the list appears.
    const first = entries[0]?.event.sequence ?? Infinity;
    let removed = before.paddingStart - paddingStart;
    for (const entry of before.entries) {
      if (entry.event.sequence >= first) break;
      removed += heightOf(entry);
    }
    if (removed !== 0) shiftScroll(element, -removed);
  }, [scrollElement, entries, paddingStart, pinned, virtual]);

  const list = { entries, startedAt, replayed, newAfter, mountedAt, paddingStart };

  return (
    <div className="relative h-full">
      <div
        ref={attachScroll}
        data-testid="timeline-scroll"
        onScroll={(event) => {
          const el = event.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_WITHIN_PX;
          if (atBottom === pinned) return;
          setPinned(atBottom);
          if (!atBottom) setSeenSequence(lastSequence);
        }}
        className="h-full overflow-y-auto"
      >
        <div className="relative px-4 pt-4">
          {earlierHidden && (
            <p className="absolute inset-x-0 top-4 text-center text-xs text-fg-subtle">
              Earlier activity isn't shown
            </p>
          )}
          <Profiler id="session-timeline" onRender={recordRender}>
            {virtual ? (
              <VirtualList scrollElement={scrollElement} {...list} />
            ) : (
              <FullList {...list} />
            )}
          </Profiler>
        </div>
      </div>
      {unseen > 0 && (
        <button
          type="button"
          onClick={() => {
            if (scrollRef.current) scrollToEnd(scrollRef.current);
            setPinned(true);
          }}
          className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-fg shadow-overlay hover:bg-surface-hover motion-safe:animate-fade-in"
        >
          <ArrowDown aria-hidden="true" className="size-3.5 text-accent" />
          {formatCount(unseen)} new event{unseen === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

/** How many entries at the end are newer than `sequence` (entries are in sequence order). */
function countAfter(entries: TimelineEntry[], sequence: number): number {
  let count = 0;
  while (
    count < entries.length &&
    (entries[entries.length - 1 - count] as TimelineEntry).event.sequence > sequence
  )
    count++;
  return count;
}

/**
 * Move the scroll position and announce it at once. Browsers deliver the `scroll` event a
 * frame later; the virtual list picks its rows from that event, so after a jump it would
 * paint one frame of empty space. Dispatching the event here lets it re-render (and the
 * component update "at the bottom") before the browser paints.
 */
function shiftScroll(element: HTMLElement, delta: number) {
  element.scrollTop += delta;
  element.dispatchEvent(new Event("scroll"));
}

const scrollToEnd = (element: HTMLElement) =>
  shiftScroll(element, element.scrollHeight - element.scrollTop);

/**
 * React only calls this in builds with profiling enabled (development and the devtools
 * build); in the production build `<Profiler>` costs nothing and records nothing.
 */
function recordRender(_id: string, _phase: string, actualDuration: number) {
  metrics.histogram("session.timeline.render.duration", actualDuration);
}

export const countVisibleEvents = (events: readonly RealtimeEvent[]) =>
  events.reduce((count, event) => count + (presentationOf(event) ? 1 : 0), 0);
