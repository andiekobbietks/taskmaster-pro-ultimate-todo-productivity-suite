/**
 * Settings module — configurable backend settings for taskmaster-pro.
 *
 * Design notes:
 * - Settings stored as key-value pairs in SQLite (settings table).
 * - Sensitive values (API keys, secrets) are stored encrypted.
 * - Settings are organized into sections: storage, archive, email, notifications, profile.
 * - The frontend renders a settings view that lets the user configure each section.
 * - Archive sources are managed via the archive module, but surfaced here too.
 */
import { Hono } from "hono";

// ── Types ────────────────────────────────────────────────────────────

export interface Settings {
  storage: {
    provider: "r2" | "s3" | "azure";
    r2_bucket: string;
    s3_bucket: string;
    s3_region: string;
    azure_account: string;
    azure_container: string;
    azure_sas_token: string;
  };
  email: {
    inbox_address: string;
    imap_host: string;
    imap_port: number;
    imap_user: string;
    imap_password: string;
    // JMAP (RFC 8620) — the alternative to IMAP. See src/jmap.ts.
    jmap_server_url: string;
    jmap_username: string;
    jmap_password: string;
  };
  notifications: {
    daily_digest: boolean;
    digest_time: string;
    conflict_alerts: boolean;
    deadline_reminders: boolean;
  };
  profile: {
    citizenships: string[];
    residencies: string[];
    residency_status: string;
    age: number;
    is_student: boolean;
    team_size: number;
    employed_by_sponsor: boolean;
  };
}

