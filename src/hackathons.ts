/**
 * Hackathon Tracker — Hono routes for the taskmaster-pro Durable Object.
 *
 * Design notes:
 * - All SQL is parameterised. No string concatenation of user input.
 * - The eligibility engine is a pure function: (rules, profile) => { eligible, reasons[] }.
 *   Rules are stored as JSON per hackathon so new hackathons need no code changes.
 * - Sync is a separate script (scripts/sync-hackathons.mjs) so the Worker stays stateless.
 */
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Hackathon {
  id: string;
  name: string;
  platform: string; // "devpost" | "mlh" | "lablab" | "manual"
  url: string;
  description: string;
  prize: string;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  submission_deadline: string | null;
  eligibility: EligibilityRules;
  status: string; // "open" | "registered" | "submitted" | "closed"
  notes: string;
  created_at: number;
  updated_at: number;
}

export interface EligibilityRules {
  age_min?: number;
  age_max?: number;
  countries?: string[]; // ISO 3166-1 alpha-2; empty/undefined = all
  student_only?: boolean;
  team_min?: number;
  team_max?: number;
  not_employee_of_sponsor?: boolean;
  other?: string; // free-text caveat
}

export interface UserProfile {
  age: number;
  country: string; // ISO 3166-1 alpha-2
  is_student: boolean;
  team_size: number;
  employed_by_sponsor: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Eligibility engine
// ---------------------------------------------------------------------------

export function evaluateEligibility(
  rules: EligibilityRules,
  profile: UserProfile,
): EligibilityResult {
  const reasons: string[] = [];

  if (rules.age_min !== undefined && profile.age < rules.age_min) {
    reasons.push(`Must be at least ${rules.age_min} years old`);
  }
  if (rules.age_max !== undefined && profile.age > rules.age_max) {
    reasons.push(`Must be at most ${rules.age_max} years old`);
  }
  if (
    rules.countries &&
    rules.countries.length > 0 &&
    !rules.countries.includes(profile.country)
  ) {
    reasons.push(
      `Open only to: ${rules.countries.join(", ")} (you are in ${profile.country})`,
    );
  }
  if (rules.student_only && !profile.is_student) {
    reasons.push("Students only");
  }
  if (rules.team_min !== undefined && profile.team_size < rules.team_min) {
    reasons.push(`Team must have at least ${rules.team_min} members`);
  }
  if (rules.team_max !== undefined && profile.team_size > rules.team_max) {
    rules.team_max !== undefined &&
      reasons.push(`Team must have at most ${rules.team_max} members`);
  }
  if (rules.not_employee_of_sponsor && profile.employed_by_sponsor) {
    reasons.push("Sponsor employees not eligible");
  }
  if (rules.other) {
    rules.other && reasons.push(rules.other);
  }

  return { eligible: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): number {
  return Date.now();
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToHackathon(r: any): Hackathon {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    url: r.url,
    description: r.description,
    prize: r.prize,
    start_date: r.start_date,
    end_date: r.end_date,
    registration_deadline: r.registration_deadline,
    submission_deadline: r.submission_deadline,
    eligibility: parseJson(r.eligibility_json, {}),
    status: r.status,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerHackathonRoutes(app: Hono, sql: any) {
  // --- List hackathons -----------------------------------------------------

  app.get("/api/hackathons", (c) => {
    const status = c.req.query("status");
    const eligible = c.req.query("eligible"); // "true" | "false" | undefined
    const search = c.req.query("search");

    let query = "SELECT * FROM hackathons WHERE 1=1";
    const params: any[] = [];

    if (status && status !== "all") {
      query += " AND status = ?";
      params.push(status);
    }
    if (search) {
      query += " AND (name LIKE ? OR description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    query +=
      " ORDER BY COALESCE(submission_deadline, end_date, start_date) ASC";

    const rows = sql.exec(query, ...params).toArray();
    let hackathons = rows.map(rowToHackathon);

    // Eligibility filter is applied post-query because it needs the profile.
    if (eligible === "true" || eligible === "false") {
      const profile = getUserProfile(sql);
      hackathons = hackathons.filter((h) => {
        const result = evaluateEligibility(h.eligibility, profile);
        return eligible === "true" ? result.eligible : !result.eligible;
      });
    }

    return c.json(hackathons);
  });

  // --- Get single hackathon ------------------------------------------------

  app.get("/api/hackathons/:id", (c) => {
    const id = c.req.param("id");
    const row = sql
      .exec("SELECT * FROM hackathons WHERE id = ?", id)
      .one();
    if (!row) return c.json({ error: "Hackathon not found" }, 404);
    return c.json(rowToHackathon(row));
  });

  // --- Create hackathon ----------------------------------------------------

  app.post("/api/hackathons", async (c) => {
    const data = await c.req.json();
    const {
      name,
      platform = "manual",
      url = "",
      description = "",
      prize = "",
      start_date = null,
      end_date = null,
      registration_deadline = null,
      submission_deadline = null,
      eligibility = {},
      status = "open",
      notes = "",
    } = data;

    if (!name || !name.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }

    const id = `hack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = now();
    const eligibilityJson = JSON.stringify(eligibility);

    sql.exec(
      `INSERT INTO hackathons
        (id, name, platform, url, description, prize, start_date, end_date,
         registration_deadline, submission_deadline, eligibility_json,
         status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      name.trim(),
      platform,
      url,
      description,
      prize,
      start_date,
      end_date,
      registration_deadline,
      submission_deadline,
      eligibilityJson,
      status,
      notes,
      ts,
      ts,
    );

    const row = sql
      .exec("SELECT * FROM hackathons WHERE id = ?", id)
      .one();
    return c.json(rowToHackathon(row), 201);
  });

  // --- Update hackathon ----------------------------------------------------

  app.patch("/api/hackathons/:id", async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();

    const existing = sql
      .exec("SELECT * FROM hackathons WHERE id = ?", id)
      .one();
    if (!existing) return c.json({ error: "Hackathon not found" }, 404);

    // Build dynamic SET clause from present keys only (same pattern as todos)
    const fieldMap: Record<string, string> = {
      name: "name",
      platform: "platform",
      url: "url",
      description: "description",
      prize: "prize",
      start_date: "start_date",
      end_date: "end_date",
      registration_deadline: "registration_deadline",
      submission_deadline: "submission_deadline",
      status: "status",
      notes: "notes",
    };

    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in data) {
        sets.push(`${col} = ?`);
        params.push(data[key]);
      }
    }

    if ("eligibility" in data) {
      sets.push("eligibility_json = ?");
      params.push(JSON.stringify(data.eligibility));
    }

    if (sets.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    sets.push("updated_at = ?");
    params.push(now());
    params.push(id);

    sql.exec(
      `UPDATE hackathons SET ${sets.join(", ")} WHERE id = ?`,
      ...params,
    );

    const row = sql
      .exec("SELECT * FROM hackathons WHERE id = ?", id)
      .one();
    return c.json(rowToHackathon(row));
  });

  // --- Delete hackathon ----------------------------------------------------

  app.delete("/api/hackathons/:id", (c) => {
    const id = c.req.param("id");
    const result = sql.exec("DELETE FROM hackathons WHERE id = ?", id);
    if (result.changes === 0) {
      return c.json({ error: "Hackathon not found" }, 404);
    }
    return c.json({ success: true });
  });

  // --- Eligibility check ---------------------------------------------------

  app.get("/api/hackathons/eligibility", (c) => {
    const profile = getUserProfile(sql);
    const rows = sql
      .exec("SELECT * FROM hackathons WHERE status = 'open'")
      .toArray();
    const results = rows.map((r: any) => {
      const h = rowToHackathon(r);
      const { eligible, reasons } = evaluateEligibility(h.eligibility, profile);
      return { hackathon: h, eligible, reasons };
    });
    return c.json(results);
  });

  // --- User profile (singleton row in a key-value table) -------------------

  app.get("/api/hackathons/profile", (c) => {
    return c.json(getUserProfile(sql));
  });

  app.put("/api/hackathons/profile", async (c) => {
    const data = await c.req.json();
    const profile: UserProfile = {
      age: data.age ?? 25,
      country: data.country ?? "GB",
      is_student: data.is_student ?? false,
      team_size: data.team_size ?? 1,
      employed_by_sponsor: data.employed_by_sponsor ?? false,
    };
    const json = JSON.stringify(profile);
    sql.exec(
      `INSERT INTO hackathon_profile (id, profile_json, updated_at)
       VALUES ('default', ?, ?)
       ON CONFLICT(id) DO UPDATE SET profile_json = ?, updated_at = ?`,
      json,
      now(),
      json,
      now(),
    );
    return c.json(profile);
  });
}

// ---------------------------------------------------------------------------
// User profile — stored as a single row in a key-value table
// ---------------------------------------------------------------------------

function getUserProfile(sql: any): UserProfile {
  try {
    const row = sql
      .exec("SELECT profile_json FROM hackathon_profile WHERE id = 'default'")
      .one();
    if (row && row.profile_json) {
      return parseJson(row.profile_json, {
        age: 25,
        country: "GB",
        is_student: false,
        team_size: 1,
        employed_by_sponsor: false,
      });
    }
  } catch {
    // Table may not exist yet — return defaults
  }
  return {
    age: 25,
    country: "GB",
    is_student: false,
    team_size: 1,
    employed_by_sponsor: false,
  };
}
