import type { RealtimeEvent } from "@pulsedesk/contracts";
import { cx, type Tone } from "@pulsedesk/ui";
import { History } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatOffset } from "@/lib/format";
import { describeEvent, type EventPresentation } from "./describe-event";

const iconTones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-muted",
  accent: "bg-accent-soft text-accent",
  live: "bg-live-soft text-live",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

const TimelineItem = memo(function TimelineItem({
  event,
  presentation,
  startedAt,
  isNew,
  replayed,
}: {
  event: RealtimeEvent;
  presentation: EventPresentation;
  startedAt: number;
  isNew: boolean;
  /** Delivered by a replay after a reconnect/resync, rather than live. */
  replayed: boolean;
}) {
  const { icon: Icon, title, detail, tone } = presentation;
  return (
    <li
      data-sequence={event.sequence}
      data-replayed={replayed || undefined}
      className={cx("relative flex gap-3 pb-4 last:pb-0", isNew && "motion-safe:animate-fade-in")}
    >
      {/* connector line between items */}
      <span aria-hidden="true" className="absolute top-8 bottom-0 left-[13px] w-px bg-line" />
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
          "-mx-1.5 min-w-0 flex-1 rounded-md px-1.5 pt-0.5",
          replayed && isNew && "animate-replay-highlight",
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
 * Follows new events only while the reader is already at the bottom; scrolling up to
 * read history is never interrupted. Items that arrive after mount fade in, so live
 * activity is noticeable without being loud. Events that arrived through a replay (after
 * a reconnect or a resync) carry a small marker and a brief tint instead of a toast.
 * Not virtualised yet — that's Phase 7, with measurements.
 */
export function SessionTimeline({
  events,
  startedAt,
  truncated,
  replayed = null,
}: SessionTimelineProps) {
  const items = useMemo(
    () =>
      events.flatMap((event) => {
        const presentation = describeEvent(event);
        return presentation ? [{ event, presentation }] : [];
      }),
    [events],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Captured once: anything newer arrived while the page was open and gets a fade-in.
  const [lastSequenceAtMount] = useState(() => events.at(-1)?.sequence ?? 0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [items.length]);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const el = event.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className="h-full overflow-y-auto px-4 py-4"
    >
      {truncated && (
        <p className="mb-4 text-center text-xs text-fg-subtle">Earlier activity isn't shown</p>
      )}
      <ol aria-label="Session activity" className="[&>li:last-child>span:first-child]:hidden">
        {items.map(({ event, presentation }) => (
          <TimelineItem
            key={event.sequence}
            event={event}
            presentation={presentation}
            startedAt={startedAt}
            isNew={event.sequence > lastSequenceAtMount}
            replayed={
              replayed !== null &&
              event.sequence >= replayed.fromSequence &&
              event.sequence <= replayed.toSequence
            }
          />
        ))}
      </ol>
    </div>
  );
}

export const countVisibleEvents = (events: readonly RealtimeEvent[]) =>
  events.reduce((count, event) => count + (describeEvent(event) ? 1 : 0), 0);
