/**
 * The daily digest.
 *
 * The digest is a morning summary: what closes soon, what is new, and
 * where two deadlines collide. It has to arrive in the reader's
 * morning, so everything here is computed in the reader's own time
 * zone — the one on the profile — and the scheduler works out when
 * "08:00" means for them.
 *
 * The "already sent" marker lives in its own row of the settings table
 * rather than inside the notifications section, because the Settings
 * screen writes that section back field by field and would otherwise
 * wipe the marker.
 */

import { readProfile, type UserProfile } from "./profile.ts";
import { evaluateEligibility, type EligibilityRules } from "./hackathons.ts";
import {
  daysUntilInZone,
  localDateString,
  localParts,
  offsetMinutes,
} from "./timezone.ts";
import { sendPush } from "./push.ts";
import { readPushKeys } from "./push-routes.ts";

export interface DigestItem {
  id: string;
  name: string;
  prize: string;
  deadline: string;
  daysLeft: number;
  eligible: boolean;
}

export interface DigestContent {
  title: string;
  body: string;
  date: string;
  closing: DigestItem[];
  added: DigestItem[];
  conflicts: Array<{ deadline: string; names: string[] }>;
}

function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/** The open competitions, with the days left counted in the reader's zone. */
function openCompetitions(sql: any, profile: UserProfile, now: Date): DigestItem[] {
  const rows = sql
    .exec("SELECT * FROM hackathons WHERE status = 'open'")
    .toArray();
  const items: DigestItem[] = [];
  for (const r of rows) {
    const deadline = r.submission_deadline || r.end_date || r.start_date;
    if (!deadline) continue;
    const rules = parseJson(r.eligibility_json, {}) as EligibilityRules;
    const verdict = evaluateEligibility(rules, profile);
    const left = daysUntilInZone(profile.timezone, deadline, now);
    if (left === null) continue;
    items.push({
      id: r.id,
      name: r.name,
      prize: String(r.prize || "").replace(/<[^>]*>/g, "").trim(),
      deadline: String(deadline).slice(0, 10),
      daysLeft: left,
      eligible: verdict.eligible,
    });
  }
  return items;
}

/**
 * The digest content, in the reader's zone.
 */
export function buildDigest(
  sql: any,
  profile: UserProfile,
  now: Date = new Date()
): DigestContent {
  const items = openCompetitions(sql, profile, now);

  // Closing soon: the eligible ones first, then by how soon.
  const closing = items
    .filter((i) => i.daysLeft >= 0 && i.daysLeft <= 7)
    .sort((a, b) =>
      a.eligible === b.eligible ? a.daysLeft - b.daysLeft : a.eligible ? -1 : 1
    );

  // New since yesterday: the competitions added in the last day.
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const addedRows = sql
    .exec(
      "SELECT * FROM hackathons WHERE created_at > ? ORDER BY created_at DESC LIMIT 10",
      since
    )
    .toArray();
  const added: DigestItem[] = addedRows.map((r: any) => ({
    id: r.id,
    name: r.name,
    prize: String(r.prize || "").replace(/<[^>]*>/g, "").trim(),
    deadline: String(r.submission_deadline || r.end_date || "").slice(0, 10),
    daysLeft: daysUntilInZone(profile.timezone, r.submission_deadline || r.end_date, now) ?? 999,
    eligible: true,
  }));

  // Two competitions closing on the same day is a conflict.
  const byDeadline = new Map<string, string[]>();
  for (const item of closing) {
    const list = byDeadline.get(item.deadline) || [];
    list.push(item.name);
    byDeadline.set(item.deadline, list);
  }
  const conflicts = [...byDeadline.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([deadline, names]) => ({ deadline, names }));

  const local = localParts(profile.timezone, now);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][local.weekday];
  const month = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"][local.month - 1];
  const date = localDateString(profile.timezone, now);

  const title = `TaskMaster Pro — ${weekday} ${local.day} ${month}`;

  // The body is what fits on a lock screen: the counts, and the next
  // deadline. The rest is one tap away.
  const bits: string[] = [];
  if (closing.length) {
    const next = closing[0];
    bits.push(
      `${closing.length} closing this week — next: ${next.name}` +
        (next.prize ? ` (${next.prize})` : "") +
        (next.daysLeft === 0 ? " closes today" : ` in ${next.daysLeft} day${next.daysLeft === 1 ? "" : "s"}`)
    );
  }
  if (added.length) {
    bits.push(`${added.length} new since yesterday`);
  }
  if (conflicts.length) {
    bits.push(`${conflicts.length} deadline clash${conflicts.length === 1 ? "" : "es"}`);
  }
  if (!bits.length) {
    bits.push("Nothing closing this week. A quiet week.");
  }

  return {
    title,
    body: bits.join(" · "),
    date,
    closing,
    added,
    conflicts,
  };
}

