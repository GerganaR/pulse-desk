const env = process.env;
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== "" ? parsed : fallback;
};

export type ProviderConfig =
  | { kind: "mock"; tokenMs: number; firstTokenDelayMs: number }
  | { kind: "openai"; apiKey: string; model: string; baseUrl: string };

export interface AIServiceConfig {
  host: string;
  port: number;
  provider: ProviderConfig;
  /** No first token within this → the stream ends with a `timeout` error chunk. */
  firstTokenTimeoutMs: number;
  /** Hard ceiling for one answer, first token to last. */
  totalTimeoutMs: number;
  maxConcurrentStreams: number;
  maxBodyBytes: number;
  /**
   * Development diagnostics: honour the fault header from the reliability panel and
   * expose recent request outcomes. Never enable in production.
   */
  debug: boolean;
  /** Delay added per token by the "slow" fault. */
  slowTokenMs: number;
}

export class ConfigError extends Error {}

function providerConfig(): ProviderConfig {
  const kind = env.AI_PROVIDER ?? "mock";
  if (kind === "mock")
    return {
      kind,
      tokenMs: number(env.AI_MOCK_TOKEN_MS, 35),
      firstTokenDelayMs: number(env.AI_MOCK_FIRST_TOKEN_MS, 400),
    };
  if (kind === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    const model = env.OPENAI_MODEL;
    if (!apiKey || !model)
      throw new ConfigError("AI_PROVIDER=openai needs OPENAI_API_KEY and OPENAI_MODEL");
    return {
      kind,
      apiKey,
      model,
      baseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    };
  }
  throw new ConfigError(`Unknown AI_PROVIDER "${kind}" (expected "mock" or "openai")`);
}

export function loadConfig(): AIServiceConfig {
  return {
    host: env.AI_SERVICE_HOST ?? "0.0.0.0",
    // Not `PORT`: turbo passes PORT through for the web app.
    port: number(env.AI_SERVICE_PORT, 4100),
    provider: providerConfig(),
    firstTokenTimeoutMs: number(env.AI_FIRST_TOKEN_TIMEOUT_MS, 10_000),
    totalTimeoutMs: number(env.AI_TOTAL_TIMEOUT_MS, 45_000),
    maxConcurrentStreams: number(env.AI_MAX_CONCURRENT_STREAMS, 100),
    // A full context (200 events) is ~30 KB.
    maxBodyBytes: 256 * 1024,
    debug: env.AI_DEBUG === "1",
    slowTokenMs: number(env.AI_SLOW_TOKEN_MS, 250),
  };
}
