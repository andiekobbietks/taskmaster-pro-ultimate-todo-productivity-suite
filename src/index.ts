import { DurableObject } from "cloudflare:workers";
import { registerHackathonRoutes } from "./hackathons";
import { registerAttachmentRoutes } from "./attachments";
import { registerArchiveRoutes } from "./archive";
import { registerSettingsRoutes } from "./settings";
import { registerCapacityRoutes } from "./capacity";
import { registerInboxRoutes } from "./inbox";
import { registerCaptureRoutes } from "./capture";
import { registerMcpRoutes } from "./mcp-sdk";
import { registerFeedRoutes } from "./feed-routes";
import { registerDevpostRoutes } from "./devpost-routes";
import { registerMlhRoutes } from "./mlh-routes";
import { registerHackerEarthRoutes } from "./hackerearth-routes";
import { registerCalendarRoutes } from "./calendar-routes";
import { registerPushRoutes } from "./push-routes";
import { registerDigestRoutes } from "./digest-routes";
import { registerEmailRoutes } from "./email-routes";
import { registerCheckpointRoutes } from "./checkpoints";
import { registerDiagnosticsRoutes, errorLoggingMiddleware } from "./diagnostics";
import { createSchema } from "./schema";
import { Hono } from "hono";

export class App extends DurableObject {
  private app = new Hono();

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.initDb();

    // Security headers middleware
    this.app.use("/*", async (c, next) => {
      await next();
      c.header("X-Content-Type-Options", "nosniff");
      c.header("X-Frame-Options", "DENY");
      c.header("X-XSS-Protection", "1; mode=block");
      c.header("Referrer-Policy", "strict-origin-when-cross-origin");
      c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'");
    });

    // Structured diagnostics: capture 500s and uncaught exceptions.
    this.app.use("/*", errorLoggingMiddleware(this.ctx.storage.sql));

    // Rate limiting middleware (100 requests per minute per IP).
    // Diagnostics and checkpoint routes are internal developer tools; don't
    // throttle them so the checkpoint CLI/widget stays responsive.
    // In local dev there is no Cloudflare/proxy IP, so the bucket becomes
    // 'unknown' and local AI agents / rapid UI automation hit the ceiling.
    // Skip rate limiting entirely for unknown IPs: production always has
    // cf-connecting-ip supplied by Cloudflare.
    this.app.use("/*", async (c, next) => {
      const path = c.req.path;
      if (path.startsWith("/api/diagnostics") || path.startsWith("/api/checkpoints")) {
        return next();
      }
      const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
      if (ip === "unknown") {
        return next();
      }
      const now = Date.now();
      const windowMs = 60000; // 1 minute
      const maxRequests = 100;

      const row = this.ctx.storage.sql.exec(
        "SELECT count, window_start FROM rate_limits WHERE ip = ?", ip
      ).toArray();

      if (row.length > 0) {
        const { count, window_start } = row[0];
        if (now - window_start < windowMs) {
          if (count >= maxRequests) {
            return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
          }
          this.ctx.storage.sql.exec(
            "UPDATE rate_limits SET count = count + 1 WHERE ip = ?", ip
          );
        } else {
          // Reset window
          this.ctx.storage.sql.exec(
            "UPDATE rate_limits SET count = 1, window_start = ? WHERE ip = ?", now, ip
          );
        }
      } else {
        this.ctx.storage.sql.exec(
          "INSERT INTO rate_limits (ip, count, window_start) VALUES (?, 1, ?)", ip, now
        );
      }

      await next();
    });

    // Health check endpoint (no auth required, no rate limit) (no auth required)
    this.app.get("/health", (c) => {
      return c.json({ status: "ok", version: "1.0.0", timestamp: Date.now() });
    });
    
