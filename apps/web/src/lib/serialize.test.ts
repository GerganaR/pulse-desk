import { describe, expect, it } from "vitest";
import { serializeForScript } from "./serialize";

describe("serializeForScript", () => {
  it("cannot break out of a script element", () => {
    const output = serializeForScript({ path: "</script><script>alert(1)</script>" });
    expect(output).not.toContain("</script>");
    expect(output).not.toContain("<");
  });

  it("escapes U+2028/U+2029", () => {
    const output = serializeForScript(String.fromCharCode(0x2028, 0x2029));
    expect(output).toBe('"\\u2028\\u2029"');
  });

  it("round-trips through JSON.parse", () => {
    const separators = String.fromCharCode(0x2028, 0x2029);
    const value = { a: `<b>&${separators}</b>`, n: 1, nested: [null, true] };
    expect(JSON.parse(serializeForScript(value))).toEqual(value);
  });
});
