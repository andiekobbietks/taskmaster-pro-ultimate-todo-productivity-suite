import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";

/**
 * Escape LIKE metacharacters so a search for "100%" matches a literal "100%"
 * instead of turning into a match-everything wildcard.
 *
 * ============================ WHY THIS EXISTS ============================
 * The original search handler interpolated user input straight into a LIKE
 * pattern:
 *
 *     params.push(`%${search}%`)
 *
 * `%` and `_` are not literal characters in SQL LIKE -- they are wildcards.
 * So the user's search text was silently reinterpreted as a *pattern*:
 *
 *     search = "100%"   ->  pattern "%100%%"  ->  matches EVERY row
 *     search = "a_b"    ->  pattern "%a_b%"  ->  matches "aXb", "axb", ...
 *
 * A user searching for "budget 100% done" got their entire todo list back
 * and would reasonably read that as "everything matches this". There was no
 * error, no warning, and the response looked completely healthy. This is the
 * worst shape of bug: a wrong answer that looks like a right one.
 *
 * Note the string is still *wrapped* in wildcards on purpose -- search is a
 * substring match, "port" should find "import". We only neutralise
 * metacharacters the user typed, we never change the matching semantics.
 *
 * ============================ WHAT IT ENABLES ============================
 *     ?search=100%      -> only todos whose text literally contains "100%"
 *     ?search=a_b       -> only todos containing literal "a_b"
 *     ?search=port      -> "import", "export", "transport"   (unchanged)
 *     ?search=50% off   -> sales-discount todos, not every todo in the table
 *
 * The backslash is the ESCAPE character declared on the query as ESCAPE '\'.
 * Both halves are required: escaping without the clause leaves a stray
 * backslash in the data, and the clause without escaping leaves the wildcard
 * live. If you ever change one, change both.
 *
 * Backslash itself is escaped first so an existing "\%" in user input
 * cannot consume the escape character we are about to add.
 *
 * See scripts/tier1-check.mjs, which fails CI if this helper is ever deleted
 * while the search route still interpolates into a LIKE pattern.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class App extends DurableObject {
  private app = new Hono();

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.initDb();
    
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

      // ============================ WHY THIS EXISTS ============================
      // `tag` was read from the query string, validated as present, and then
      // never used. The route built its SQL from `status`, `priority`,
      // `search` and `listId` only -- `tag` was dead weight.
      //
      // The failure was invisible because the response shape was correct.
      // Callers got 200 and a well-formed todo array, just not the one they
      // asked for:
      //
      //     GET /api/todos?tag=urgent   ->  returned all 12 todos
      //     GET /api/todos              ->  returned all 12 todos
      //
      // Identical. Meanwhile the README documented tag filtering as a
      // supported feature, so this was not merely broken -- it was broken
      // *and* advertised. Anyone who trusted the docs and filtered by tag
      // got the whole database back and, again, nothing looked wrong.
      //
      // This is the exact defect class that scripts/tier1-check.mjs now
      // blocks in CI: a parameter read from the request and dropped before
      // it reaches the SQL.
      //
      // ============================ WHY json_each =============================
      // `tags` is stored as a JSON array inside a TEXT column, so a plain
      // `tags LIKE '%urgent%'` would also match "not_urgent", "urgent_ish"
      // and any description that happened to mention the word. Matching the
      // parsed element instead makes "urgent" mean exactly the tag "urgent":
      //
      //     tags = ["urgent","work"]   ?tag=urgent  -> match
      //     tags = ["not_urgent"]      ?tag=urgent  -> NO match  (substring would match)
      //
      // ============================ WHAT IT ENABLES ============================
      //     GET /api/todos?tag=urgent    -> only todos carrying that tag
      //     combined with status/priority/search, they AND together
      //     unfiltered requests are unchanged: an absent tag skips the clause
      if (tag) {
        query += " AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)";
        params.push(tag);
      }

      if (search) {
        const pattern = `%${escapeLike(search)}%`;
        query += " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
        params.push(pattern, pattern);
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
};

export default worker;