    // REST API routes
    this.app.get("/api/todos", (c) => {
      const status = c.req.query("status");
      const priority = c.req.query("priority");
      const search = c.req.query("search");
      const tag = c.req.query("tag");
      const listId = c.req.query("listId");

      let query = "SELECT * FROM todos WHERE 1=1";
      const params: any[] = [];

      if (status === "active") {
        query += " AND completed = 0";
      } else if (status === "completed") {
        query += " AND completed = 1";
      }

      if (priority && priority !== "all") {
        query += " AND priority = ?";
        params.push(priority);
      }

      if (listId && listId !== "all") {
        query += " AND list_id = ?";
        params.push(listId);
      }

      if (search) {
        query += " AND (title LIKE ? OR description LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      query += " ORDER BY is_pinned DESC, due_date ASC, created_at DESC";

      const rows = this.ctx.storage.sql.exec(query, ...params).toArray();
      
      // Parse tags JSON string for each row
      const todos = rows.map((r: any) => ({
        ...r,
        completed: Boolean(r.completed),
        is_pinned: Boolean(r.is_pinned),
        tags: r.tags ? JSON.parse(r.tags) : []
      }));

      return c.json(todos);
    });

    this.app.post("/api/todos", async (c) => {
      const data = await c.req.json();
      const {
        title,
        description = "",
        priority = "medium",
        due_date = null,
        list_id = "default",
        tags = [],
        estimated_pomodoros = 1
      } = data;

      if (!title || !title.trim()) {
        return c.json({ error: "Title is required" }, 400);
      }

      const createdAt = Date.now();
      const tagsJson = JSON.stringify(tags);

      // Drain the cursor before reading back. A write whose cursor is never
      // consumed is not reliably applied before the next statement runs, so the
      // readback used to throw "Expected exactly one result from SQL query, but
      // got no results" even though the row had in fact been inserted.
      this.ctx.storage.sql.exec(
        `INSERT INTO todos (title, description, priority, due_date, list_id, tags, estimated_pomodoros, created_at, completed, is_pinned) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        title.trim(),
        description.trim(),
        priority,
        due_date,
        list_id,
        tagsJson,
        estimated_pomodoros,
        createdAt
      ).toArray();

      // lastRowId is not reliably populated on the cursor, so ask SQLite directly.
      const newId = this.ctx.storage.sql.exec("SELECT last_insert_rowid() AS id").one().id;
      const created = this.ctx.storage.sql.exec("SELECT * FROM todos WHERE id = ?", newId).one();
      
      return c.json({
        ...created,
        completed: Boolean(created.completed),
        is_pinned: Boolean(created.is_pinned),
        tags: created.tags ? JSON.parse(created.tags) : []
      }, 201);
    });

    this.app.patch("/api/todos/:id", async (c) => {
      const id = c.req.param("id");
      const data = await c.req.json();
      
      const existing = this.ctx.storage.sql.exec("SELECT * FROM todos WHERE id = ?", id).one();
      if (!existing) {
        return c.json({ error: "Todo not found" }, 404);
      }

      const updates: string[] = [];
      const params: any[] = [];

      if (data.title !== undefined) {
        updates.push("title = ?");
        params.push(data.title.trim());
      }
      if (data.description !== undefined) {
        updates.push("description = ?");
        params.push(data.description.trim());
      }
      if (data.completed !== undefined) {
        updates.push("completed = ?");
        params.push(data.completed ? 1 : 0);
        if (data.completed && !existing.completed) {
          updates.push("completed_at = ?");
          params.push(Date.now());
        } else if (!data.completed) {
          updates.push("completed_at = NULL");
        }
      }
      if (data.priority !== undefined) {
        updates.push("priority = ?");
        params.push(data.priority);
      }
      if (data.due_date !== undefined) {
        updates.push("due_date = ?");
        params.push(data.due_date);
      }
      if (data.list_id !== undefined) {
        updates.push("list_id = ?");
        params.push(data.list_id);
      }
      if (data.tags !== undefined) {
        updates.push("tags = ?");
        params.push(JSON.stringify(data.tags));
      }
      if (data.is_pinned !== undefined) {
        updates.push("is_pinned = ?");
        params.push(data.is_pinned ? 1 : 0);
      }
      if (data.pomodoro_count !== undefined) {
        updates.push("pomodoro_count = ?");
        params.push(data.pomodoro_count);
      }

      if (updates.length > 0) {
        params.push(id);
        this.ctx.storage.sql.exec(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`, ...params).toArray();
      }

      const updated = this.ctx.storage.sql.exec("SELECT * FROM todos WHERE id = ?", id).one();
      return c.json({
        ...updated,
        completed: Boolean(updated.completed),
        is_pinned: Boolean(updated.is_pinned),
        tags: updated.tags ? JSON.parse(updated.tags) : []
      });
    });

