import type { MiddlewareHandler } from "hono";

const SESSION_COOKIE = "tm_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sessionSignature(token: string, expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`taskmaster-session:v1:${expiresAt}`),
  );
  return toBase64Url(new Uint8Array(signature));
}

async function isValidSession(value: string, token: string): Promise<boolean> {
  const [expiresText, suppliedSignature, extra] = value.split(".");
  if (!expiresText || !suppliedSignature || extra !== undefined) return false;
  const expiresAt = Number(expiresText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_TTL_SECONDS + 60) {
    return false;
  }

  try {
    const expected = await sessionSignature(token, expiresAt);
    return constantTimeEqual(suppliedSignature, expected);
  } catch {
    return false;
  }
}

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function securityConfigurationError(env: {
  API_TOKEN?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  APP_ENV?: string;
}): boolean {
  return env.APP_ENV !== "development" && (!env.API_TOKEN || !env.SETTINGS_ENCRYPTION_KEY);
}

/**
 * Shared-secret gate for API routes.
 *
 * Browser sessions use a signed, HttpOnly, SameSite=Strict cookie. The shared
 * token itself is never returned to or stored by browser JavaScript. External
 * API clients and the Worker's scheduled calls may use a bearer token.
 */
export function apiTokenAuth(env: {
  API_TOKEN?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  APP_ENV?: string;
}): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (
      path === "/health" ||
      path === "/api/auth/login" ||
      path === "/api/auth/logout"
    ) return next();

    if (securityConfigurationError(env)) {
      return c.json({ error: "Service security configuration is incomplete" }, 503);
    }

    // Explicit development mode is the only mode that can run without secrets.
    if (env.APP_ENV === "development" && !env.API_TOKEN) return next();

    const token = env.API_TOKEN;
    if (!token) return c.json({ error: "Service security configuration is incomplete" }, 503);

    const header = c.req.header("Authorization") || "";
    const bearer = header.startsWith("Bearer ")
      ? header.slice(7)
      : c.req.query("api_token");
    if (bearer && constantTimeEqual(bearer, token)) return next();

    const session = cookieValue(c.req.header("Cookie") || "", SESSION_COOKIE);
    if (session && await isValidSession(session, token)) {
      // SameSite cookies are site-scoped, not origin-scoped. Check Origin on
      // unsafe browser requests as a second CSRF boundary for sibling origins.
      if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method.toUpperCase())) {
        const origin = c.req.header("Origin");
        if (!origin || origin !== new URL(c.req.url).origin) {
          return c.json({ error: "Cross-origin request rejected" }, 403);
        }
      }
      return next();
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}

/** Register browser login/logout endpoints without exposing API_TOKEN. */
export function registerAuthRoutes(app: any, env: {
  API_TOKEN?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  APP_ENV?: string;
}): void {
  app.post("/api/auth/login", async (c: any) => {
    if (securityConfigurationError(env) || !env.API_TOKEN) {
      return c.json({ error: "Service security configuration is incomplete" }, 503);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "A login token is required" }, 400);
    }

    if (typeof body?.token !== "string" || !constantTimeEqual(body.token, env.API_TOKEN)) {
      return c.json({ error: "Invalid access token" }, 401);
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const signature = await sessionSignature(env.API_TOKEN, expiresAt);
    const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
    c.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=${expiresAt}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
    );
    return c.json({ ok: true, expires_at: expiresAt * 1000 });
  });

  app.post("/api/auth/logout", (c: any) => {
    const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
    c.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    );
    return c.json({ ok: true });
  });
}
