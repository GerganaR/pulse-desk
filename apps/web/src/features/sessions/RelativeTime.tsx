import { formatDuration, formatRelative } from "@/lib/format";
import { useNow } from "@/lib/clock";

/**
 * Leaf components that subscribe to the clock. Keeping the subscription here means a
 * tick re-renders a single text node, not the row or list that contains it.
 */

export function RelativeTime({ timestamp }: { timestamp: number }) {
  const now = useNow();
  return (
    <time dateTime={new Date(timestamp).toISOString()} className="tabular-nums">
      {formatRelative(now - timestamp)}
    </time>
  );
}

/** Duration of a session: ticks while it's ongoing, fixed once it has ended. */
export function LiveDuration({
  startedAt,
  endedAt,
}: {
  startedAt: number;
  endedAt: number | null;
}) {
  const now = useNow();
  return <span className="tabular-nums">{formatDuration((endedAt ?? now) - startedAt)}</span>;
}
