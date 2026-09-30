import { cx } from "../lib/cx.ts";

const sizes = { sm: "size-3.5", md: "size-4", lg: "size-6" } as const;

export interface SpinnerProps {
  size?: keyof typeof sizes;
  /** Accessible label. Omit when the spinner is decorative (e.g. inside a labelled button). */
  label?: string;
  className?: string;
}

export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const svg = (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cx("shrink-0 animate-spin motion-reduce:animate-none", sizes[size], className)}
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );

  if (!label) return svg;
  return (
    <span role="status" className="inline-flex">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
