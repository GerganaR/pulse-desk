import type { ActivityBucket } from "@pulsedesk/state";
import { cx } from "@pulsedesk/ui";
import { useState, type KeyboardEvent } from "react";

const MINUTE = 60_000;

/** Round the y-axis ceiling to a clean number so the single gridline reads naturally. */
export function niceCeiling(max: number): number {
  if (max <= 4) return 4;
  const step = max <= 10 ? 2 : max <= 50 ? 5 : 10;
  return Math.ceil(max / step) * step;
}

/** Relative label for a bucket, independent of time zone (safe to server-render). */
function bucketLabel(bucket: ActivityBucket, alignedNow: number): string {
  const minutesAgo = Math.round((alignedNow - bucket.start) / MINUTE);
  return minutesAgo === 0 ? "Last 5 minutes" : `${minutesAgo + 5}–${minutesAgo} min ago`;
}

const sessionsLabel = (count: number) => `${count} ${count === 1 ? "session" : "sessions"}`;

// Only used inside the tooltip, which renders on interaction (client only), so using the
// viewer's locale and time zone can't cause a hydration mismatch.
const clockTime = (time: number) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(time);

export interface ActivityChartProps {
  buckets: ActivityBucket[];
  /** Start of the current (last) bucket. */
  alignedNow: number;
}

/**
 * Sessions started per 5 minutes over the last hour. Single series → no legend; the
 * card title names it.
 *
 * Marks follow the dataviz spec: bars ≤ 24px, 4px rounded data end and square baseline,
 * hairline gridline and baseline, chart colour from a validated token. Every bar
 * has a tooltip on hover, tap *and* keyboard focus (roving tabindex, ←/→/Home/End), and the
 * same data is available as a table via the card's toggle.
 */
export function ActivityChart({ buckets, alignedNow }: ActivityChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(buckets.length - 1);
  const ceiling = niceCeiling(Math.max(0, ...buckets.map((b) => b.count)));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: focusIndex - 1,
      ArrowRight: focusIndex + 1,
      Home: 0,
      End: buckets.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const clamped = Math.min(buckets.length - 1, Math.max(0, next));
    const bars = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-bar]");
    bars?.[clamped]?.focus(); // onFocus updates the roving index and tooltip
  };

  return (
    // Top padding is headroom for the tooltip of the tallest bar, so it never covers the
    // card header.
    <div className="flex gap-3 pt-14">
      {/* y-axis: ceiling and zero only — the tooltip and table carry exact values */}
      <div
        aria-hidden="true"
        className="flex h-50 flex-col justify-between pb-6 text-right text-xs text-fg-subtle tabular-nums"
      >
        <span className="-translate-y-1/2">{ceiling}</span>
        <span className="translate-y-1/2">0</span>
      </div>

      <div className="min-w-0 flex-1">
        <div
          role="group"
          aria-label="Sessions started per 5 minutes over the last hour"
          onPointerLeave={() => setActive(null)}
          className="relative flex h-44 items-end border-t border-b border-line"
        >
          {buckets.map((bucket, index) => {
            const heightPct = (bucket.count / ceiling) * 100;
            const isActive = active === index;
            return (
              // Each bar is a button: focusable for keyboard users, and tappable on touch
              // screens where there is no hover. The whole column is the hit target.
              <button
                key={bucket.start}
                type="button"
                data-bar
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={`${bucketLabel(bucket, alignedNow)}: ${sessionsLabel(bucket.count)}`}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setActive(index);
                }}
                onClick={() => setActive(index)}
                onFocus={() => {
                  setFocusIndex(index);
                  setActive(index);
                }}
                onBlur={() => setActive(null)}
                onKeyDown={onKeyDown}
                className="relative flex h-full flex-1 cursor-default items-end justify-center rounded-sm px-px"
              >
                <span
                  className={cx(
                    "relative block w-full max-w-6 rounded-t-[4px] bg-chart transition-opacity duration-150",
                    active !== null && !isActive && "opacity-60",
                  )}
                  style={{ height: bucket.count > 0 ? `max(${heightPct}%, 3px)` : 0 }}
                >
                  {/* Anchored to the bar's top so the readout sits next to the mark it describes. */}
                  {isActive && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-center whitespace-nowrap shadow-overlay"
                    >
                      <span className="block text-sm font-semibold text-fg">
                        {sessionsLabel(bucket.count)}
                      </span>
                      <span className="block text-xs text-fg-muted">
                        {clockTime(bucket.start)}–{clockTime(bucket.end)}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-fg-subtle">
          <span>60 min ago</span>
          <span>30 min ago</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityTable({ buckets, alignedNow }: ActivityChartProps) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Sessions started per 5 minutes over the last hour</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-fg-muted">
          <th scope="col" className="py-2 font-medium">
            Time window
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Sessions started
          </th>
        </tr>
      </thead>
      <tbody>
        {[...buckets].reverse().map((bucket) => (
          <tr key={bucket.start} className="border-b border-line last:border-0">
            <td className="py-1.5 text-fg-muted">{bucketLabel(bucket, alignedNow)}</td>
            <td className="py-1.5 text-right text-fg tabular-nums">{bucket.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
