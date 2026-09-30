import { createLogger, errorFields, jsonConsoleSink } from "@pulsedesk/observability";
import { ConfigError, loadConfig, type AIServiceConfig } from "./config.ts";
import { createAIService } from "./server.ts";

const logger = createLogger({
  sink: jsonConsoleSink,
  level: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
  fields: { service: "ai-service" },
});

let config: AIServiceConfig;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  logger.error("ai.config_invalid", { error: error.message });
  process.exit(1);
}

const service = createAIService({ config, logger });

try {
  const port = await service.listen();
  logger.info("ai.listening", {
    http: `http://localhost:${port}`,
    provider: config.provider.kind,
    debug: config.debug || undefined,
  });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  logger.error(code === "EADDRINUSE" ? "ai.port_in_use" : "ai.start_failed", {
    port: config.port,
    ...errorFields(error),
    hint: code === "EADDRINUSE" ? "Set AI_SERVICE_PORT to a free port" : undefined,
  });
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("ai.shutdown", { signal });
  const force = setTimeout(() => process.exit(0), 5_000);
  force.unref();
  await service.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
