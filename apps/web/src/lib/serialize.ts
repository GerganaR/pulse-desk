const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const unsafeChars: Record<string, string> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "&": "\\u0026",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};

// Built from char codes on purpose: SWC re-emits U+2028 inside a regex *literal* as the
// raw line-separator character, which is a line terminator and breaks the parse.
const UNSAFE_PATTERN = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g");

/**
 * JSON-serialise data for embedding inside an inline <script>.
 *
 * Plain JSON.stringify is not safe here: a string containing `</script>` would terminate
 * the script element and allow injection (session data originates from visitors, so this
 * is a real vector, not a theoretical one). U+2028/2029 are escaped for older JS parsers.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_PATTERN, (char) => unsafeChars[char] ?? char);
}
