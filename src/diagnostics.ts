import { Hono } from "hono";

export function logDiagnostic(sql: any, level: string, source: string, message: string, payload?: any) {
  try {
    sql.exec(
      "INSERT INTO diagnostics (ts, level, source, message, payload) VALUES (?, ?, ?, ?, ?)",
      Date.now(), level, source, message, JSON.stringify(payload ?? {})
    );
  } catch {
    // Logging must never take the worker down.
  }
}

export function registerDiagnosticsRoutes(app: Hono, sql: any) {
  app.get("/api/diagnostics", (c) => {
    try {
      const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
      const rows = sql.exec(
        "SELECT id, ts, level, source, message, payload FROM diagnostics ORDER BY ts DESC LIMIT ?",
        limit
      ).toArray();
      return c.json({ diagnostics: rows });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/diagnostics", async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch (e) {
      // Malformed client payloads are not server errors; log them at info so
      // the diagnostics table stays useful, but return 400, not 500.
      logDiagnostic(sql, "info", "client", "Malformed diagnostics payload", { error: String(e) });
      return c.json({ ok: false, error: "Invalid JSON" }, 400);
    }
    try {
      logDiagnostic(sql, body.level || "info", body.source || "client", body.message || "", body.payload);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ ok: false, error: String(e) }, 500);
    }
  });
}

export function errorLoggingMiddleware(sql: any) {
  return async (c: any, next: any) => {
    try {
      await next();
      const status = c.res?.status ?? 200;
      if (status >= 500) {
        logDiagnostic(sql, "error", "http", `HTTP ${status} on ${c.req.method} ${c.req.path}`, {
          method: c.req.method,
          path: c.req.path,
          status,
        });
      }
    } catch (err) {
      logDiagnostic(sql, "error", "http", `Uncaught ${c.req.method} ${c.req.path}: ${String(err)}`, {
        method: c.req.method,
        path: c.req.path,
      });
      throw err;
    }
  };
}
