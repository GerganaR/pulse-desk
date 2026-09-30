import { selectConnection, type ConnectionState } from "@pulsedesk/state";
import { Button } from "@pulsedesk/ui";
import { RotateCw, WifiOff } from "lucide-react";
import { useAppSelector } from "@/app/hooks";
import { useNow } from "@/lib/clock";
import { formatDuration } from "@/lib/format";
import { PROLONGED_OUTAGE_MS } from "./outage";
import { useRealtimeClient } from "./RealtimeProvider";

/**
 * Non-modal notice for a *prolonged* outage only. Short blips are handled by the status
 * pill alone; after PROLONGED_OUTAGE_MS the page says plainly that what's on screen is no
 * longer live, and offers a manual retry. It disappears as soon as the connection is back.
 *
 * Never rendered on the server (the connection only exists in the browser), so it can't
 * cause a hydration mismatch.
 */
export function OutageBanner() {
  const connection = useAppSelector(selectConnection);
  const client = useRealtimeClient();
  return <OutageNotice connection={connection} onRetry={() => client.reconnectNow()} />;
}

export function OutageNotice({
  connection,
  onRetry,
}: {
  connection: ConnectionState;
  onRetry: () => void;
}) {
  // 1 s granularity is enough to cross the threshold and tick the "for 42s" text.
  const now = useNow();

  const { disconnectedAt, status, network, nextRetryAt } = connection;
  if (disconnectedAt === null || status === "live" || status === "closed") return null;
  const downFor = now - disconnectedAt;
  if (downFor < PROLONGED_OUTAGE_MS) return null;

  const offline = network === "offline";
  const retryIn = nextRetryAt !== null ? Math.max(0, Math.ceil((nextRetryAt - now) / 1_000)) : null;

  return (
    <div
      role="status"
      className="mb-5 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 sm:flex-row sm:items-center"
      data-testid="outage-banner"
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-fg">
            {offline ? "You're offline" : "Live updates paused"}
            <span className="font-normal text-fg-muted"> · for {formatDuration(downFor)}</span>
          </p>
          <p className="text-fg-muted">
            {offline
              ? "What you see may be out of date. Updates resume automatically when your connection returns."
              : "What you see may be out of date. PulseDesk keeps retrying and will catch up on everything it missed."}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        onClick={onRetry}
        disabled={status !== "reconnecting"}
        leadingIcon={<RotateCw aria-hidden="true" className="size-3.5" />}
      >
        {retryIn !== null && retryIn > 0 ? `Retry now (${retryIn}s)` : "Retry now"}
      </Button>
    </div>
  );
}
