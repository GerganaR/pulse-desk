import "#zod-setup";
import * as z from "zod/mini";
import { nonEmptyString, nonNegativeInt, urlPath } from "./primitives.ts";

/**
 * Session domain model shared by the gateway, simulator, web app and AI service.
 *
 * Deliberately excludes anything that would identify a visitor beyond what a support
 * agent needs (no IP, no raw user agent, no form field values).
 */

export const SessionStatusSchema = z.enum(["active", "idle", "closed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const DeviceTypeSchema = z.enum(["desktop", "tablet", "mobile"]);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const VisitorSchema = z.object({
  id: nonEmptyString,
  /** Stable, human-friendly label such as "Visitor #3291". */
  label: nonEmptyString,
  /** Present only when the visitor has identified themselves (e.g. logged in). */
  name: z.nullable(nonEmptyString),
  country: z.string().check(z.length(2)),
  city: nonEmptyString,
});
export type Visitor = z.infer<typeof VisitorSchema>;

export const SessionSchema = z.object({
  id: nonEmptyString,
  visitor: VisitorSchema,
  device: DeviceTypeSchema,
  browser: nonEmptyString,
  os: nonEmptyString,
  referrer: z.nullable(z.string()),
  landingPath: urlPath,
  currentPath: urlPath,
  status: SessionStatusSchema,
  startedAt: nonNegativeInt,
  lastActivityAt: nonNegativeInt,
  endedAt: z.nullable(nonNegativeInt),
  pageViews: nonNegativeInt,
  eventCount: nonNegativeInt,
});
export type Session = z.infer<typeof SessionSchema>;

/** Team member (support/sales agent) currently viewing a session. */
export const AgentSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
});
export type Agent = z.infer<typeof AgentSchema>;
