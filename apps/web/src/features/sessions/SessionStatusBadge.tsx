import type { SessionStatus } from "@pulsedesk/contracts";
import { StatusBadge } from "@pulsedesk/ui";
import { sessionStatusPresentation } from "./presentation";

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { label, tone, pulse } = sessionStatusPresentation[status];
  return <StatusBadge tone={tone} label={label} pulse={pulse} />;
}
