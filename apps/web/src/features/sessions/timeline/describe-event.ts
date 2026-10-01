import type { RealtimeEvent } from "@pulsedesk/contracts";
import type { Tone } from "@pulsedesk/ui";
import {
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Keyboard,
  LogOut,
  Moon,
  MousePointerClick,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { currentAgent } from "@/lib/current-agent";
import { humanize } from "@/lib/format";

export interface EventPresentation {
  icon: LucideIcon;
  title: string;
  detail?: string;
  tone: Tone;
}

/**
 * How each event reads in the activity feed, or null to hide it. Visitor-supplied text
 * (page titles, button labels) is only ever rendered as text, never as HTML.
 */
export function describeEvent(event: RealtimeEvent): EventPresentation | null {
  switch (event.type) {
    case "session.created": {
      const { landingPath, referrer, startedAt } = event.payload.session;
      // Monitoring can begin mid-visit (script loaded late, or the collector restarted).
      const joinedLate = event.timestamp - startedAt > JOINED_LATE_MS;
      return {
        icon: Globe,
        title: joinedLate ? "Joined session in progress" : "Session started",
        detail: referrer ? `Landed on ${landingPath} via ${referrer}` : `Landed on ${landingPath}`,
        tone: "accent",
      };
    }
    case "session.page_view":
      return {
        icon: FileText,
        title: `Viewed ${event.payload.title || event.payload.path}`,
        detail: event.payload.path,
        tone: "neutral",
      };
    case "session.click":
      return {
        icon: MousePointerClick,
        title: `Clicked “${event.payload.label || humanize(event.payload.element)}”`,
        detail: event.payload.path,
        tone: "info",
      };
    case "session.form_open":
      return {
        icon: ClipboardList,
        title: `Opened the ${humanize(event.payload.formId)} form`,
        tone: "info",
      };
    case "session.typing":
      // "Stopped typing" is noise in a human-facing feed.
      return event.payload.isTyping
        ? {
            icon: Keyboard,
            title: `Typing in ${humanize(event.payload.field)}`,
            detail: `${humanize(event.payload.formId)} form`,
            tone: "neutral",
          }
        : null;
    case "session.form_submit":
      return event.payload.success
        ? {
            icon: CheckCircle2,
            title: `Submitted the ${humanize(event.payload.formId)} form`,
            tone: "live",
          }
        : {
            icon: XCircle,
            title: `${capitalize(humanize(event.payload.formId))} submission failed`,
            detail: event.payload.errorCode ? humanize(event.payload.errorCode) : undefined,
            tone: "danger",
          };
    case "session.updated":
      return event.payload.status === "idle"
        ? { icon: Moon, title: "Went idle", detail: "No activity for a while", tone: "warning" }
        : { icon: Globe, title: `Status changed to ${event.payload.status}`, tone: "neutral" };
    case "session.closed":
      return {
        icon: LogOut,
        title: "Session ended",
        detail: humanize(event.payload.reason),
        tone: "neutral",
      };
    case "presence.joined":
      return {
        icon: Eye,
        title: `${agentName(event.payload.agent)} started viewing`,
        tone: "neutral",
      };
    case "presence.left":
      return {
        icon: EyeOff,
        title: `${agentName(event.payload.agent)} stopped viewing`,
        tone: "neutral",
      };
  }
}

const presentations = new WeakMap<RealtimeEvent, EventPresentation | null>();

/**
 * `describeEvent`, remembered per event object. Events in the store are immutable, so a
 * timeline of thousands is described once per event, not once per render.
 */
export function presentationOf(event: RealtimeEvent): EventPresentation | null {
  let presentation = presentations.get(event);
  if (presentation === undefined) {
    presentation = describeEvent(event);
    presentations.set(event, presentation);
  }
  return presentation;
}

const JOINED_LATE_MS = 10_000;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const agentName = (agent: { id: string; name: string }) =>
  agent.id === currentAgent.id ? "You" : agent.name;
