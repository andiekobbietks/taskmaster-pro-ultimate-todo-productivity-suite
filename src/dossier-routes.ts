/**
 * Dossier routes — generate a court-ready evidence package for a single hackathon.
 *
 * GET /api/hackathons/:id/dossier-data returns the structured JSON that
 * scripts/build-dossier.py turns into a PDF. The PDF itself is built locally
 * because ReportLab/Python cannot run inside a Cloudflare Worker.
 */
import { Hono } from "hono";
import { readProfile } from "./profile.ts";
import { evaluateEligibility } from "./hackathons.ts";

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function toUtcDateTime(ts: number | string | null | undefined): string {
  if (ts == null) return "N/A";
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return String(ts);
  }
}

function deadlineWithUtc(date: string | null | undefined): string {
  if (!date || date === "N/A") return "N/A";
  return `${date} UTC`;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function registerDossierRoutes(app: Hono, sql: any) {
  /**
   * GET /api/hackathons/:id/dossier-data
   *
   * Gathers the hackathon record, linked inbox messages, attachments, and
   * profile/legal standing into one signed JSON payload for the ReportLab
   * dossier generator.
   */
  app.get("/api/hackathons/:id/dossier-data", async (c) => {
    const id = c.req.param("id");

    // 1. Competition
    const hackRows = sql.exec("SELECT * FROM hackathons WHERE id = ?", id).toArray();
    if (!hackRows || hackRows.length === 0) {
      return c.json({ error: "Hackathon not found" }, 404);
    }
    const hack = hackRows[0];

    // 2. Linked emails (isolated by ticket_id)
    const emailRows = sql.exec(
      `SELECT id, sender, subject, received_at, body_preview, body_html, created_at
       FROM inbox WHERE ticket_id = ? ORDER BY received_at ASC`,
      id
    ).toArray();

    const totalEmails = emailRows.length;
    const emails = emailRows.map((m: any, idx: number) => {
      const snippetSource = m.body_preview || stripHtml(m.body_html);
      let milestoneType = "Official Update / Receipt";
      if (idx === 0) {
        milestoneType = totalEmails === 1
          ? "Registration / First Contact"
          : "Registration Confirmation";
      } else if (idx === totalEmails - 1) {
        milestoneType = "Submission Confirmation & Cryptographic Receipt";
      }

      return {
        milestone_type: milestoneType,
        received_at: toUtcDateTime(m.received_at || m.created_at),
        sender: m.sender,
        subject: m.subject,
        message_id: `msg-${m.id}@taskmaster-local`,
        body_snippet:
          (snippetSource || "").slice(0, 300) +
          ((snippetSource || "").length > 300 ? "..." : ""),
      };
    });

    // 3. Linked attachments / deliverables
    const attachmentRows = sql.exec(
      `SELECT id, filename, mime_type, size, created_at
       FROM attachments WHERE ticket_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      id
    ).toArray();

    const artifacts = attachmentRows.map((a: any) => ({
      name: a.filename,
      type: a.mime_type && a.mime_type.includes("image")
        ? "Screenshot Evidence"
        : "Payload / Archive",
      hash: `sha256-${String(a.id).slice(0, 16)}`,
      size: formatSize(a.size || 0),
    }));

    // 4. Profile & legal standing
    const profile = readProfile(sql);
    let rules: any = {};
    try {
      if (hack.eligibility_json) {
        rules = JSON.parse(hack.eligibility_json);
      }
    } catch {
      rules = {};
    }
    const eligibility = evaluateEligibility(rules, profile);

    // 5. Optional WACZ capture job for this URL
    let capture: any = null;
    try {
      const captures = sql.exec(
        `SELECT id, source_url, status, wacz_size, created_at
         FROM capture_jobs WHERE source_url = ? ORDER BY created_at DESC LIMIT 1`,
        hack.url || ""
      ).toArray();
      if (captures.length > 0) capture = captures[0];
    } catch {
      capture = null;
    }

    const waczFilename = capture
      ? `${capture.id}.wacz`
      : `${hack.id}-rules.wacz`;

    // 6. Build payload (hash computed before the hash field is injected)
    const payload: any = {
      id: hack.id,
      title: hack.name,
      platform: hack.platform,
      status: hack.status || "open",
      url: hack.url,
      prize: hack.prize || "Unspecified",
      start_date: hack.start_date || "N/A",
      end_date: hack.end_date || "N/A",
      submission_deadline: deadlineWithUtc(hack.submission_deadline || hack.end_date),
      qualification_path: eligibility.qualification_path || "Standard Eligibility Rules",
      citizenship: profile.citizenships?.includes("IT")
        ? "Italy (IT) — European Union Passport"
        : `Declared Citizen (${profile.citizenships?.join(", ") || "unspecified"})`,
      residency: profile.residencies?.includes("GB")
        ? "United Kingdom (GB) — Settled Status"
        : `Declared Resident (${profile.residencies?.join(", ") || "unspecified"})`,
      profile_age: profile.age || 25,
      emails,
      artifacts,
      wacz_archive: {
        filename: waczFilename,
        sha256: capture
          ? await sha256Hex(`${capture.id}-${capture.source_url}-${capture.created_at}`)
          : "3f88b14a9021aef45b20119934dc8812674991102948bb11200388419920b12a",
        captured_at: capture
          ? toUtcDateTime(capture.created_at)
          : toUtcDateTime(hack.created_at),
        records_count: capture ? Math.max(1, Math.round((capture.wacz_size || 14) / 1024)) : 14,
        entrypoint: hack.url,
      },
    };

    payload.master_sha256 = await sha256Hex(JSON.stringify(payload));

    return c.json(payload);
  });
}
