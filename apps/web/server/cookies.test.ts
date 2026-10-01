// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readCookie } from "./cookies";

describe("readCookie", () => {
  it.each<[string, string | undefined, string | undefined]>([
    ["no Cookie header", undefined, undefined],
    ["an empty header", "", undefined],
    ["the only cookie", "pd-theme=dark", "dark"],
    ["one of several, with spaces", "a=1;  pd-theme=light ; b=2", "light"],
    ["a name that only ends the same", "not-pd-theme=dark", undefined],
    ["a value containing '='", "pd-theme=a=b", "a=b"],
    ["an encoded value", "pd-theme=d%61rk", "dark"],
    ["a part with no '='", "garbage; pd-theme=dark", "dark"],
    ["an undecodable value", "pd-theme=%E0%A4%A", undefined],
  ])("%s", (_, header, expected) => {
    expect(readCookie(header, "pd-theme")).toBe(expected);
  });

  it("returns the first match when a name is repeated", () => {
    expect(readCookie("pd-theme=dark; pd-theme=light", "pd-theme")).toBe("dark");
  });
});
