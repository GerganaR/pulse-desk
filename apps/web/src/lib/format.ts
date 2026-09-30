/**
 * Formatting helpers. All locale-sensitive output uses an explicit locale so server and
 * browser produce identical strings — implicit locales are a classic hydration-mismatch
 * source. Absolute wall-clock times are only rendered after hydration (they depend on
 * the viewer's time zone, which the server doesn't know).
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const integer = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

export const formatCount = (value: number) =>
  value >= 10_000 ? compact.format(value) : integer.format(value);
export const formatDecimal = (value: number) => oneDecimal.format(value);
export const formatPercent = (ratio: number) => percent.format(ratio);

/** "now", "12s ago", "4m ago", "2h ago", "3d ago". Future times (clock skew) read as "now". */
export function formatRelative(elapsedMs: number): string {
  if (elapsedMs < 5 * SECOND) return "now";
  if (elapsedMs < MINUTE) return `${Math.floor(elapsedMs / SECOND)}s ago`;
  if (elapsedMs < HOUR) return `${Math.floor(elapsedMs / MINUTE)}m ago`;
  if (elapsedMs < DAY) return `${Math.floor(elapsedMs / HOUR)}h ago`;
  return `${Math.floor(elapsedMs / DAY)}d ago`;
}

/** "42s", "8m 22s", "1h 04m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Offset from a start time as "+02:31" or "+1:02:31" — time-zone free, hydration safe. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `+${hours}:${minutes}:${seconds}` : `+${minutes}:${seconds}`;
}

/** "contact_sales" → "contact sales"; used for ids that come from tracking plans. */
export const humanize = (identifier: string) => identifier.replace(/[_-]+/g, " ").trim();
