import type { AIAction } from "@pulsedesk/contracts";
import {
  CircleAlert,
  FileText,
  ListOrdered,
  MessageSquareText,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";

export interface QuickAction {
  action: Exclude<AIAction, "ask">;
  /** Button text. */
  label: string;
  /** How the request reads in the conversation. */
  question: string;
  icon: LucideIcon;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { action: "summarize", label: "Summarise", question: "Summarise this session", icon: FileText },
  {
    action: "blockers",
    label: "What's blocking?",
    question: "What's blocking this visitor?",
    icon: CircleAlert,
  },
  {
    action: "suggest_reply",
    label: "Suggest reply",
    question: "Suggest a reply to the visitor",
    icon: MessageSquareText,
  },
  {
    action: "anomalies",
    label: "Unusual behaviour",
    question: "Anything unusual in this session?",
    icon: ScanSearch,
  },
  {
    action: "key_events",
    label: "Key events",
    question: "List the key events only",
    icon: ListOrdered,
  },
];

export function questionFor(action: AIAction, prompt: string): string {
  return QUICK_ACTIONS.find((quick) => quick.action === action)?.question ?? prompt;
}