/** The marker row: which local day the last digest went out on. */
function readDigestState(sql: any): { last_date: string | null; sent_at: number | null } {
  try {
    const rows = sql.exec("SELECT value FROM settings WHERE key = 'digest'").toArray();
    if (rows.length > 0) {
      return parseJson(rows[0].value, { last_date: null, sent_at: null });
    }
  } catch {
    // fall through
  }
  return { last_date: null, sent_at: null };
}

function writeDigestState(
  sql: any,
  state: { last_date: string | null; sent_at: number | null }
): void {
  const ts = Date.now();
  sql.exec(
    "INSERT INTO settings (key, value, updated_at) VALUES ('digest', ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
    JSON.stringify(state), ts, JSON.stringify(state), ts
  ).toArray();
}

/**
 * Is the digest due?
 *
 * Due means: it is past the reader's digest time, it has not already
 * gone out today, and it is not wildly late — a digest that arrives at
 * ten in the evening is not a morning summary, so the window is three
 * hours.
 */
export function digestIsDue(
  sql: any,
  profile: UserProfile,
  settings: { daily_digest?: boolean; digest_time?: string },
  now: Date = new Date()
): { due: boolean; why: string } {
  if (!settings.daily_digest) return { due: false, why: "the daily digest is off" };

  const time = String(settings.digest_time || "08:00");
  const [hh, mm] = time.split(":").map((n) => Number(n) || 0);
  const target = hh * 60 + mm;

  const local = localParts(profile.timezone, now);
  const minutes = local.hour * 60 + local.minute;
  const today = localDateString(profile.timezone, now);

  if (minutes < target) {
    return { due: false, why: `it is ${local.hour}:${String(local.minute).padStart(2, "0")} in ${profile.timezone}, before ${time}` };
  }
  if (minutes > target + 180) {
    return { due: false, why: `it is too late for a ${time} digest (${local.hour}:${String(local.minute).padStart(2, "0")} in ${profile.timezone})` };
  }

  const state = readDigestState(sql);
  if (state.last_date === today) {
    return { due: false, why: "today's digest has already gone out" };
  }
  return { due: true, why: `it is ${local.hour}:${String(local.minute).padStart(2, "0")} in ${profile.timezone}` };
}

/**
 * Send the digest, if it is due.
 *
 * The push is the only channel that works yet: there is no outbound
 * email sender yet, and a push is what a phone can show.
 */
export async function sendDigestIfDue(
  sql: any,
  env: any,
  now: Date = new Date()
): Promise<{
  sent: boolean;
  why: string;
  recipients?: number;
  results?: any[];
  digest?: DigestContent;
}> {
  const profile = readProfile(sql);
  const settings = readSettingsSection(sql, "notifications");
  const due = digestIsDue(sql, profile, settings, now);
  if (!due.due) return { sent: false, why: due.why };

  const keys = readPushKeys(env);
  if (!keys) return { sent: false, why: "no push keys are set" };

  const subs = sql.exec("SELECT * FROM push_subscriptions").toArray();
  if (subs.length === 0) return { sent: false, why: "no devices are subscribed" };

  const digest = buildDigest(sql, profile, now);
  const results: any[] = [];
  for (const sub of subs) {
    const res = await sendPush({
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: keys.subject,
      payload: {
        title: digest.title,
        body: digest.body,
        tag: "taskmaster-digest",
        data: { url: "/" },
      },
    });
    if (res.gone) {
      sql.exec("DELETE FROM push_subscriptions WHERE endpoint = ?", sub.endpoint).toArray();
    } else {
      sql.exec(
        "UPDATE push_subscriptions SET last_ok = ?, last_error = ?, failures = ? WHERE endpoint = ?",
        res.ok ? Date.now() : null,
        res.ok ? "" : res.body || ("HTTP " + res.status),
        res.ok ? 0 : (sub.failures || 0) + 1,
        sub.endpoint
      ).toArray();
    }
    results.push({ status: res.status, ok: res.ok });
  }

  // The marker is written only after the send, so a failed send is
  // retried on the next tick.
  writeDigestState(sql, { last_date: digest.date, sent_at: now.getTime() });

  return { sent: true, why: due.why, recipients: results.length, results, digest };
}

/** One section of the stored settings, read straight from the table. */
function readSettingsSection(sql: any, section: string): any {
  try {
    const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    if (rows.length === 0) return {};
    const all = parseJson<any>(rows[0].value, {});
    return all[section] || {};
  } catch {
    return {};
  }
}
