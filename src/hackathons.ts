/**
 * Hackathon Tracker — Hono routes with policy-structure eligibility engine.
 *
 * Eligibility model:
 *   - User profile: citizenships[], residencies[], residency_status, age, is_student, team_size
 *   - Hackathon rules: eligibility_type, citizenships[], residencies[], regions[], age_min, age_max, student_only, team_min, team_max, not_employee_of_sponsor, other
 *   - Evaluation: check if user has ANY citizenship/residency/region in allowed lists
 *   - Qualification path: report which path qualified ("eligible via EU citizenship (Italy)")
 *
 * Regional groupings: EU, EEA, Schengen, UK, US, Global
 */
import { Hono } from "hono";
import { DEFAULT_PROFILE, readProfile, writeProfile, withProfileDefaults, type UserProfile } from "./profile.ts";
import { isValidTimeZone } from "./timezone.ts";

// ── Regional groupings ──────────────────────────────────────────────

const REGIONS: Record<string, string[]> = {
  "EU": [
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
  ],
  "EEA": [
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
    "IS","LI","NO",
  ],
  "Schengen": [
    "AT","BE","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IT","LV",
    "LI","LT","LU","MT","NL","NO","PL","PT","SK","SI","ES","SE","CH",
  ],
  "UK": ["GB"],
  "US": ["US"],
  "Global": [], // empty = no restriction
};

// ── Types ────────────────────────────────────────────────────────────

// The profile type and its default live in src/profile.ts, so the
// eligibility engine and the Settings screen cannot disagree about them.
export type { UserProfile } from "./profile.ts";

export interface EligibilityRules {
  eligibility_type: string;     // "citizenship" | "residency" | "any" | "unrestricted"
  citizenships?: string[];      // Allowed citizenships (ISO codes)
  residencies?: string[];       // Allowed residencies (ISO codes)
  regions?: string[];           // Regional groupings (EU, EEA, Schengen, UK, US, Global)
  age_min?: number;
  age_max?: number;
  student_only?: boolean;
  team_min?: number;
  team_max?: number;
  not_employee_of_sponsor?: boolean;
  other?: string;               // Free-text caveat
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  qualification_path: string;   // e.g. "eligible via EU citizenship (Italy)"
}

export interface Hackathon {
  id: string;
  name: string;
  platform: string;
  url: string;
  description: string;
  prize: string;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  submission_deadline: string | null;
  eligibility: EligibilityRules;
  status: string;
  notes: string;
  created_at: number;
  updated_at: number;
  // ── Batch 1: the four Devpost fields that were being dropped ──────
  // These are what make the prize, location and deadline filters
  // answerable instead of returning "unknown".
  /** Where the event says it is held, e.g. "Dublin, Ireland". */
  displayed_location: string;
  /** The prize breakdown as the organiser wrote it, e.g. "$5,000 in prizes". */
  prizes_counts: string;
  /** Hours until the submission deadline, as Devpost counted it. Null when unknown. */
  time_left_to_submission: number | null;
  /** Whether Devpost marks the event as featured. */
  featured: boolean;
}

// ── Eligibility engine ───────────────────────────────────────────────

/**
 * Evaluate whether a user profile meets a hackathon's eligibility rules.
 *
 * @param rules - The hackathon's eligibility rules (citizenship, residency, age, etc.)
 * @param profile - The user's profile (citizenships, residencies, age, student status, etc.)
 * @returns { eligible: boolean, reasons: string[], qualification_path: string }
 * @example
 *   const result = evaluateEligibility(rules, profile);
 *   if (result.eligible) console.log(result.qualification_path);
 */
