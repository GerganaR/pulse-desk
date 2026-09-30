import type { StatusFilter } from "@pulsedesk/state";

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "closed", label: "Ended" },
];

/** URL params are user input: anything unexpected falls back to the default. */
export function parseStatusFilter(value: string | null): StatusFilter {
  return STATUS_FILTERS.some((f) => f.value === value) ? (value as StatusFilter) : "all";
}
