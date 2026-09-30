export type ClassValue = string | false | null | undefined;

/**
 * Joins class names, skipping falsy values.
 *
 * Intentionally not tailwind-merge: component `className` props are for *layout*
 * (margins, width, grid placement), while visual changes go through variants. That
 * keeps class conflicts out by design instead of resolving them at runtime.
 */
export function cx(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
