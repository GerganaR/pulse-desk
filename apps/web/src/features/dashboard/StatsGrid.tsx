import { selectSessionStats } from "@pulsedesk/state";
import { StatTile, StatusDot } from "@pulsedesk/ui";
import { useAppSelector } from "@/app/hooks";
import { useNow } from "@/lib/clock";
import { formatCount, formatDecimal, formatDuration } from "@/lib/format";

export function StatsGrid({ loading }: { loading: boolean }) {
  const now = useNow();
  const stats = useAppSelector((state) => selectSessionStats(state, now));

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatTile
        label="Active now"
        indicator={<StatusDot tone="live" pulse={!loading && stats.active > 0} />}
        value={formatCount(stats.active)}
        detail={`${formatCount(stats.idle)} idle`}
        loading={loading}
      />
      <StatTile
        label="Sessions, last 24h"
        value={formatCount(stats.startedLast24h)}
        detail="Including ended sessions"
        loading={loading}
      />
      <StatTile
        label="Avg. session duration"
        value={stats.avgDurationMs === null ? "—" : formatDuration(stats.avgDurationMs)}
        detail="Last 24h, ongoing sessions included"
        loading={loading}
      />
      <StatTile
        label="Pages per session"
        value={stats.avgPageViews === null ? "—" : formatDecimal(stats.avgPageViews)}
        detail="Last 24h average"
        loading={loading}
      />
    </dl>
  );
}
