import { selectAIAnswersGenerated, selectSessionStats } from "@pulsedesk/state";
import { StatTile, StatusDot } from "@pulsedesk/ui";
import { useAppSelector } from "@/app/hooks";
import { useNow } from "@/lib/clock";
import { formatCount, formatDecimal, formatDuration } from "@/lib/format";

export function StatsGrid({ loading }: { loading: boolean }) {
  const now = useNow();
  const stats = useAppSelector((state) => selectSessionStats(state, now));
  const aiAnswers = useAppSelector(selectAIAnswersGenerated);

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
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
      {/* Counted in this tab's store: 0 on the server and at hydration, so markup matches. */}
      <StatTile
        label="AI answers"
        value={formatCount(aiAnswers)}
        detail="Generated in this tab"
        loading={loading}
        className="col-span-2 lg:col-span-1"
      />
    </dl>
  );
}
