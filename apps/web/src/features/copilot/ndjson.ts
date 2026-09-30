/**
 * Splits a streamed body into lines. Network reads end anywhere (mid-line, even mid
 * UTF-8 character), so text is decoded in streaming mode and only complete lines are
 * yielded. A final line without a trailing newline is still yielded; blank lines aren't.
 *
 * Aborting `signal` cancels a pending read and throws the abort reason, whether or not
 * the stream's producer reacts to the abort itself.
 */
export async function* readLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const onAbort = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.trim()) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Stopping early (cancel, error, break) must release the network stream too.
    reader.releaseLock();
    await body.cancel().catch(() => {});
  }
}
