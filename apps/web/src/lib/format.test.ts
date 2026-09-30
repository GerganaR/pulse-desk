import { describe, expect, it } from "vitest";
import { formatCount, formatDuration, formatRelative } from "./format";

describe("formatRelative", () => {
  it.each([
    [-2_000, "now"],
    [0, "now"],
    [4_999, "now"],
    [12_000, "12s ago"],
    [4 * 60_000 + 59_000, "4m ago"],
    [2 * 3_600_000, "2h ago"],
    [3 * 86_400_000, "3d ago"],
  ])("%i ms → %s", (ms, expected) => {
    expect(formatRelative(ms)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it.each([
    [-5, "0s"],
    [42_000, "42s"],
    [8 * 60_000 + 22_000, "8m 22s"],
    [8 * 60_000 + 2_000, "8m 02s"],
    [3_600_000 + 4 * 60_000, "1h 04m"],
  ])("%i ms → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("formatCount", () => {
  it("groups thousands and compacts large values", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(12_900)).toBe("12.9K");
  });
});