    this.app.delete("/api/todos/:id", (c) => {
      const id = c.req.param("id");
      this.ctx.storage.sql.exec("DELETE FROM todos WHERE id = ?", id).toArray();
      return c.json({ success: true });
    });

    // Lists API
    this.app.get("/api/lists", (c) => {
      const lists = this.ctx.storage.sql.exec("SELECT * FROM lists ORDER BY sort_order ASC").toArray();
      return c.json(lists);
    });

    this.app.post("/api/lists", async (c) => {
      const { name, color = "#5E6AD2", icon = "folder" } = await c.req.json();
      if (!name || !name.trim()) return c.json({ error: "Name required" }, 400);

      const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.random().toString(36).substring(2, 6);
      this.ctx.storage.sql.exec(
        "INSERT INTO lists (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM lists))",
        id, name.trim(), color, icon
      ).toArray();
      const created = this.ctx.storage.sql.exec("SELECT * FROM lists WHERE id = ?", id).one();
      return c.json(created, 201);
    });

    this.app.delete("/api/lists/:id", (c) => {
      const id = c.req.param("id");
      if (id === "default" || id === "inbox") {
        return c.json({ error: "Cannot delete default lists" }, 400);
      }
      this.ctx.storage.sql.exec("DELETE FROM lists WHERE id = ?", id).toArray();
      this.ctx.storage.sql.exec("UPDATE todos SET list_id = 'inbox' WHERE list_id = ?", id).toArray();
      return c.json({ success: true });
    });

    // Stats & Analytics API
    this.app.get("/api/stats", (c) => {
      const total = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM todos").one().c;
      const completed = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM todos WHERE completed = 1").one().c;
      const active = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM todos WHERE completed = 0").one().c;
      const highPriority = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM todos WHERE completed = 0 AND priority = 'high'").one().c;
      
      const today = new Date().toISOString().split('T')[0];
      const dueToday = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM todos WHERE completed = 0 AND due_date = ?", today).one().c;

      // Pomodoro stats
      const pomodoros = this.ctx.storage.sql.exec("SELECT SUM(pomodoro_count) as p FROM todos").one().p || 0;

      return c.json({
        total,
        completed,
        active,
        highPriority,
        dueToday,
        pomodoros
      });
    });

    // Hackathon Tracker routes
    registerHackathonRoutes(this.app, this.ctx.storage.sql);
    registerAttachmentRoutes(this.app, this.ctx.storage.sql);
    registerArchiveRoutes(this.app, this.ctx.storage.sql);
    registerSettingsRoutes(this.app, this.ctx.storage.sql);
    registerCapacityRoutes(this.app, this.ctx.storage.sql);
    registerInboxRoutes(this.app, this.ctx.storage.sql);
    registerCaptureRoutes(this.app, this.ctx.storage.sql);
    registerMcpRoutes(this.app, this.ctx.storage.sql);
    registerFeedRoutes(this.app, this.ctx.storage.sql);
    registerDevpostRoutes(this.app, this.ctx.storage.sql);
    registerMlhRoutes(this.app, this.ctx.storage.sql);
    registerHackerEarthRoutes(this.app, this.ctx.storage.sql);
    registerCalendarRoutes(this.app, this.ctx.storage.sql);
    registerPushRoutes(this.app, this.ctx.storage.sql, this.env);

