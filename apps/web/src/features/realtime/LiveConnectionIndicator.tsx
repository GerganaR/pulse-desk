import { selectConnection, type ConnectionState } from "@pulsedesk/state";
import { ConnectionIndicator, type ConnectionStatus } from "@pulsedesk/ui";
import { useAppSelector } from "@/app/hooks";
import { useNow } from "@/lib/clock";
import { formatCount, formatLatency } from "@/lib/format";

export function toIndicatorStatus(connection: ConnectionState): ConnectionStatus {
  if (connection.network === "offline" && connection.status !== "live") return "offline";
  switch (connection.status) {
    case "live":
      return connection.degraded ? "degraded" : "live";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "offline";
    case "syncing":
      // Catching up after a reconnect, or resyncing a gap on a live socket. The routine
      // first sync after page load reads as plain "connecting".
      if (
        connection.liveSince !== null ||
        (connection.sync && connection.sync.reason !== "initial")
      )
        return "syncing";
      return connection.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    case "idle":
    case "connecting":
      // A reconnect in progress reads as "reconnecting", not a fresh "connecting".
      return connection.reconnectAttempt > 0 ? "reconnecting" : "connecting";
  }
}

function RetryCountdown({ at }: { at: number }) {
  const seconds = Math.max(0, Math.ceil((at - useNow()) / 1_000));
  return <>{seconds > 0 ? `retry in ${seconds}s` : "retrying…"}</>;
}

function detailFor(connection: ConnectionState, status: ConnectionStatus) {
  switch (status) {
    case "reconnecting":
      if (connection.status !== "reconnecting") return undefined;
      return connection.nextRetryAt !== null ? (
        <RetryCountdown at={connection.nextRetryAt} />
      ) : (
        "waiting for network"
      );
    case "syncing": {
      const sync = connection.sync;
      if (!sync) return undefined;
      const count = Math.max(0, sync.toSequence - sync.fromSequence + 1);
      return `${formatCount(count)} event${count === 1 ? "" : "s"}`;
    }
    case "degraded":
      return connection.rttMs !== null ? formatLatency(connection.rttMs) : "slow";
    case "offline":
      return connection.network === "offline" ? "no network" : undefined;
    case "live":
    case "connecting":
      return undefined;
  }
}

/**
 * Connection status for the app chrome. Deliberately quiet: one pill that changes
 * state, no toasts per reconnect. SSR renders "Connecting" (the socket only opens on the
 * client), which matches the client's initial state, so there's no hydration mismatch.
 */
export function LiveConnectionIndicator() {
  const connection = useAppSelector(selectConnection);
  const status = toIndicatorStatus(connection);
  return <ConnectionIndicator status={status} detail={detailFor(connection, status)} />;
}
