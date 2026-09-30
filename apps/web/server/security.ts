import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";

export function createNonce(): string {
  return randomBytes(16).toString("base64");
}

interface CspOptions {
  nonce: string;
  /** Extra origins allowed for scripts/styles/fonts (the dev asset server). */
  assetOrigins: string[];
  /** Origins the page may open connections to (realtime gateway, HMR socket). */
  connectOrigins: string[];
}

/**
 * Strict, nonce-based CSP. React applies the nonce to the bootstrap scripts it emits, so
 * no inline script runs without it — a meaningful defence for an app that renders
 * visitor-supplied data (page titles, element labels).
 *
 * `style-src 'unsafe-inline'` is a deliberate concession: React/Tailwind rely on inline
 * style attributes for dynamic values (e.g. virtualised list offsets), and style
 * injection is far lower risk than script injection.
 */
export function contentSecurityPolicy({ nonce, assetOrigins, connectOrigins }: CspOptions): string {
  const assets = assetOrigins.join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${assets}`,
    `style-src 'self' 'unsafe-inline' ${assets}`,
    `font-src 'self' ${assets}`,
    "img-src 'self' data:",
    `connect-src 'self' ${connectOrigins.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ]
    .map((directive) => directive.trim())
    .join("; ");
}

export function setSecurityHeaders(res: ServerResponse, csp: string) {
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}
