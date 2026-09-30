import { selectConnection, type ConnectionState } from "@pulsedesk/state";
import { ConnectionIndicator, type ConnectionStatus } from "@pulsedesk/ui";
import { useAppSelector } from "@/app/hooks";
import { useNow } from "@/lib/clock";

function toIndicatorStatus(connection: ConnectionState): ConnectionStatus {
  switch (connection.status) {
    case "live":
      return "live";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "offline";
    case "idle":
    case "connecting":
    case "syncing":
      // A reconnect in progress reads as "reconnecting", not a fresh "connecting".
      return connection.reconnectAttempt > 0 ? "reconnecting" : "connecting";
  }
}

function RetryCountdown({ at }: { at: number }) {
  const seconds = Math.max(0, Math.ceil((at - useNow()) / 1_000));
  return <>{seconds > 0 ? `retry in ${seconds}s` : "retrying…"}</>;
}

/**
 * Connection status for the app chrome. Deliberately quiet: one pill that changes
 * state, no toasts per reconnect. SSR renders "Connecting" (the socket only opens on the
 * client), which matches the client's initial state, so there's no hydration mismatch.
 */
export function LiveConnectionIndicator() {
  const connection = useAppSelector(selectConnection);
  const status = toIndicatorStatus(connection);

  const detail =
    connection.status === "reconnecting" && connection.nextRetryAt !== null ? (
      <RetryCountdown at={connection.nextRetryAt} />
    ) : connection.sync ? (
      "catching up"
    ) : undefined;

  return <ConnectionIndicator status={status} detail={detail} />;
}
