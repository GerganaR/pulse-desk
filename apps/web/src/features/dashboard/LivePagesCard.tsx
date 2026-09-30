import type { DeviceType } from "@pulsedesk/contracts";
import {
  selectLiveDeviceBreakdown,
  selectLiveSessions,
  selectTopLivePages,
} from "@pulsedesk/state";
import { Card, CardContent, CardHeader, EmptyState, Skeleton } from "@pulsedesk/ui";
import { MousePointerClick } from "lucide-react";
import { useAppSelector } from "@/app/hooks";
import { formatPercent } from "@/lib/format";
import { deviceIcons, deviceLabels } from "@/features/sessions/presentation";

const DEVICE_ORDER: DeviceType[] = ["desktop", "mobile", "tablet"];

export function LivePagesCard({ loading, className }: { loading: boolean; className?: string }) {
  const pages = useAppSelector(selectTopLivePages);
  const devices = useAppSelector(selectLiveDeviceBreakdown);
  const liveCount = useAppSelector((state) => selectLiveSessions(state).length);
  const maxCount = pages[0]?.count ?? 1;

  return (
    <Card className={className}>
      <CardHeader title="Where visitors are now" description="Current page of live sessions" />
      <CardContent aria-busy={loading || undefined}>
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : pages.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={<MousePointerClick className="size-5" />}
            title="Nobody browsing right now"
            description="Live pages appear as soon as a visitor arrives."
          />
        ) : (
          <>
            <ol className="space-y-3">
              {pages.map(({ path, count }) => (
                <li key={path}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate font-mono text-[13px] text-fg">{path}</span>
                    <span className="shrink-0 text-fg-muted tabular-nums">{count}</span>
                  </div>
                  <div aria-hidden="true" className="mt-1.5 h-1.5 rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-chart"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>

            <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4">
              {DEVICE_ORDER.map((device) => {
                const Icon = deviceIcons[device];
                return (
                  <div key={device} className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <Icon aria-hidden="true" className="size-3.5" />
                      {deviceLabels[device]}
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium text-fg tabular-nums">
                      {liveCount === 0 ? "—" : formatPercent(devices[device] / liveCount)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
