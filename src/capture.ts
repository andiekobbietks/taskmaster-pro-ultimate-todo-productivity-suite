/**
 * The capture manifest and the capture jobs.
 *
 * The app holds the manifest — the list of pages to capture — and the
 * jobs. The runner asks the app what to do rather than holding a
 * configuration file of its own, so the two cannot drift apart.
 */
import { Hono } from "hono";
import { readSettings, type CaptureSource } from "./settings.ts";

function now(): number {
  return Date.now();
}

export function registerCaptureRoutes(app: Hono, sql: any) {
  // --- The manifest ----------------------------------------------------
  app.get("/api/capture/manifest", (c) => {
    const settings = readSettings(sql);
    const capture = settings.capture || {};
    return c.json({
      sources: capture.sources || [],
      batch_size: capture.batch_size ?? 10,
      keep_archive: capture.keep_archive ?? true,
      output_dir: capture.output_dir || "captures",
    });
  });

  // --- The jobs --------------------------------------------------------
  app.get("/api/capture/jobs", (c) => {
    const status = c.req.query("status");
    const rows = status
      ? sql.exec("SELECT * FROM capture_jobs WHERE status = ? ORDER BY created_at DESC", status).toArray()
      : sql.exec("SELECT * FROM capture_jobs ORDER BY created_at DESC LIMIT 200").toArray();
    return c.json(rows.map((r: any) => ({
      id: r.id,
      source_url: r.source_url,
      name: r.name,
      status: r.status,
      wacz_size: r.wacz_size,
      extracted: safeJson(r.extracted_json),
      error: r.error,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })));
  });

  // The queued ones, for a runner that only wants work.
  app.get("/api/capture/queue", (c) => {
    const limit = parseInt(c.req.query("limit") || "10", 10);
    const rows = sql
      .exec("SELECT * FROM capture_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?", limit)
      .toArray();
    return c.json(rows.map((r: any) => ({
      id: r.id,
      source_url: r.source_url,
      name: r.name,
      output_dir: readSettings(sql).capture?.output_dir || "captures",
    })));
  });

  app.get("/api/capture/jobs/:id", (c) => {
    const rows = sql.exec("SELECT * FROM capture_jobs WHERE id = ?", c.req.param("id")).toArray();
    if (rows.length === 0) return c.json({ error: "Capture job not found" }, 404);
    const r = rows[0];
    return c.json({
      id: r.id, source_url: r.source_url, name: r.name, status: r.status,
      wacz_size: r.wacz_size, extracted: safeJson(r.extracted_json),
      error: r.error, created_at: r.created_at, updated_at: r.updated_at,
    });
  });

  // --- Enqueue ---------------------------------------------------------
  // Either one page, or everything in the manifest.
  app.post("/api/capture/jobs", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      // An empty body is fine.
    }

    const settings = readSettings(sql);
    const manifest: CaptureSource[] = settings.capture?.sources || [];

    let wanted: CaptureSource[] = [];
    if (body.all) {
      wanted = manifest.filter((s) => s.enabled !== false && s.url);
    } else if (body.url) {
      wanted = [{ url: body.url, name: body.name || body.url }];
    } else if (manifest.length > 0) {
      wanted = manifest.filter((s) => s.enabled !== false && s.url);
    }

    if (wanted.length === 0) {
      return c.json({
        error: "Nothing to capture. Add a source to the capture manifest in Settings, " +
               "or post a url.",
      }, 400);
    }

    const batch = body.all ? (settings.capture?.batch_size ?? 10) : 1;
    const created = [];
    for (const source of wanted.slice(0, batch)) {
      // The same page twice in a row is not queued twice.
      const existing = sql
        .exec("SELECT id FROM capture_jobs WHERE source_url = ? AND status IN ('queued','running')",
              source.url)
        .toArray();
      if (existing.length > 0) {
        created.push({ id: existing[0].id, source_url: source.url, already: true });
        continue;
      }
      const id = "cap-" + Date.now().toString(36) + "-" +
        Math.random().toString(36).slice(2, 8);
      const ts = now();
      sql.exec(
        `INSERT INTO capture_jobs (id, source_url, name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?)`,
        id, source.url, source.name || source.url, ts, ts
      ).toArray();
      created.push({ id, source_url: source.url, name: source.name || "" });
    }

    return c.json({ ok: true, created, queued: created.length }, 201);
  });

  // --- The runner reports back ----------------------------------------
  app.post("/api/capture/jobs/:id/result", async (c) => {
    const id = c.req.param("id");
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      // An empty body means it failed.
    }

    const rows = sql.exec("SELECT id FROM capture_jobs WHERE id = ?", id).toArray();
    if (rows.length === 0) return c.json({ error: "Capture job not found" }, 404);

    const status = body.status || (body.error ? "failed" : "done");
    sql.exec(
      "UPDATE capture_jobs SET status = ?, wacz_size = ?, extracted_json = ?, error = ?, updated_at = ? WHERE id = ?",
      status, body.wacz_size || 0,
      JSON.stringify(body.extracted || {}), body.error || "", now(), id
    ).toArray();

    return c.json({ ok: true, id, status });
  });
}

function safeJson(value: any): any {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
