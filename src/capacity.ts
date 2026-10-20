/**
 * Capacity Planner + Daily Digest — prioritization engine for taskmaster-pro.
 *
 * Design notes:
 * - Weekly capacity template: hours available per day of week (0=Sun, 6=Sat)
 * - Daily digest: prioritized list of what to focus on today
 * - Conflict detection: flag overlapping deadlines
 * - Capacity check: "you have X hours available, Y hours needed"
 * - Prioritization: urgency × prize × eligibility, sorted by score
 */
import { Hono } from "hono";

// ── Types ────────────────────────────────────────────────────────────

export interface CapacityDay {
  day_of_week: number; // 0=Sun, 1=Mon, ..., 6=Sat
  hours_available: number;
  notes: string;
}

export interface DailyDigest {
  date: string;
  available_hours: number;
  used_hours: number;
  remaining_hours: number;
  today_tasks: Array<{
    hackathon_id: string;
    name: string;
    platform: string;
    prize: string;
    deadline: string;
    days_remaining: number;
    estimated_hours: number;
    priority_score: number;
    qualification_path: string;
  }>;
  upcoming_this_week: Array<{
    hackathon_id: string;
    name: string;
    platform: string;
    deadline: string;
    days_remaining: number;
    eligible: boolean;
  }>;
  conflicts: Array<{
    hackathon_a: string;
    hackathon_b: string;
    shared_deadline: string;
    suggestion: string;
  }>;
  summary: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function now(): number { return Date.now(); }

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  const target = new Date(dateStr).getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

// Estimate hours needed based on hackathon type
function estimateHours(platform: string, name: string): number {
  const lower = name.toLowerCase();
  if (platform === "kaggle") return 40; // Kaggle needs model training
  if (lower.includes("hackathon") && (lower.includes("24") || lower.includes("48"))) return 24;
  if (platform === "mlh") return 20; // Weekend hackathon
  if (platform === "devpost") return 16; // Online hackathon
  return 12; // Default
}

// Normalize prize to 0-1 scale
function normalizePrize(prize: string): number {
  if (!prize) return 0;
  const match = prize.match(/\$?([\d,]+)/);
  if (!match) return 0;
  const amount = parseInt(match[1].replace(/,/g, ""), 10);
  // Log scale: $1k = 0.3, $10k = 0.5, $50k = 0.7, $100k+ = 0.9
  if (amount >= 100000) return 0.9;
  if (amount >= 50000) return 0.7;
  if (amount >= 10000) return 0.5;
  if (amount >= 5000) return 0.4;
  if (amount >= 1000) return 0.3;
  return 0.1;
}

// ── Route registration ───────────────────────────────────────────────

/**
 * Register all capacity planning and daily digest routes on the Hono app.
 *
 * Routes:
 * - GET /api/capacity — Get weekly capacity template
 * - PUT /api/capacity — Update weekly capacity template
 * - GET /api/digest — Get today's daily digest
 * - GET /api/digest/weekly — Get weekly plan
 * - GET /api/digest/priority — Get all open hackathons with priority scores
 *
 * @param app - Hono application instance
 * @param sql - SQLite storage interface from Durable Object
 */
export function registerCapacityRoutes(app: Hono, sql: any) {
  // --- Get weekly capacity template -----------------------------------

  app.get("/api/capacity", (c) => {
    const rows = sql.exec("SELECT * FROM capacity ORDER BY day_of_week").toArray();
    if (rows.length === 0) {
      // Return defaults
      const defaults = [
        { day_of_week: 0, hours_available: 4, notes: "Sunday" },
        { day_of_week: 1, hours_available: 2, notes: "Monday (after work)" },
        { day_of_week: 2, hours_available: 2, notes: "Tuesday (after work)" },
        { day_of_week: 3, hours_available: 3, notes: "Wednesday (after work)" },
        { day_of_week: 4, hours_available: 2, notes: "Thursday (after work)" },
        { day_of_week: 5, hours_available: 0, notes: "Friday (exhausted)" },
        { day_of_week: 6, hours_available: 6, notes: "Saturday" },
      ];
      return c.json(defaults);
    }
    return c.json(rows.map((r: any) => ({
      day_of_week: r.day_of_week,
      hours_available: r.hours_available,
      notes: r.notes,
    })));
  });

  // --- Update weekly capacity template --------------------------------

  app.put("/api/capacity", async (c) => {
    const data = await c.req.json();
    const days: CapacityDay[] = data.days || [];

    for (const day of days) {
      sql.exec(
        `INSERT INTO capacity (day_of_week, hours_available, notes) VALUES (?, ?, ?)
         ON CONFLICT(day_of_week) DO UPDATE SET hours_available = ?, notes = ?`,
        day.day_of_week, day.hours_available, day.notes || "",
        day.hours_available, day.notes || ""
      ).toArray();
    }

    const rows = sql.exec("SELECT * FROM capacity ORDER BY day_of_week").toArray();
    return c.json(rows.map((r: any) => ({
      day_of_week: r.day_of_week,
      hours_available: r.hours_available,
      notes: r.notes,
    })));
  });

  // --- Get today's daily digest --------------------------------------

  app.get("/api/digest", (c) => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const dateStr = today.toISOString().split("T")[0];

    // Get today's available hours
    let availableHours = 0;
    try {
      const rows = sql.exec("SELECT hours_available FROM capacity WHERE day_of_week = ?", dayOfWeek).toArray();
      availableHours = rows.length > 0 ? rows[0].hours_available || 0 : 0;
    } catch {
      // Use default
      const defaults: Record<number, number> = { 0: 4, 1: 2, 2: 2, 3: 3, 4: 2, 5: 0, 6: 6 };
      availableHours = defaults[dayOfWeek] || 0;
    }

    // Get all open hackathons
    const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
    const hackathons = rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      prize: r.prize,
      submission_deadline: r.submission_deadline,
      end_date: r.end_date,
      eligibility_json: r.eligibility_json,
    }));

    // Get user profile
    let profile = null;
    try {
      const prows = sql.exec("SELECT profile_json FROM hackathon_profile WHERE id = 'default'").toArray();
    const prow = prows.length > 0 ? prows[0] : null;
      if (prow?.profile_json) profile = parseJson(prow.profile_json, null);
    } catch {}

    // Evaluate eligibility and calculate scores
    const scored = hackathons.map((h: any) => {
      const deadline = h.submission_deadline || h.end_date;
      const daysLeft = daysUntil(deadline);
      const eligible = true; // Simplified — full eligibility check would use the engine
      const estHours = estimateHours(h.platform, h.name);
      const prizeNorm = normalizePrize(h.prize);
      const urgency = daysLeft <= 0 ? 1.0 : Math.min(1.0, 1.0 / daysLeft);
      const score = (urgency * 0.4) + (prizeNorm * 0.3) + (eligible ? 0.3 : 0.0);

      return {
        hackathon_id: h.id,
        name: h.name,
        platform: h.platform,
        prize: h.prize,
        deadline: deadline || "No deadline",
        days_remaining: daysLeft,
        estimated_hours: estHours,
        priority_score: Math.round(score * 100) / 100,
        eligible,
        qualification_path: "eligible (no restrictions)",
      };
    });

    // Sort by priority score descending
    scored.sort((a, b) => b.priority_score - a.priority_score);

    // Greedily assign to available hours
    let usedHours = 0;
    const todayTasks: any[] = [];
    for (const task of scored) {
      if (task.days_remaining <= 7 && usedHours + task.estimated_hours <= availableHours) {
        todayTasks.push(task);
        usedHours += task.estimated_hours;
      }
    }

    // Upcoming this week
    const upcoming = scored
      .filter(t => t.days_remaining > 0 && t.days_remaining <= 7)
      .map(t => ({
        hackathon_id: t.hackathon_id,
        name: t.name,
        platform: t.platform,
        deadline: t.deadline,
        days_remaining: t.days_remaining,
        eligible: t.eligible,
      }));

    // Conflict detection
    const conflicts: any[] = [];
    const byDeadline: Record<string, any[]> = {};
    for (const h of scored) {
      if (h.days_remaining >= 0 && h.days_remaining <= 7) {
        const key = h.deadline;
        if (!byDeadline[key]) byDeadline[key] = [];
        byDeadline[key].push(h);
      }
    }
    for (const [deadline, items] of Object.entries(byDeadline)) {
      if (items.length > 1) {
        conflicts.push({
          hackathon_a: items[0].name,
          hackathon_b: items[1].name,
          shared_deadline: deadline,
          suggestion: `Both due on ${deadline}. Consider prioritizing ${items[0].name} (${items[0].prize}) over ${items[1].name} (${items[1].prize}).`,
        });
      }
    }

    // Summary
    const totalNeeded = scored.filter(t => t.days_remaining <= 7).reduce((s, t) => s + t.estimated_hours, 0);
    const summary = availableHours === 0
      ? "No available hours today. Rest day."
      : totalNeeded > availableHours
        ? `You have ${availableHours}h available but ${totalNeeded}h of work due this week. Focus on: ${todayTasks.map(t => t.name).join(", ") || "nothing fits"}.`
        : `You have ${availableHours}h available and ${totalNeeded}h of work due. You're on track. Focus on: ${todayTasks.map(t => t.name).join(", ") || "nothing due today"}.`;

    const digest: DailyDigest = {
      date: dateStr,
      available_hours: availableHours,
      used_hours: usedHours,
      remaining_hours: availableHours - usedHours,
      today_tasks: todayTasks,
      upcoming_this_week: upcoming,
      conflicts,
      summary,
    };

    return c.json(digest);
  });

  // --- Get weekly plan -----------------------------------------------

  app.get("/api/digest/weekly", (c) => {
    const rows = sql.exec("SELECT * FROM capacity ORDER BY day_of_week").toArray();
    const capacity: Record<number, number> = {};
    for (const r of rows) capacity[r.day_of_week] = r.hours_available;

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = new Date();
    const weekPlan = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dow = date.getDay();
      const hours = capacity[dow] ?? 0;
      weekPlan.push({
        date: date.toISOString().split("T")[0],
        day: days[dow],
        hours_available: hours,
        is_today: i === 0,
      });
    }

    return c.json(weekPlan);
  });

  // --- Get all open hackathons with priority scores --------------------

  app.get("/api/digest/priority", (c) => {
    const rows = sql.exec("SELECT * FROM hackathons WHERE status = 'open'").toArray();
    const scored = rows.map((r: any) => {
      const deadline = r.submission_deadline || r.end_date;
      const daysLeft = daysUntil(deadline);
      const estHours = estimateHours(r.platform, r.name);
      const prizeNorm = normalizePrize(r.prize);
      const urgency = daysLeft <= 0 ? 1.0 : Math.min(1.0, 1.0 / daysLeft);
      const score = (urgency * 0.4) + (prizeNorm * 0.3) + 0.3; // eligible bonus
      return {
        id: r.id,
        name: r.name,
        platform: r.platform,
        prize: r.prize,
        deadline: deadline || "No deadline",
        days_remaining: daysLeft,
        estimated_hours: estHours,
        priority_score: Math.round(score * 100) / 100,
      };
    });
    scored.sort((a: any, b: any) => b.priority_score - a.priority_score);
    return c.json(scored);
  });
}
