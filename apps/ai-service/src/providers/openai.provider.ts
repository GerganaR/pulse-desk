import type { AIServiceRequest } from "@pulsedesk/contracts";
import { buildMessages } from "../prompts/system.ts";
import { ProviderError, type AIProvider, type FinishReason } from "./types.ts";

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  /** Any OpenAI-compatible Chat Completions endpoint. */
  baseUrl: string;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
}

/** Splits a byte stream into lines, across chunk boundaries (SSE and NDJSON alike). */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

interface CompletionChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
}

/**
 * Real model provider over the Chat Completions streaming API (server-sent events). The
 * API key never leaves ai-service; the browser only ever talks to the web server.
 */
export function createOpenAIProvider({
  apiKey,
  model,
  baseUrl,
  maxOutputTokens = 600,
  fetch: fetchImpl = fetch,
}: OpenAIProviderOptions): AIProvider {
  return {
    model,
    async *stream(
      request: AIServiceRequest,
      signal: AbortSignal,
    ): AsyncGenerator<string, FinishReason> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: true,
            temperature: 0.2,
            max_completion_tokens: maxOutputTokens,
            messages: buildMessages(request),
          }),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ProviderError("The AI provider couldn't be reached");
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new ProviderError(
          response.status === 429
            ? "The AI provider is rate limiting requests"
            : `The AI provider responded ${response.status}`,
          response.status,
        );
      }

      let finish: FinishReason = "stop";
      for await (const line of readLines(response.body)) {
        if (!line.startsWith("data:")) continue; // comments, event names, keep-alives
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        let chunk: CompletionChunk;
        try {
          chunk = JSON.parse(data) as CompletionChunk;
        } catch {
          throw new ProviderError("The AI provider sent a malformed stream");
        }
        const choice = chunk.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield text;
        if (choice?.finish_reason === "length") finish = "length";
      }
      return finish;
    },
  };
}