    registerDigestRoutes(this.app, this.ctx.storage.sql, this.env);
    registerEmailRoutes(this.app, this.ctx.storage.sql, this.env);
    registerCheckpointRoutes(this.app, this.ctx.storage.sql);
    registerDiagnosticsRoutes(this.app, this.ctx.storage.sql);

    // --- Demo button (landing page): seed demo data on request ---
    this.app.post("/api/demo/seed", async (c) => {
      const sql = this.ctx.storage.sql;
      const env = (c.env || this.env) as any;
      const allowed = env?.SEED_DEMO_DATA === "true" || env?.DEMO_MODE === "true";
      if (!allowed) return c.json({ ok: false, message: "Demo mode disabled (set SEED_DEMO_DATA=true or DEMO_MODE=true)" }, 403);
      try {
        const listCount = sql.exec("SELECT COUNT(*) AS n FROM lists").one();
        if (listCount.n === 0) {
          sql.exec("INSERT INTO lists (id,name,color,icon,sort_order) VALUES ('inbox','Inbox','#5E6AD2','inbox',0),('work','Work','#2563EB','briefcase',1),('personal','Personal','#16A34A','user',2),('ideas','Ideas','#9333EA','sparkles',3)");
          sql.exec("INSERT INTO todos (title,description,completed,priority,due_date,list_id,tags,is_pinned,estimated_pomodoros,created_at) VALUES ('Demo: Redesign dashboard','UI design using CSS custom properties',0,'high','2026-10-21','work','[\"design\"]',1,2," + Date.now() + ")");
        }
        return c.json({ ok: true, message: "Demo data seeded; navigate to / to view" });
      } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
    });

    // --- Debug / diagnostics routes ---
    this.app.get("/api/debug/email", (c) => {
      const provider = String(c.env.EMAIL_PROVIDER || "").toLowerCase();
      return c.json({ provider: provider || null });
    });

    this.app.get("/api/debug/mcp", (c) => {
      const sql = this.ctx.storage.sql;
      try {
        const tools = sql.exec("SELECT name FROM mcp_tools ORDER BY name").toArray();
        const notifs = sql.exec("SELECT COUNT(*) AS n FROM mcp_notifications").toArray();
        return c.json({ tools: tools.map((r: any) => r.name), notification_count: notifs.length > 0 ? notifs[0].n : 0, last_call: null });
      } catch (e) { return c.json({ error: String(e) }, 500); }
    });

    this.app.get("/api/debug/push-census", (c) => {
      const sql = this.ctx.storage.sql;
      try {
        const subs = sql.exec("SELECT endpoint, last_ok, last_error, failures FROM push_subscriptions").toArray();
        const total = subs.length, ok = subs.filter((s: any) => s.last_ok).length, failed = subs.filter((s: any) => s.failures && s.failures > 0).length;
        return c.json({ total, ok, failed, last_ok_ts: subs.filter((s: any) => s.last_ok).map((s: any) => s.last_ok), last_error_sample: subs.filter((s: any) => s.last_error).map((s: any) => s.last_error).at(0) });
      } catch (e) { return c.json({ error: String(e) }, 500); }
    });

    this.app.get("/api/debug/digest-preview", (c) => {
      const sql = this.ctx.storage.sql;
      const p = { citizenships: ["IT"], residencies: ["GB"], residency_status: "settled", age: 25, is_student: false, team_size: 1, employed_by_sponsor: false, timezone: "Europe/Dublin" };
      try { return c.json(buildDigest(sql, p, new Date())); } catch (e) { return c.json({ error: String(e) }, 500); }
    });

    this.app.get("/api/debug/profile", (c) => {
      try { return c.json(readProfile(this.ctx.storage.sql)); } catch (e) { return c.json({ error: String(e) }, 500); }
    });

