/** Ports and URLs of the E2E stack, shared by the Playwright config and specs. */
export const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);
/** The same production build plus devtools (the reliability panel), for fault-injection tests. */
export const DEVTOOLS_WEB_PORT = Number(process.env.E2E_DEVTOOLS_PORT ?? 3102);
export const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? 4150);
export const AI_SERVICE_PORT = Number(process.env.E2E_AI_SERVICE_PORT ?? 4160);

export const webUrl = `http://localhost:${WEB_PORT}`;
export const devtoolsWebUrl = `http://localhost:${DEVTOOLS_WEB_PORT}`;
export const gatewayHttp = `http://localhost:${GATEWAY_PORT}`;
export const aiServiceHttp = `http://localhost:${AI_SERVICE_PORT}`;
