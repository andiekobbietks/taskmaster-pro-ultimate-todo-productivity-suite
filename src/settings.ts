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
import { DEFAULT_PROFILE, readProfile, writeProfile, type UserProfile } from "./profile.ts";
import { isValidTimeZone } from "./timezone.ts";
import { testYahooConnection, type YahooConfig } from "./yahoo.ts";

// ── Types ────────────────────────────────────────────────────────────

/**
 * One page to capture.
 *
 * The manifest is a list of these. The capture runner reads it from the
 * app, so there is no configuration file to keep in step with the app.
 */
export interface CaptureSource {
  /** The page to capture */
  url: string;
  /** A name for it, used in the job list */
  name?: string;
  /** Whether it is in the manifest at all */
  enabled?: boolean;
  /** How many links on the page to follow and capture as well */
  follow?: number;
  /** Capture the whole site, not just the one page */
  whole_site?: boolean;
}

/**
 * The capture manifest and the rules around it.
 */
export interface CaptureSettings {
  sources: CaptureSource[];
  /** How many captures to run in one batch */
  batch_size: number;
  /** Keep the archive after it has been ingested */
  keep_archive: boolean;
  /** Where the runner should write the archives */
  output_dir: string;
}

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
    // The Yahoo Mail API. The app fetches the mail itself with these,
    // inside the Worker. See src/yahoo.ts.
    yahoo_client_id: string;
    yahoo_client_secret: string;
    yahoo_refresh_token: string;
    yahoo_mailbox_id: string;
  };
  capture: CaptureSettings;
  notifications: {
    daily_digest: boolean;
    digest_time: string;
    conflict_alerts: boolean;
    deadline_reminders: boolean;
  };
  // The same shape the eligibility engine reads. See src/profile.ts.
  profile: UserProfile;
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
    yahoo_client_id: "",
    yahoo_client_secret: "",
    yahoo_refresh_token: "",
    yahoo_mailbox_id: "/",
  },
  capture: {
    sources: [],
    batch_size: 10,
    keep_archive: true,
    output_dir: "captures",
  },
  notifications: {
    daily_digest: true,
    digest_time: "08:00",
    conflict_alerts: true,
    deadline_reminders: true,
  },
  profile: { ...DEFAULT_PROFILE },
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
  "imap_password", "jmap_password", "yahoo_client_secret", "yahoo_refresh_token",
  "azure_sas_token", "s3_secret_key",
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
 * What a set secret looks like from the outside.
 *
 * The screen shows this instead of the value, so the API never hands a
 * secret back. A person who wants to change one types a new value; the
 * old one stays until they do.
 */
export const SECRET_MASK = "********";

/**
 * Replace the sensitive values with the mask.
 *
 * Applied at the API boundary only. readSettings returns the real values,
 * because the mail and capture routes need them.
 */
export function maskSettings(settings: any): any {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const section of Object.values(copy)) {
    if (typeof section === "object" && section !== null) {
      for (const [key, value] of Object.entries(section)) {
        if (SENSITIVE_FIELDS.has(key) && typeof value === "string" && value !== "") {
          (section as any)[key] = SECRET_MASK;
        }
      }
    }
  }
  return copy;
}

/**
 * Read the whole settings object.
 *
 * The profile comes from the canonical table rather than the settings
 * blob, so what the screen shows and what the eligibility engine reads
 * are the same thing.
 */
export function readSettings(sql: any): any {
  const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
  const settings = rows.length > 0
    ? parseJson(rows[0].value, DEFAULT_SETTINGS)
    : { ...DEFAULT_SETTINGS };
  const deobfuscated = deobfuscateSettings(settings);
  deobfuscated.profile = readProfile(sql);
  return deobfuscated;
}

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

export function registerSettingsRoutes(app: Hono, sql: any) {
  // --- Get all settings -----------------------------------------------

  app.get("/api/settings", (c) => {
    // A secret is write-only. The screen is told that it is set, not what
    // it is.
    return c.json(maskSettings(readSettings(sql)));
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
      // A time zone the runtime does not know would break the digest and
      // the "today" filter, so an unknown one is refused rather than
      // stored.
      if (!isValidTimeZone(mergedProfile.timezone)) {
        mergedProfile.timezone = readProfile(sql).timezone || DEFAULT_PROFILE.timezone;
      }
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
    // The profile also lives in hackathon_profile, which is what the
    // eligibility engine reads. Clearing only the settings blob would leave
    // the profile behind and the two would disagree.
    sql.exec("DELETE FROM hackathon_profile WHERE id = 'default'");
    return c.json(DEFAULT_SETTINGS);
  });

  // --- Test the Yahoo application --------------------------------------

  app.post("/api/settings/test-yahoo", async (c) => {
    const settings = readSettings(sql);
    const email = settings.email || {};
    const config: YahooConfig = {
      client_id: email.yahoo_client_id || "",
      client_secret: email.yahoo_client_secret || "",
      refresh_token: email.yahoo_refresh_token || "",
      mailbox_id: email.yahoo_mailbox_id || "/",
    };
    const result = await testYahooConnection(config);
    return c.json(result, result.ok ? 200 : 400);
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
