// @vitest-environment node
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, createNonce, setSecurityHeaders } from "./security";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values];
    }),
  );

describe("content security policy", () => {
  const production = contentSecurityPolicy({
    nonce: "abc123",
    assetOrigins: [],
    connectOrigins: ["ws://gateway.example"],
  });

  it("lets scripts run only from this origin or with this response's nonce", () => {
    expect(directives(production)["script-src"]).toEqual(["'self'", "'nonce-abc123'"]);
  });

  it("never allows inline or evaluated scripts", () => {
    // The page renders visitor-supplied text (page titles, element labels).
    for (const csp of [
      production,
      contentSecurityPolicy({
        nonce: "n",
        assetOrigins: ["http://localhost:3001"],
        connectOrigins: ["ws://localhost:3001"],
      }),
    ]) {
      const scripts = directives(csp)["script-src"];
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(scripts).not.toContain("*");
    }
  });

  it("forbids plugins, framing, foreign base URLs and foreign form targets", () => {
    expect(directives(production)).toMatchObject({
      "default-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
    });
  });

  it("allows connections only to this origin and the configured gateway", () => {
    expect(directives(production)["connect-src"]).toEqual(["'self'", "ws://gateway.example"]);
  });

  it("adds the development asset server to scripts, styles and fonts only", () => {
    const dev = directives(
      contentSecurityPolicy({
        nonce: "n",
        assetOrigins: ["http://localhost:3001"],
        connectOrigins: [],
      }),
    );
    for (const name of ["script-src", "style-src", "font-src"])
      expect(dev[name]).toContain("http://localhost:3001");
    expect(dev["img-src"]).toEqual(["'self'", "data:"]);
    expect(dev["connect-src"]).toEqual(["'self'"]);
  });

  it("is a well-formed header: no empty values or doubled separators", () => {
    expect(production).not.toMatch(/ {2}| ;|;;|; $/);
  });
});

describe("nonce", () => {
  it("is unpredictable and different for every response", () => {
    const nonces = new Set(Array.from({ length: 200 }, createNonce));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });
});

describe("security headers", () => {
  it("sets the policy and the hardening headers on the response", () => {
    const headers = new Map<string, string>();
    setSecurityHeaders(
      {
        setHeader: (name: string, value: string) => headers.set(name, value),
      } as unknown as ServerResponse,
      "default-src 'self'",
    );
    expect(Object.fromEntries(headers)).toEqual({
      "Content-Security-Policy": "default-src 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });
});
