/**
 * Mock API server for screenshots. Serves the REAL built frontend from
 * public/ and answers the API calls with realistic data, so the UI renders
 * exactly as it would in production.
 *
 * Usage: node scripts/mock-api.mjs [port]
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const PORT = Number(process.argv[2] || 8799);
const ROOT = join(import.meta.dirname, "..", "public");

const now = Date.now();
const day = 86400000;

const HACKATHONS = [
  { id: "h-amazon", name: "Build, Ship, Shape: Amazon Developer Hackathon", platform: "devpost", url: "https://devpost.com/hackathons/amazon-developer", description: "Build across Amazon Devices and shape what's next.", prize: "$138,000", start_date: "2026-10-01", end_date: "2026-10-23", registration_deadline: null, submission_deadline: "2026-10-23", eligibility: { eligibility_type: "unrestricted", age_min: 18, regions: ["Global"] }, status: "open", notes: "51k+ teams.", created_at: now, updated_at: now },
  { id: "h-nebius", name: "Nebius x NVIDIA Global AI Hackathon", platform: "devpost", url: "https://devpost.com/hackathons/nebius", description: "Build the next frontier of AI on open infrastructure.", prize: "$50,000", start_date: "2026-10-01", end_date: "2026-10-30", registration_deadline: null, submission_deadline: "2026-10-30", eligibility: { eligibility_type: "unrestricted", age_min: 18, regions: ["Global"] }, status: "open", notes: "19k+ teams.", created_at: now, updated_at: now },
  { id: "h-qloo", name: "Qloo Agentic Hackathon", platform: "devpost", url: "https://devpost.com/hackathons/qloo", description: "Agents, but with taste.", prize: "$25,000", start_date: "2026-10-01", end_date: "2026-10-30", registration_deadline: null, submission_deadline: "2026-10-30", eligibility: { eligibility_type: "unrestricted", age_min: 18, regions: ["Global"] }, status: "open", notes: "720 teams.", created_at: now, updated_at: now },
  { id: "h-eu", name: "EU Citizens Only AI Challenge", platform: "devpost", url: "https://devpost.com/hackathons/eu-ai", description: "For EU citizens only.", prize: "$10,000", start_date: "2026-10-01", end_date: "2026-11-30", registration_deadline: null, submission_deadline: "2026-11-30", eligibility: { eligibility_type: "citizenship", regions: ["EU"], age_min: 18, citizenships: ["IT", "DE", "FR", "ES", "NL", "BE", "AT", "IE", "PT", "GR", "FI", "SE", "DK"] }, status: "open", notes: "Tests citizenship matching.", created_at: now, updated_at: now },
  { id: "h-uk", name: "UK Residents Only Build Challenge", platform: "devpost", url: "https://devpost.com/hackathons/uk-build", description: "For UK residents only.", prize: "$8,000", start_date: "2026-10-01", end_date: "2026-11-30", registration_deadline: null, submission_deadline: "2026-11-30", eligibility: { eligibility_type: "residency", regions: ["UK"], residencies: ["GB"], age_min: 18 }, status: "open", notes: "Tests residency matching.", created_at: now, updated_at: now },
  { id: "h-student", name: "Students Only Campus Hack", platform: "devpost", url: "https://devpost.com/hackathons/student", description: "Students only.", prize: "$2,000", start_date: "2026-10-01", end_date: "2026-11-30", registration_deadline: null, submission_deadline: "2026-11-30", eligibility: { eligibility_type: "unrestricted", student_only: true, age_min: 18, regions: ["Global"] }, status: "open", notes: "Tests the student-only rejection.", created_at: now, updated_at: now },
  { id: "h-hacktoberfest", name: "Hacktoberfest 2026", platform: "mlh", url: "https://hacktoberfest.com", description: "Month-long open source celebration. Challenge/sticker-based.", prize: "Stickers + swag", start_date: "2026-10-01", end_date: "2026-10-31", registration_deadline: null, submission_deadline: "2026-10-31", eligibility: { eligibility_type: "unrestricted", age_min: 13, regions: ["Global"] }, status: "open", notes: "Free. 13+.", created_at: now, updated_at: now },
];

const PROFILE = { citizenships: ["IT"], residencies: ["GB"], residency_status: "settled", age: 25, is_student: false, team_size: 1, employed_by_sponsor: false };

// Same engine as src/hackathons.ts
const REGIONS = {
  EU: ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"],
  EEA: ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],
  Schengen: ["AT","BE","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IT","LV","LI","LT","LU","MT","NL","NO","PL","PT","SK","SI","ES","SE","CH"],
  UK: ["GB"], US: ["US"], Global: [],
};

function evaluateEligibility(rules, profile) {
  const reasons = [];
  const paths = [];
  if (rules.age_min !== undefined && profile.age < rules.age_min) reasons.push(`Must be at least ${rules.age_min} years old (you are ${profile.age})`);
  if (rules.age_max !== undefined && profile.age > rules.age_max) reasons.push(`Must be at most ${rules.age_max} years old (you are ${profile.age})`);
  if (rules.student_only && !profile.is_student) reasons.push("Students only");
  if (rules.team_min !== undefined && profile.team_size < rules.team_min) reasons.push(`Team must have at least ${rules.team_min} members (you have ${profile.team_size})`);
  if (rules.team_max !== undefined && profile.team_size > rules.team_max) reasons.push(`Team must have at most ${rules.team_max} members (you have ${profile.team_size})`);
  if (rules.not_employee_of_sponsor && profile.employed_by_sponsor) reasons.push("Sponsor employees and their immediate family are not eligible");

  const type = rules.eligibility_type || "unrestricted";
  if (type !== "unrestricted") {
    const allowedC = new Set(rules.citizenships || []);
    const allowedR = new Set(rules.residencies || []);
    const regionCountries = new Set();
    for (const rg of rules.regions || []) {
      const cs = REGIONS[rg];
      if (cs && cs.length) cs.forEach((c) => regionCountries.add(c));
      else if (rg === "Global") { regionCountries.clear(); regionCountries.add("*"); }
    }
    let matched = false, matchPath = "";
    if (type === "citizenship" || type === "any") {
      if (allowedC.size) {
        for (const c of profile.citizenships) if (allowedC.has(c)) { matched = true; matchPath = `EU citizenship (${c})`; break; }
      }
      if (!matched && regionCountries.size && !regionCountries.has("*")) {
        for (const c of profile.citizenships) if (regionCountries.has(c)) { matched = true; matchPath = `citizenship in region ${rules.regions.join("/")}`; break; }
      }
      if (!matched && regionCountries.has("*")) { matched = true; matchPath = "global (no restriction)"; }
    }
    if (!matched && (type === "residency" || type === "any")) {
      if (allowedR.size) {
        for (const r of profile.residencies) if (allowedR.has(r)) { matched = true; matchPath = `UK residency (${r}, ${profile.residency_status})`; break; }
      }
      if (!matched && regionCountries.size && !regionCountries.has("*")) {
        for (const r of profile.residencies) if (regionCountries.has(r)) { matched = true; matchPath = `residency in region ${rules.regions.join("/")}`; break; }
      }
      if (!matched && regionCountries.has("*")) { matched = true; matchPath = "global (no restriction)"; }
    }
    if (!matched && (allowedC.size || allowedR.size || (regionCountries.size && !regionCountries.has("*")))) {
      const restricted = [];
      if (allowedC.size) restricted.push(`citizenship: ${[...allowedC].join(", ")}`);
      if (allowedR.size) restricted.push(`residency: ${[...allowedR].join(", ")}`);
      if (regionCountries.size && !regionCountries.has("*")) restricted.push(`region: ${rules.regions.join(", ")}`);
      reasons.push(`Eligibility restricted to: ${restricted.join(" OR ")} (you have citizenship: ${profile.citizenships.join(", ")}, residency: ${profile.residencies.join(", ")})`);
    } else if (matched) paths.push(matchPath);
  }
  if (rules.other) reasons.push(rules.other);
  const qualification_path = paths.length ? `eligible via ${paths[0]}` : reasons.length === 0 ? "eligible (no restrictions)" : "not eligible";
  return { eligible: reasons.length === 0, reasons, qualification_path };
}

const INBOX = [
  { id: "i-1", sender: "notifications@devpost.com", subject: "Build, Ship, Shape: Amazon Developer Hackathon - submission deadline extended", received_at: now - 3600000, body_preview: "The submission deadline for the Amazon Developer Hackathon has been extended to Oct 30, 2026 at 11:59pm EDT.\n\nRemember that you can resubmit your project up to 5 times before the deadline. If you need a template for your README, the organiser guide is available in the Resources tab.\n\nGood luck!", body_html: "<p>The submission deadline has been extended.</p>", has_attachments: false, attachment_names: [], is_platform: true, platform: "devpost", ticket_id: "h-amazon", match_confidence: 1, match_method: "content", read: false, processed: false, created_at: now },
  { id: "i-2", sender: "noreply@mlh.io", subject: "Global Hack Week: Hacktoberfest - your participant dashboard is ready", received_at: now - 7200000, body_preview: "Your Hacktoberfest participant dashboard is now live. Use it to track the challenges you have joined and the stickers you have earned.\n\nLivestreams run through to Oct 15.", body_html: "<p>Your dashboard is live.</p>", has_attachments: false, attachment_names: [], is_platform: true, platform: "mlh", ticket_id: "h-hacktoberfest", match_confidence: 0.6, match_method: "content", read: true, processed: false, created_at: now },
  { id: "i-3", sender: "hello@devpost.com", subject: "Your Devpost account - please verify your email address", received_at: now - 86400000, body_preview: "We noticed your email address has not been verified. Please follow the link to confirm it so you can register for competitions.", body_html: "<p>Please verify.</p>", has_attachments: false, attachment_names: [], is_platform: true, platform: "devpost", ticket_id: null, match_confidence: 0, match_method: "ambiguous", read: false, processed: false, created_at: now },
  { id: "i-4", sender: "kaggle@notifications.kaggle.com", subject: "Your submission scored 0.842 - 12 hours remain before the competition closes", received_at: now - 129600000, body_preview: "Your public leaderboard score is 0.842. There are 12 hours left to submit. Remember that the final submission is the one that counts for the private leaderboard.", body_html: "<p>Your score is 0.842.</p>", has_attachments: true, attachment_names: ["leaderboard.csv"], is_platform: true, platform: "kaggle", ticket_id: null, match_confidence: 0, match_method: "none", read: true, processed: true, created_at: now },
];

const TODOS = [
  { id: 1, title: "Submit Amazon Developer Hackathon project", description: "README + demo video + deployed link", completed: 0, priority: "high", due_date: "2026-10-23", list_id: "work", tags: ["hackathon", "amazon"], is_pinned: 1, estimated_pomodoros: 4, pomodoro_count: 6, created_at: now - 3 * day, completed_at: null },
  { id: 2, title: "Record 2-minute demo video", description: "Show the device simulator working", completed: 0, priority: "urgent", due_date: "2026-10-22", list_id: "work", tags: ["demo"], is_pinned: 0, estimated_pomodoros: 2, pomodoro_count: 3, created_at: now - 2 * day, completed_at: null },
  { id: 3, title: "Register for the EU Citizens Only AI Challenge", description: "", completed: 0, priority: "medium", due_date: "2026-10-25", list_id: "inbox", tags: ["hackathon"], is_pinned: 0, estimated_pomodoros: 1, pomodoro_count: 0, created_at: now - day, completed_at: null },
  { id: 4, title: "Review Hacktoberfest challenge list", description: "Pick 2 repos to contribute to", completed: 1, priority: "low", due_date: null, list_id: "ideas", tags: ["opensource"], is_pinned: 0, estimated_pomodoros: 2, pomodoro_count: 4, created_at: now - 5 * day, completed_at: now - day },
];

const LISTS = [
  { id: "inbox", name: "Inbox", color: "#5E6AD2", icon: "inbox", sort_order: 0 },
  { id: "work", name: "Work", color: "#2563EB", icon: "briefcase", sort_order: 1 },
  { id: "ideas", name: "Ideas & Future", color: "#9333EA", icon: "sparkles", sort_order: 2 },
];

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/health") return json(res, { status: "ok", version: "1.2.0", timestamp: Date.now() });
  if (p === "/api/hackathons") return json(res, HACKATHONS);
  if (p === "/api/hackathons/eligibility")
    return json(res, HACKATHONS.filter((h) => h.status === "open").map((h) => ({ hackathon: h, ...evaluateEligibility(h.eligibility, PROFILE) })));
  if (p === "/api/hackathons/profile") return json(res, PROFILE);
  if (p === "/api/inbox") return json(res, INBOX);
  if (p === "/api/inbox/stats")
    return json(res, { total: INBOX.length, unread: INBOX.filter((i) => !i.read).length, unprocessed: INBOX.filter((i) => !i.processed).length, platform: INBOX.filter((i) => i.is_platform).length });
  if (p.startsWith("/api/inbox/")) {
    const id = p.split("/").pop();
    const item = INBOX.find((i) => i.id === id);
    return item ? json(res, item) : json(res, { error: "Inbox item not found" }, 404);
  }
  if (p === "/api/todos") return json(res, TODOS);
  if (p === "/api/lists") return json(res, LISTS);
  if (p === "/api/stats")
    return json(res, { total: TODOS.length, completed: TODOS.filter((t) => t.completed).length, active: TODOS.filter((t) => !t.completed).length, highPriority: TODOS.filter((t) => t.priority === "high" || t.priority === "urgent").length, dueToday: 0, pomodoros: TODOS.reduce((s, t) => s + t.pomodoro_count, 0) });
  if (p === "/api/capacity")
    return json(res, [{ day_of_week: 0, hours_available: 4, notes: "Sunday" }, { day_of_week: 1, hours_available: 2, notes: "Monday" }, { day_of_week: 2, hours_available: 2, notes: "Tuesday" }, { day_of_week: 3, hours_available: 3, notes: "Wednesday" }, { day_of_week: 4, hours_available: 2, notes: "Thursday" }, { day_of_week: 5, hours_available: 0, notes: "Friday" }, { day_of_week: 6, hours_available: 6, notes: "Saturday" }]);
  if (p === "/api/digest/weekly")
    return json(res, Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i);
      return { date: d.toISOString().split("T")[0], day: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()], hours_available: [4,2,2,3,2,0,6][d.getDay()], is_today: i === 0 };
    }));
  if (p === "/api/digest")
    return json(res, { date: new Date().toISOString().split("T")[0], available_hours: 2, used_hours: 2, remaining_hours: 0, today_tasks: [], upcoming_this_week: [], conflicts: [], summary: "You have 2h available but 40h of work due this week. Focus on: nothing fits." });
  if (p === "/api/settings")
    return json(res, { storage: { provider: "r2", r2_bucket: "taskmaster-pro-screenshots", s3_bucket: "", s3_region: "eu-west-2", azure_account: "", azure_container: "", azure_sas_token: "" }, email: { protocol: "imap", inbox_address: "hackathons@andiekobbietech.dev", imap_host: "imap.mail.yahoo.com", imap_port: 993, imap_user: "andre.enne@yahoo.com", imap_password: "", jmap_server_url: "", jmap_username: "", jmap_password: "" }, notifications: { daily_digest: true, digest_time: "08:00", conflict_alerts: true, deadline_reminders: true }, profile: PROFILE });
  if (p === "/api/archive/sources")
    return json(res, [{ id: "s-1", name: "Wayback Machine", type: "wayback", enabled: true, base_url: "https://web.archive.org" }]);

  // static files
  let file = join(ROOT, p === "/" ? "index.html" : p);
  if (!existsSync(file)) file = join(ROOT, "index.html");
  try {
    const data = readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log("mock API on http://127.0.0.1:" + PORT);
});
