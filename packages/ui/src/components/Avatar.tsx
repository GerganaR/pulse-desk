import { cx } from "../lib/cx.ts";

const sizes = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-11 text-sm",
} as const;

// Static class list so Tailwind can see every class at build time.
const palettes = [
  "bg-accent-soft text-accent",
  "bg-live-soft text-live",
  "bg-info-soft text-info",
  "bg-warning-soft text-warning",
  "bg-danger-soft text-danger",
] as const;

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[#\d]+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return name.replace(/\D/g, "").slice(-2) || "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export interface AvatarProps {
  name: string;
  /** Stable seed for the colour (e.g. visitor id). Defaults to name. */
  seed?: string;
  size?: keyof typeof sizes;
  className?: string;
}

/** Initials avatar with a deterministic colour, so SSR and client render identically. */
export function Avatar({ name, seed = name, size = "md", className }: AvatarProps) {
  const palette = palettes[hash(seed) % palettes.length];
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums",
        sizes[size],
        palette,
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
