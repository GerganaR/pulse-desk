import type * as z from "zod/mini";
import { ClientMessageSchema, ServerMessageSchema } from "./protocol.ts";

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: DecodeError };

export type DecodeError =
  | { kind: "invalid_json"; message: string }
  | { kind: "invalid_shape"; issues: readonly z.core.$ZodIssue[] };

/**
 * Validate untrusted data against a schema. TypeScript types describe what we *expect*
 * from the network; this is what makes that expectation true at runtime.
 */
export function decode<S extends z.ZodMiniType>(
  schema: S,
  input: unknown,
): DecodeResult<z.infer<S>> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: { kind: "invalid_shape", issues: result.error.issues } };
}

export function decodeJson<S extends z.ZodMiniType>(
  schema: S,
  raw: string,
): DecodeResult<z.infer<S>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "invalid_json",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return decode(schema, parsed);
}

export const decodeServerMessage = (raw: string) => decodeJson(ServerMessageSchema, raw);
export const decodeClientMessage = (raw: string) => decodeJson(ClientMessageSchema, raw);
