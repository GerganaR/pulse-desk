import { Badge, type Tone } from "./Badge.tsx";
import { StatusDot } from "./StatusDot.tsx";

export interface StatusBadgeProps {
  tone: Tone;
  label: string;
  pulse?: boolean;
  className?: string;
}

/** Badge with a leading status dot. Domain → tone mapping lives with the caller. */
export function StatusBadge({ tone, label, pulse, className }: StatusBadgeProps) {
  return (
    <Badge tone={tone} className={className}>
      <StatusDot tone={tone} pulse={pulse} />
      {label}
    </Badge>
  );
}
