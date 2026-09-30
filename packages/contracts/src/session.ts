import { z } from "zod";

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
  id: z.string().min(1),
  /** Stable, human-friendly label such as "Visitor #3291". */
  label: z.string().min(1),
  /** Present only when the visitor has identified themselves (e.g. logged in). */
  name: z.string().min(1).nullable(),
  country: z.string().length(2),
  city: z.string().min(1),
});
export type Visitor = z.infer<typeof VisitorSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  visitor: VisitorSchema,
  device: DeviceTypeSchema,
  browser: z.string().min(1),
  os: z.string().min(1),
  referrer: z.string().nullable(),
  landingPath: z.string().startsWith("/"),
  currentPath: z.string().startsWith("/"),
  status: SessionStatusSchema,
  startedAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  pageViews: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Team member (support/sales agent) currently viewing a session. */
export const AgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type Agent = z.infer<typeof AgentSchema>;
