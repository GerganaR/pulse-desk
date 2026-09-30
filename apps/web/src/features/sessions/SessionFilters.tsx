import { selectStatusCounts, type StatusFilter } from "@pulsedesk/state";
import { cx, Input } from "@pulsedesk/ui";
import { Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useAppSelector } from "@/app/hooks";
import { formatCount } from "@/lib/format";
import { STATUS_FILTERS } from "./filters";

export function SessionFilters({ status, query }: { status: StatusFilter; query: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const counts = useAppSelector(selectStatusCounts);

  const hrefFor = (value: StatusFilter) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    const search = next.toString();
    return search ? `?${search}` : "?";
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Links, not buttons: each filter is a URL (shareable, back/forward, SSR). */}
      <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {STATUS_FILTERS.map(({ value, label }) => {
          const current = value === status;
          return (
            <Link
              key={value}
              to={hrefFor(value)}
              replace
              preventScrollReset
              aria-current={current ? "true" : undefined}
              className={cx(
                "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors",
                current
                  ? "bg-surface text-fg shadow-card ring-1 ring-line"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {label}
              <span className="text-xs text-fg-subtle tabular-nums">
                {formatCount(counts[value])}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="relative sm:w-72">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          type="search"
          aria-label="Search sessions"
          placeholder="Search visitor, city or page"
          className="pl-9"
          value={query}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams);
            if (event.target.value) next.set("q", event.target.value);
            else next.delete("q");
            // replace: typing shouldn't create one history entry per keystroke
            setSearchParams(next, { replace: true, preventScrollReset: true });
          }}
        />
      </div>
    </div>
  );
}
