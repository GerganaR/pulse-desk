import { cx } from "@pulsedesk/ui";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-7 shrink-0">
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <path
          d="M5 17h5l3-7 5 13 3-6h6"
          fill="none"
          className="stroke-accent-fg"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-fg">PulseDesk</span>
    </span>
  );
}