export function evaluateEligibility(
  rules: EligibilityRules,
  profile: UserProfile,
): EligibilityResult {
  const reasons: string[] = [];
  const paths: string[] = [];

  // Age checks
  if (rules.age_min !== undefined && profile.age < rules.age_min) {
    reasons.push(`Must be at least ${rules.age_min} years old (you are ${profile.age})`);
  }
  if (rules.age_max !== undefined && profile.age > rules.age_max) {
    reasons.push(`Must be at most ${rules.age_max} years old (you are ${profile.age})`);
  }

  // Student-only check
  if (rules.student_only && !profile.is_student) {
    reasons.push("Students only");
  }

  // Team size checks
  if (rules.team_min !== undefined && profile.team_size < rules.team_min) {
    reasons.push(`Team must have at least ${rules.team_min} members (you have ${profile.team_size})`);
  }
  if (rules.team_max !== undefined && profile.team_size > rules.team_max) {
    reasons.push(`Team must have at most ${rules.team_max} members (you have ${profile.team_size})`);
  }

  // Sponsor exclusion
  if (rules.not_employee_of_sponsor && profile.employed_by_sponsor) {
    reasons.push("Sponsor employees and their immediate family are not eligible");
  }

  // Location/identity checks
  const type = rules.eligibility_type || "unrestricted";

  if (type !== "unrestricted") {
    const allowedCitizenships = new Set(rules.citizenships || []);
    const allowedResidencies = new Set(rules.residencies || []);
    // Expand regions into country codes
    const regionCountries = new Set<string>();
    for (const region of (rules.regions || [])) {
      const countries = REGIONS[region];
      if (countries && countries.length > 0) {
        countries.forEach(c => regionCountries.add(c));
      } else if (region === "Global") {
        // Global means no restriction
        regionCountries.clear();
        regionCountries.add("*");
      }
    }

    let matched = false;
    let matchPath = "";

    // Check citizenship path
    if (type === "citizenship" || type === "any") {
      if (allowedCitizenships.size > 0) {
        for (const c of profile.citizenships) {
          if (allowedCitizenships.has(c)) {
            matched = true;
            matchPath = `EU citizenship (${c})`;
            break;
          }
        }
      }
      if (!matched && regionCountries.size > 0 && !regionCountries.has("*")) {
        for (const c of profile.citizenships) {
          if (regionCountries.has(c)) {
            matched = true;
            matchPath = `citizenship in region ${rules.regions?.join("/")}`;
            break;
          }
        }
      }
      if (!matched && regionCountries.has("*")) {
        matched = true;
        matchPath = "global (no restriction)";
      }
    }

    // Check residency path
    if (!matched && (type === "residency" || type === "any")) {
      if (allowedResidencies.size > 0) {
        for (const r of profile.residencies) {
          if (allowedResidencies.has(r)) {
            matched = true;
            matchPath = `UK residency (${r}, ${profile.residency_status})`;
            break;
          }
        }
      }
      if (!matched && regionCountries.size > 0 && !regionCountries.has("*")) {
        for (const r of profile.residencies) {
          if (regionCountries.has(r)) {
            matched = true;
            matchPath = `residency in region ${rules.regions?.join("/")}`;
            break;
          }
        }
      }
      if (!matched && regionCountries.has("*")) {
        matched = true;
        matchPath = "global (no restriction)";
      }
    }

    // If nothing matched and there are restrictions
    if (!matched && (allowedCitizenships.size > 0 || allowedResidencies.size > 0 || (regionCountries.size > 0 && !regionCountries.has("*")))) {
      const restricted = [];
      if (allowedCitizenships.size > 0) restricted.push(`citizenship: ${[...allowedCitizenships].join(", ")}`);
      if (allowedResidencies.size > 0) restricted.push(`residency: ${[...allowedResidencies].join(", ")}`);
      if (regionCountries.size > 0 && !regionCountries.has("*")) restricted.push(`region: ${rules.regions?.join(", ")}`);
      reasons.push(`Eligibility restricted to: ${restricted.join(" OR ")} (you have citizenship: ${profile.citizenships.join(", ")}, residency: ${profile.residencies.join(", ")})`);
    } else if (matched) {
      paths.push(matchPath);
    }
  }

  // Free-text caveat
  if (rules.other) {
    reasons.push(rules.other);
  }

  const qualificationPath = paths.length > 0
    ? `eligible via ${paths[0]}`
    : reasons.length === 0 ? "eligible (no restrictions)" : "not eligible";

  return {
    eligible: reasons.length === 0,
    reasons,
    qualification_path: qualificationPath,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function now(): number { return Date.now(); }

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToHackathon(r: any): Hackathon {
  return {
    id: r.id, name: r.name, platform: r.platform, url: r.url,
    description: r.description, prize: r.prize, start_date: r.start_date,
    end_date: r.end_date, registration_deadline: r.registration_deadline,
    submission_deadline: r.submission_deadline,
    eligibility: parseJson(r.eligibility_json, {}),
    status: r.status, notes: r.notes,
    displayed_location: String(r.displayed_location || ""),
    prizes_counts: String(r.prizes_counts || ""),
    time_left_to_submission: r.time_left_to_submission === null || r.time_left_to_submission === undefined
      ? null
      : Number(r.time_left_to_submission),
    featured: !!r.featured,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ── Default user profile (Andie's actual profile) ────────────────────

// The default profile comes from src/profile.ts, so it is the same one
// the Settings screen shows.

// ── Route registration ───────────────────────────────────────────────

/**
 * Register all hackathon-related API routes on the Hono app.
 *
 * Routes:
 * - GET /api/hackathons — List hackathons (filter by status, search)
 * - POST /api/hackathons — Create a new hackathon
 * - GET /api/hackathons/:id — Get a single hackathon
 * - PATCH /api/hackathons/:id — Update a hackathon
 * - DELETE /api/hackathons/:id — Delete a hackathon
 * - GET /api/hackathons/eligibility — Evaluate profile against all open hackathons
 * - GET/PUT /api/hackathons/profile — Get/update user profile
 *
 * @param app - Hono application instance
 * @param sql - SQLite storage interface from Durable Object
 */
export function registerHackathonRoutes(app: Hono, sql: any) {
  // List hackathons
  app.get("/api/hackathons", (c) => {
    const status = c.req.query("status");
    const search = c.req.query("search");
    const featured = c.req.query("featured");
    const location = c.req.query("location");
    let query = "SELECT * FROM hackathons WHERE 1=1";
    const params: any[] = [];
    if (status && status !== "all") { query += " AND status = ?"; params.push(status); }
    if (search) { query += " AND (name LIKE ? OR description LIKE ? OR displayed_location LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (featured === "1" || featured === "true") { query += " AND featured = 1"; }
    if (location) { query += " AND displayed_location LIKE ?"; params.push(`%${location}%`); }
    query += " ORDER BY COALESCE(submission_deadline, end_date, start_date) ASC";
    const rows = sql.exec(query, ...params).toArray();
    return c.json(rows.map(rowToHackathon));
  });

  // List hackathons in simple form: id, title, dates, prize, url, eligibility
  app.get("/api/hackathons/simple", (c) => {
    const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open' ORDER BY created_at DESC").toArray();
    return c.json(rows.map((r: any) => ({
      id: r.id,
      title: r.name,
      start: r.start_date || r.submission_deadline || null,
      end: r.end_date || null,
      prize: r.prize ? r.prize.replace(/<[^>]*>/g, "").trim() : "",
      url: r.url || "",
      eligibility: r.eligibility_json ? JSON.parse(r.eligibility_json).eligibility_type || "unknown" : "unknown",
    })));
  });

  // Eligibility check — evaluates ALL open hackathons against user profile
  app.get("/api/hackathons/eligibility", (c) => {
    const profile = getUserProfile(sql);
    const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
    return c.json(rows.map((r: any) => {
      const h = rowToHackathon(r);
      const { eligible, reasons, qualification_path } = evaluateEligibility(h.eligibility, profile);
      return { hackathon: h, eligible, reasons, qualification_path };
    }));
  });


  // User profile
  app.get("/api/hackathons/profile", (c) => c.json(getUserProfile(sql)));
  app.put("/api/hackathons/profile", async (c) => {
    const data = await c.req.json();
    // The time zone is kept only if it is one this runtime knows. A
    // browser can send anything, and a bad zone would break the digest
    // and the "today" filter rather than fail loudly. An unknown zone
    // leaves the stored one alone.
    const zone = String(data.timezone || "");
    const stored = readProfile(sql);
    const profile: UserProfile = {
      citizenships: data.citizenships || ["IT"],
      residencies: data.residencies || ["GB"],
      residency_status: data.residency_status || "settled",
      age: data.age ?? 25,
      is_student: data.is_student ?? false,
      team_size: data.team_size ?? 1,
      employed_by_sponsor: data.employed_by_sponsor ?? false,
      timezone: isValidTimeZone(zone) ? zone : stored.timezone || DEFAULT_PROFILE.timezone,
    };
    writeProfile(sql, profile);
    return c.json(profile);
  });
  // Get single
  app.get("/api/hackathons/:id", (c) => {
    const rows = sql.exec("SELECT * FROM hackathons WHERE id = ?", c.req.param("id")).toArray();
    if (rows.length === 0) return c.json({ error: "Hackathon not found" }, 404);
    return c.json(rowToHackathon(rows[0]));
  });

  // Create
  app.post("/api/hackathons", async (c) => {
    const data = await c.req.json();
    if (!data.name?.trim()) return c.json({ error: "Name required" }, 400);
    const id = `hack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = now();
    sql.exec(
      `INSERT INTO hackathons (id, name, platform, url, description, prize, start_date, end_date, registration_deadline, submission_deadline, eligibility_json, status, notes, displayed_location, prizes_counts, time_left_to_submission, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, data.name.trim(), data.platform || "manual", data.url || "", data.description || "", data.prize || "", data.start_date || null, data.end_date || null, data.registration_deadline || null, data.submission_deadline || null, JSON.stringify(data.eligibility || {}), data.status || "open", data.notes || "",
      String(data.displayed_location || ""), String(data.prizes_counts || data.prize || ""),
      data.time_left_to_submission ?? null, data.featured ? 1 : 0, ts, ts
    ).toArray();
    const rows = sql.exec("SELECT * FROM hackathons WHERE id = ?", id).toArray();
    if (rows.length === 0) return c.json({ error: "Hackathon not found" }, 404);
    return c.json(rowToHackathon(rows[0]), 201);
  });

  // Update
  app.patch("/api/hackathons/:id", async (c) => {
    const id = c.req.param("id");
    const data = await c.req.json();
    const existingRows = sql.exec("SELECT * FROM hackathons WHERE id = ?", id).toArray();
    if (existingRows.length === 0) return c.json({ error: "Hackathon not found" }, 404);
    const existing = existingRows[0];
    const fieldMap: Record<string, string> = {
      name: "name", platform: "platform", url: "url", description: "description",
      prize: "prize", start_date: "start_date", end_date: "end_date",
      registration_deadline: "registration_deadline", submission_deadline: "submission_deadline",
      status: "status", notes: "notes",
      displayed_location: "displayed_location", prizes_counts: "prizes_counts",
      time_left_to_submission: "time_left_to_submission", featured: "featured",
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in data) { sets.push(`${col} = ?`); params.push(data[key]); }
    }
    if ("eligibility" in data) { sets.push("eligibility_json = ?"); params.push(JSON.stringify(data.eligibility)); }
    if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);
    sets.push("updated_at = ?"); params.push(now()); params.push(id);
    sql.exec(`UPDATE hackathons SET ${sets.join(", ")} WHERE id = ?`, ...params).toArray();
    const rows = sql.exec("SELECT * FROM hackathons WHERE id = ?", id).toArray();
    if (rows.length === 0) return c.json({ error: "Hackathon not found" }, 404);
    return c.json(rowToHackathon(rows[0]));
  });

  // Delete
  app.delete("/api/hackathons/:id", (c) => {
    const before = sql.exec("SELECT id FROM hackathons WHERE id = ?", c.req.param("id")).toArray();
    if (before.length === 0) return c.json({ error: "Hackathon not found" }, 404);
    sql.exec("DELETE FROM hackathons WHERE id = ?", c.req.param("id")).toArray();
    return c.json({ success: true });
  });
}

function getUserProfile(sql: any): UserProfile {
  return readProfile(sql);
}