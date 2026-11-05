import type { MiddlewareHandler } from "hono";

/**
 * Shared-secret gate for API routes.
 *
 * Only /health is public. Internal scheduled work must use the same bearer
 * token as external callers; the Worker cron handler supplies it explicitly.
 * Leaving API_TOKEN unset is supported for local development only. Production
 * deployments must configure it with `wrangler secret put API_TOKEN`.
 */
export function apiTokenAuth(env: { API_TOKEN?: string }): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === "/health") return next();

    const token = env.API_TOKEN;
    if (!token) return next();

    const header = c.req.header("Authorization") || "";
    const bearer = header.startsWith("Bearer ")
      ? header.slice(7)
      : c.req.query("api_token");

    if (!bearer || bearer !== token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}
