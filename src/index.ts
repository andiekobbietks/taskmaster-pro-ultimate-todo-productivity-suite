import { DurableObject } from "cloudflare:workers";
import { registerHackathonRoutes } from "./hackathons";
import { registerAttachmentRoutes } from "./attachments";
import { registerArchiveRoutes } from "./archive";
import { registerSettingsRoutes } from "./settings";
import { registerCapacityRoutes } from "./capacity";
import { registerInboxRoutes } from "./inbox";
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

    // Rate limiting middleware (100 requests per minute per IP)
    this.app.use("/*", async (c, next) => {
      const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
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
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        completed INTEGER DEFAULT 0,
        priority TEXT DEFAULT 'medium',
        due_date TEXT DEFAULT NULL,
        list_id TEXT DEFAULT 'inbox',
        tags TEXT DEFAULT '[]',
        is_pinned INTEGER DEFAULT 0,
        estimated_pomodoros INTEGER DEFAULT 1,
        pomodoro_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER DEFAULT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS hackathons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT DEFAULT 'manual',
        url TEXT DEFAULT '',
        description TEXT DEFAULT '',
        prize TEXT DEFAULT '',
        start_date TEXT DEFAULT NULL,
        end_date TEXT DEFAULT NULL,
        registration_deadline TEXT DEFAULT NULL,
        submission_deadline TEXT DEFAULT NULL,
        eligibility_json TEXT DEFAULT '{}',
        status TEXT DEFAULT 'open',
        notes TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS hackathon_profile (
        id TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BLOB NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS archive_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        api_key TEXT DEFAULT NULL,
        enabled INTEGER DEFAULT 1,
        base_url TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS capacity (
        day_of_week INTEGER PRIMARY KEY,
        hours_available REAL NOT NULL DEFAULT 0,
        notes TEXT DEFAULT ''
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        body_preview TEXT DEFAULT '',
        body_html TEXT DEFAULT '',
        has_attachments INTEGER DEFAULT 0,
        attachment_names TEXT DEFAULT '[]',
        is_platform INTEGER DEFAULT 0,
        platform TEXT DEFAULT NULL,
        ticket_id TEXT DEFAULT NULL,
        read INTEGER DEFAULT 0,
        processed INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        match_confidence REAL DEFAULT 0,
        match_method TEXT DEFAULT 'none'
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        ip TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        window_start INTEGER NOT NULL
      )
    `);
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
    return this.app.fetch(request);
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
  },
};

export default worker;
