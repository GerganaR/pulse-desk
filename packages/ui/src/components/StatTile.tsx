import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import { Skeleton } from "./Skeleton.tsx";

export interface StatTileProps {
  /** Sentence case, no trailing colon. */
  label: string;
  value: ReactNode;
  /** Secondary line under the value: context, comparison or breakdown. */
  detail?: ReactNode;
  /** Small leading element next to the label, e.g. a live status dot. */
  indicator?: ReactNode;
  loading?: boolean;
  className?: string;
}

/**
 * A single headline number. Renders <dt>/<dd>, so place tiles inside a <dl> — the grid
 * of stats is then a proper description list for assistive tech.
 * Values use proportional figures (large standalone numbers look loose with tabular-nums).
 */
export function StatTile({
  label,
  value,
  detail,
  indicator,
  loading = false,
  className,
}: StatTileProps) {
  return (
    <div
      className={cx("rounded-xl border border-line bg-surface px-5 py-4 shadow-card", className)}
    >
      <dt className="flex items-center gap-2 text-sm text-fg-muted">
        {indicator}
        {label}
      </dt>
      <dd className="mt-2">
        {loading ? (
          <>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="mt-2 h-4 w-28" />
          </>
        ) : (
          <>
            <span className="block text-2xl font-semibold tracking-tight text-fg sm:text-[1.75rem]">
              {value}
            </span>
            {detail && <span className="mt-1 block text-xs text-fg-muted">{detail}</span>}
          </>
        )}
      </dd>
    </div>
  );
}