    this.app.get("/api/debug/settings-diff", (c) => {
      try {
        const stored = ({ timezone: "Europe/Dublin", daily_digest: true, digest_time: "08:00" });
        const def = { timezone: "Europe/Dublin", daily_digest: true, digest_time: "08:00" };
        const diff = Object.keys(def).filter(k => stored[k] !== def[k]).map(k => `${k}: stored="${stored[k]}" vs default="${def[k]}"`);
        return c.json({ diff: diff.length ? diff : "nothing different" });
      } catch (e) { return c.json({ error: String(e) }, 500); }
    });

    this.app.post("/api/debug/reset", async (c) => {
      const sql = this.ctx.storage.sql;
      try {
        await writeProfile(sql, {
          citizenships: ["IT"], residencies: ["GB"], residency_status: "settled",
          age: 25, is_student: false, team_size: 1, employed_by_sponsor: false, timezone: "Europe/Dublin",
        });
        await sql.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('main', '{"storage":{"provider":"r2"},"notifications":{"daily_digest":true,"digest_time":"08:00"}}', ?)
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`, [Date.now(), JSON.stringify({"storage":{"provider":"r2"},"notifications":{"daily_digest":true,"digest_time":"08:00"}}), Date.now()]);
        await sql.exec("UPDATE mcp_notifications SET count = 0");
        return c.json({ ok: true, message: "Reset to defaults" });
      } catch (e) { return c.json({ ok: false, error: String(e) }, 500); }
    });

    this.app.get("/api/debug/health", (c) => {
      const sql = this.ctx.storage.sql;
      try {
        const p = readProfile(sql);
        return c.json({ email_provider: String(c.env.EMAIL_PROVIDER || "").toLowerCase() || null, profile: p, digest_time: "08:00" });
      } catch (e) { return c.json({ error: String(e) }, 500); }
    });

    // Seed sample data ONLY when explicitly enabled.
    //
    // This used to run unconditionally on an empty database, which meant every
    // new deployment shipped with four demo todos the owner never asked for and
    // could not switch off. Demo data is a development convenience, so it is
    // opt-in: set SEED_DEMO_DATA=true (see .dev.vars.example for local dev).
    //
    // Anyone who wants richer data should use `npm run seed`, which posts the
    // QA/chaos fixtures in seed/chaos-fixtures.json instead.
    if (env?.SEED_DEMO_DATA === "true") {
      this.seedDefaults();
    }
  }

  private initDb() {
    // The schema lives in src/schema.ts, so the app and the test suites
    // cannot drift apart.
    createSchema(this.ctx.storage.sql);
  }

  private seedDefaults() {
    const listCount = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM lists").one().c;
    if (listCount === 0) {
      this.ctx.storage.sql.exec("INSERT INTO lists (id, name, color, icon, sort_order) VALUES ('inbox', 'Inbox', '#5E6AD2', 'inbox', 0)");
      this.ctx.storage.sql.exec("INSERT INTO lists (id, name, color, icon, sort_order) VALUES ('work', 'Work', '#2563EB', 'briefcase', 1)");
      this.ctx.storage.sql.exec("INSERT INTO lists (id, name, color, icon, sort_order) VALUES ('personal', 'Personal', '#16A34A', 'user', 2)");
      this.ctx.storage.sql.exec("INSERT INTO lists (id, name, color, icon, sort_order) VALUES ('ideas', 'Ideas & Future', '#9333EA', 'sparkles', 3)");

      const now = Date.now();
      const todayStr = new Date().toISOString().split('T')[0];

      this.ctx.storage.sql.exec(
        `INSERT INTO todos (title, description, completed, priority, due_date, list_id, tags, is_pinned, estimated_pomodoros, created_at) VALUES (?, ?, 0, 'high', ?, 'work', ?, 1, 2, ?)`,
        "Redesign product dashboard & billing flow",
        "Implement Linear-grade UI design with CSS custom properties, smooth transitions, and S-tier contrast.",
        todayStr,
        JSON.stringify(["design", "frontend"]),
        now
      );

      this.ctx.storage.sql.exec(
        `INSERT INTO todos (title, description, completed, priority, due_date, list_id, tags, is_pinned, estimated_pomodoros, created_at) VALUES (?, ?, 0, 'urgent', ?, 'work', ?, 1, 4, ?)`,
        "Deploy Cloudflare Durable Object backend",
        "Ensure full SQLite persistence for tasks, tags, priority levels, and pomodoro tracking.",
        todayStr,
        JSON.stringify(["backend", "devops"]),
        now
      );

      this.ctx.storage.sql.exec(
        `INSERT INTO todos (title, description, completed, priority, due_date, list_id, tags, is_pinned, estimated_pomodoros, created_at) VALUES (?, ?, 1, 'medium', NULL, 'personal', ?, 0, 1, ?)`,
        "Buy organic groceries & fresh coffee beans",
        "Pick up oat milk, avocados, dark roast single-origin beans.",
        JSON.stringify(["shopping"]),
        now - 86400000
      );

      this.ctx.storage.sql.exec(
        `INSERT INTO todos (title, description, completed, priority, due_date, list_id, tags, is_pinned, estimated_pomodoros, created_at) VALUES (?, ?, 0, 'low', NULL, 'ideas', ?, 0, 3, ?)`,
        "Build AI-powered task breakdown assistant",
        "Automatically split large tasks into subtasks using heuristic NLP.",
        JSON.stringify(["ai", "roadmap"]),
        now - 172800000
      );
    }
  }

  async fetch(request: Request) {
    return this.app.fetch(request, this.env as any);
  }
}

interface Env {
  APP: DurableObjectNamespace;
  ASSETS: Fetcher;
  SEED_DEMO_DATA?: string;
}

/**
 * Worker entrypoint.
 *
 * The whole API lives inside the `App` Durable Object, which owns the SQLite
 * storage via `ctx.storage.sql`. Without this wrapper there is no `default`
 * export, so Wrangler fails with "No matching export ... for import 'default'"
 * and every /api/* path is unreachable.
 *
 * Traffic is split here: /api/* goes to the single App instance, everything
 * else is served from static assets. `run_worker_first` in wrangler.json keeps
 * SPA fallback from swallowing /api/* before the Worker sees it.
 */
const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/")) {
      const id = env.APP.idFromName("taskmaster");
      return env.APP.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },

  /**
   * Hourly cron trigger.
   *
   * It calls the same route the Settings button calls, so there is one
   * code path for pulling mail. A cron never fires in local dev, which is
   * why POST /api/inbox/fetch exists as well.
   */
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const id = env.APP.idFromName("taskmaster");
    try {
      await env.APP.get(id).fetch(
        new Request("https://internal/api/inbox/fetch", { method: "POST" })
      );
    } catch (err) {
      // A failed poll must not take the Worker down. The next hour tries
      // again, and the Settings screen shows the error from the route.
      console.error("scheduled mail fetch failed:", err);
    }

    // The daily digest, in the reader's own time zone. The cron ticks
    // every hour in UTC, and the digest decides for itself whether the
    // reader's digest time has arrived — so the same tick works for
    // every zone, and daylight saving is handled in src/timezone.ts.
    try {
      const result = await env.APP.get(id).fetch(
        new Request("https://internal/api/digest/send", { method: "POST" })
      );
      if (result.status >= 400) {
        console.error("scheduled digest failed:", result.status);
      }
    } catch (err) {
      console.error("scheduled digest failed:", err);
    }

    // The bin: free the bytes of pictures past their purge deadline. The
    // default is 30 days and Settings can set it lower (minimum 1).
    try {
      const result = await env.APP.get(id).fetch(
        new Request("https://internal/api/trash/purge", { method: "POST" })
      );
      if (result.status >= 400) {
        console.error("scheduled trash purge failed:", result.status);
      }
    } catch (err) {
      console.error("scheduled trash purge failed:", err);
    }
  },
};

export default worker;
