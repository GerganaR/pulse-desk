import type { DeviceType, SessionStatus, Visitor } from "@pulsedesk/contracts";
import type { Tone } from "@pulsedesk/ui";
import { Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";

/** Domain → design-system mapping lives in the app, keeping @pulsedesk/ui domain-free. */
export const sessionStatusPresentation: Record<
  SessionStatus,
  { label: string; tone: Tone; pulse: boolean }
> = {
  active: { label: "Active", tone: "live", pulse: true },
  idle: { label: "Idle", tone: "warning", pulse: false },
  closed: { label: "Ended", tone: "neutral", pulse: false },
};

export const deviceIcons: Record<DeviceType, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

export const deviceLabels: Record<DeviceType, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
};

/** Identified visitors show their name; anonymous ones their stable label. */
export const visitorDisplayName = (visitor: Visitor) => visitor.name ?? visitor.label;

/**
 * Avatar text source. Anonymous visitors use their number ("#8961" → "61") rather than
 * the word "Visitor", which would give every anonymous avatar the same "V".
 */
export const visitorAvatarName = (visitor: Visitor) =>
  visitor.name ?? visitor.label.replace(/^Visitor\s*/, "");
