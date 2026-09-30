import { createLogger, errorFields, jsonConsoleSink } from "@pulsedesk/observability";
import { loadConfig } from "./config.ts";
import { createGateway } from "./gateway.ts";

const config = loadConfig();
const logger = createLogger({
  sink: jsonConsoleSink,
  level: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
  fields: { service: "realtime-gateway" },
});

const gateway = createGateway({ config, logger });

try {
  const port = await gateway.listen();
  logger.info("gateway.listening", {
    http: `http://localhost:${port}`,
    ws: `ws://localhost:${port}/ws`,
    streamId: gateway.log.streamId,
  });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  logger.error(code === "EADDRINUSE" ? "gateway.port_in_use" : "gateway.start_failed", {
    port: config.port,
    ...errorFields(error),
    hint: code === "EADDRINUSE" ? "Set GATEWAY_PORT to a free port" : undefined,
  });
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("gateway.shutdown", { signal });
  const force = setTimeout(() => process.exit(0), 5_000);
  force.unref();
  await gateway.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