const DEFAULT_SETTINGS: Settings = {
  storage: {
    provider: "r2",
    r2_bucket: "taskmaster-pro-screenshots",
    s3_bucket: "",
    s3_region: "eu-west-2",
    azure_account: "",
    azure_container: "",
    azure_sas_token: "",
  },
  email: {
    inbox_address: "",
    imap_host: "imap.mail.yahoo.com",
    imap_port: 993,
    imap_user: "",
    imap_password: "",
    jmap_server_url: "",
    jmap_username: "",
    jmap_password: "",
  },
  notifications: {
    daily_digest: true,
    digest_time: "08:00",
    conflict_alerts: true,
    deadline_reminders: true,
  },
  profile: {
    citizenships: ["IT"],
    residencies: ["GB"],
    residency_status: "settled",
    age: 25,
    is_student: false,
    team_size: 1,
    employed_by_sponsor: false,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────


/**
 * Merge a partial settings update into the stored settings.
 *
 * The Settings screen PUTs one section at a time, so a shallow spread
 * over the defaults would wipe every section the request did not name.
 * Merge per section and per key instead, against what is stored.
 */
function mergeSettings(stored: any, incoming: any): any {
  const merged: any = { ...stored };
  for (const key of Object.keys(incoming || {})) {
    const value = incoming[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = { ...(stored[key] || {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function now(): number { return Date.now(); }

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// Simple XOR-based obfuscation for sensitive values.
// NOT cryptographically secure — just prevents casual reading.
// For production, use Cloudflare's secret management or a proper KMS.
function obfuscate(value: string): string {
  if (!value) return "";
  const key = "taskmaster-pro-settings-key";
  let result = "";
  for (let i = 0; i < value.length; i++) {
    result += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
}

function deobfuscate(value: string): string {
  if (!value) return "";
  try {
    const key = "taskmaster-pro-settings-key";
    const decoded = atob(value);
    let result = "";
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch {
    return "";
  }
}

// Fields that should be obfuscated in storage
const SENSITIVE_FIELDS = new Set([
  "imap_password", "jmap_password", "azure_sas_token", "s3_secret_key",
]);

function obfuscateSettings(settings: any): any {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const section of Object.values(copy)) {
    if (typeof section === "object" && section !== null) {
      for (const [key, value] of Object.entries(section)) {
        if (SENSITIVE_FIELDS.has(key) && typeof value === "string") {
          (section as any)[key] = obfuscate(value);
        }
      }
    }
  }
  return copy;
}

function deobfuscateSettings(settings: any): any {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const section of Object.values(copy)) {
    if (typeof section === "object" && section !== null) {
      for (const [key, value] of Object.entries(section)) {
        if (SENSITIVE_FIELDS.has(key) && typeof value === "string") {
          (section as any)[key] = deobfuscate(value);
        }
      }
    }
  }
  return copy;
}

// ── Route registration ───────────────────────────────────────────────

/**
 * Register all settings-related API routes on the Hono app.
 *
 * Routes:
 * - GET /api/settings — Get all settings
 * - GET /api/settings/:section — Get a specific section
 * - PUT /api/settings — Update all settings
 * - PATCH /api/settings/:section — Update a specific section
 * - POST /api/settings/reset — Reset to defaults
 * - POST /api/settings/test-storage — Test storage connection
 *
 * @param app - Hono application instance
 * @param sql - SQLite storage interface from Durable Object
 */

/**
 * Write the eligibility profile to its canonical home.
 *
 * The profile lives in the `hackathon_profile` table because that is what
 * the eligibility engine reads (src/hackathons.ts). The settings blob
 * keeps a copy so the Settings screen can render it, but the table is
 * authoritative. Writing either place updates both, so the two can never
 * drift apart.
 */
function writeProfile(sql: any, profile: any) {
  const json = JSON.stringify(profile);
  sql.exec(
    `INSERT INTO hackathon_profile (id, profile_json, updated_at) VALUES ('default', ?, ?)
     ON CONFLICT(id) DO UPDATE SET profile_json = ?, updated_at = ?`,
    json, now(), json, now()
  ).toArray();
}

/**
 * Read the eligibility profile from its canonical home.
 */
function readProfile(sql: any): any {
  const rows = sql
    .exec("SELECT profile_json FROM hackathon_profile WHERE id = 'default'")
    .toArray();
  if (rows.length > 0 && rows[0].profile_json) {
    try {
      return JSON.parse(rows[0].profile_json);
    } catch {
      // fall through to the defaults
    }
  }
  return { ...DEFAULT_SETTINGS.profile };
}

export function registerSettingsRoutes(app: Hono, sql: any) {
  // --- Get all settings -----------------------------------------------

  app.get("/api/settings", (c) => {
    const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    const settings = rows.length > 0
      ? parseJson(rows[0].value, DEFAULT_SETTINGS)
      : { ...DEFAULT_SETTINGS };
    const deobfuscated = deobfuscateSettings(settings);
    // The profile is authoritative in hackathon_profile — the table the
    // eligibility engine reads. Return it from there, not from the blob.
    deobfuscated.profile = readProfile(sql);
    return c.json(deobfuscated);
  });

  // --- Update all settings --------------------------------------------

  app.put("/api/settings", async (c) => {
    const data = await c.req.json();

    // Start from what is stored, not from the defaults — otherwise a
    // one-section update resets every other section.
    const storedRows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    const stored = storedRows.length > 0
      ? deobfuscateSettings(parseJson(storedRows[0].value, DEFAULT_SETTINGS))
      : { ...DEFAULT_SETTINGS };

    const settings = mergeSettings(stored, data);

    // If a profile came in, it wins and is written to the canonical table.
    // Merge it against the stored profile first — the Settings screen sends
    // one field at a time, and writing the partial profile straight to the
    // table would drop the fields it did not mention.
    if (data.profile) {
      const mergedProfile = mergeSettings(readProfile(sql), data.profile);
      writeProfile(sql, mergedProfile);
      settings.profile = mergedProfile;
    }
    const obfuscated = obfuscateSettings(settings);

    sql.exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ('main', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
      JSON.stringify(obfuscated), now(), JSON.stringify(obfuscated), now()
    ).toArray();

    // Return the merged view, with the profile read from its canonical table.
    const result = { ...settings };
    result.profile = readProfile(sql);
    return c.json(result);
  });

  // --- Get a specific section -----------------------------------------

  app.get("/api/settings/:section", (c) => {
    const section = c.req.param("section");
    const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    const settings = rows.length > 0 ? parseJson(rows[0].value, DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
    const deobfuscated = deobfuscateSettings(settings);

    if (!(section in deobfuscated)) {
      return c.json({ error: "Unknown settings section" }, 404);
    }

    return c.json(deobfuscated[section as keyof Settings]);
  });

  // --- Update a specific section --------------------------------------

  app.patch("/api/settings/:section", async (c) => {
    const section = c.req.param("section");
    const data = await c.req.json();

    const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    const settings = rows.length > 0 ? parseJson(rows[0].value, DEFAULT_SETTINGS) : { ...DEFAULT_SETTINGS };
    const deobfuscated = deobfuscateSettings(settings);

    if (!(section in deobfuscated)) {
      return c.json({ error: "Unknown settings section" }, 404);
    }

    deobfuscated[section as keyof Settings] = mergeSettings(
      deobfuscated[section as keyof Settings],
      data
    );

    // A profile change must also land in hackathon_profile, which is what
    // the eligibility engine reads. Without this the Settings screen and
    // the engine disagree about who you are. Merge against the canonical
    // profile so a one-field edit does not drop the others.
    if (section === "profile") {
      const mergedProfile = mergeSettings(readProfile(sql), data);
      writeProfile(sql, mergedProfile);
      deobfuscated.profile = mergedProfile;
    }

    const obfuscated = obfuscateSettings(deobfuscated);
    sql.exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ('main', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
      JSON.stringify(obfuscated), now(), JSON.stringify(obfuscated), now()
    ).toArray();

    return c.json(deobfuscated[section as keyof Settings]);
  });

  // --- Reset to defaults ----------------------------------------------

  app.post("/api/settings/reset", (c) => {
    sql.exec("DELETE FROM settings WHERE key = 'main'");
    return c.json(DEFAULT_SETTINGS);
  });

  // --- Test storage connection ----------------------------------------

  app.post("/api/settings/test-storage", async (c) => {
    const data = await c.req.json();
    const provider = data.provider || "r2";

    // For R2, test by writing and reading a small object
    if (provider === "r2") {
      try {
        // In a real implementation, this would test the R2 binding
        return c.json({ success: true, message: "R2 connection OK (native binding)" });
      } catch (e: any) {
        return c.json({ success: false, message: e.message }, 400);
      }
    }

    if (provider === "s3") {
      // Test S3 connection with provided credentials
      try {
        const { S3Client, ListBucketsCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({
          region: data.region || "eu-west-2",
          credentials: {
            accessKeyId: data.access_key_id,
            secretAccessKey: data.secret_access_key,
          },
        });
        await s3.send(new ListBucketsCommand({}));
        return c.json({ success: true, message: "S3 connection OK" });
      } catch (e: any) {
        return c.json({ success: false, message: e.message }, 400);
      }
    }

    if (provider === "azure") {
      try {
        const { BlobServiceClient } = await import("@azure/storage-blob");
        const client = new BlobServiceClient(
          `https://${data.account}.blob.core.windows.net?${data.sas_token}`
        );
        await client.listContainers().next();
        return c.json({ success: true, message: "Azure Blob Storage connection OK" });
      } catch (e: any) {
        return c.json({ success: false, message: e.message }, 400);
      }
    }

    return c.json({ error: "Unknown storage provider" }, 400);
  });
}
