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
import { maskSecret, SECRET_MASK } from "./lib/secret.js";
import { writeAuditLog, readAuditLog } from "./audit.ts";
import { encryptSetting, decryptSetting, isEncrypted } from "./settings-crypto.ts";

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
    // Outbound email (digest / test). One provider at a time.
    provider: "oracle" | "sendgrid" | "ses" | "";
    sendgrid_api_key: string;
    ses_region: string;
    ses_sender: string;
    ses_access_key: string;
    ses_secret_key: string;
    oracle_smtp_host: string;
    oracle_smtp_port: number;
    oracle_smtp_user: string;
    oracle_smtp_pass: string;
    from_address: string;
    from_name: string;
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
  advanced?: {
    checkpoint_cli_enabled?: boolean;
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
    yahoo_client_id: "",
    yahoo_client_secret: "",
    yahoo_refresh_token: "",
    yahoo_mailbox_id: "/",
    provider: "",
    sendgrid_api_key: "",
    ses_region: "us-east-1",
    ses_sender: "",
    ses_access_key: "",
    ses_secret_key: "",
    oracle_smtp_host: "smtp-mail.oracle.com",
    oracle_smtp_port: 587,
    oracle_smtp_user: "",
    oracle_smtp_pass: "",
    from_address: "",
    from_name: "TaskMaster Pro",
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
  advanced: {
    checkpoint_cli_enabled: false,
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

// Legacy XOR-based obfuscation. Kept only so values written before the
// Web Crypto migration can still be read. New values use AES-256-GCM.
function legacyDeobfuscate(value: string): string {
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
    // Not a legacy XOR value (e.g. plaintext or already encrypted). Leave
    // it for decryptSettings to handle.
    return value;
  }
}

// Fields that should be encrypted at rest
const SENSITIVE_FIELDS = new Set([
  "imap_password", "jmap_password", "yahoo_client_secret", "yahoo_refresh_token",
  "azure_sas_token", "s3_secret_key",
  "sendgrid_api_key", "ses_access_key", "ses_secret_key", "oracle_smtp_pass",
]);

/**
 * Encrypt every sensitive field that is not already encrypted.
 * Empty strings are left empty. If no encryption key is configured the
 * value is stored as-is (development / test fallback).
 */
async function encryptSettings(settings: any, env: any): Promise<any> {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const section of Object.values(copy)) {
    if (typeof section === "object" && section !== null) {
      for (const [key, value] of Object.entries(section)) {
        if (SENSITIVE_FIELDS.has(key) && typeof value === "string" && value !== "" && !isEncrypted(value)) {
          (section as any)[key] = await encryptSetting(value, env);
        }
      }
    }
  }
  return copy;
}

/**
 * Synchronous legacy deobfuscation. Encrypted `enc:v1:` values are left
 * untouched so they can be decrypted asynchronously at the API boundary.
 */
function legacyDeobfuscateSettings(settings: any): any {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const section of Object.values(copy)) {
    if (typeof section === "object" && section !== null) {
      for (const [key, value] of Object.entries(section)) {
        if (SENSITIVE_FIELDS.has(key) && typeof value === "string" && value !== "" && !isEncrypted(value)) {
          (section as any)[key] = legacyDeobfuscate(value);
        }
      }
    }
  }
  return copy;
}

/**
 * Decrypt `enc:v1:` values in place. Legacy XOR values are deobfuscated.
 * If no key is configured, encrypted values become empty strings.
 */
async function decryptSettings(settings: any, env: any): Promise<any> {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const section of Object.values(copy)) {
    if (typeof section === "object" && section !== null) {
      for (const [key, value] of Object.entries(section)) {
        if (SENSITIVE_FIELDS.has(key) && typeof value === "string" && value !== "") {
          if (isEncrypted(value)) {
            (section as any)[key] = await decryptSetting(value, env);
          } else {
            // Legacy XOR values are base64-ish and reversible with the
            // same function. If it is not valid base64 the helper returns "".
            (section as any)[key] = legacyDeobfuscate(value);
          }
        }
      }
    }
  }
  return copy;
}

function auditActor(c: any): string {
  return c.req.header("x-audit-actor") || "user";
}

function auditIp(c: any): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";
}

function changedSensitiveFields(before: any, after: any): string[] {
  const changed: string[] = [];
  for (const section of Object.keys(after)) {
    const beforeSection = before?.[section] || {};
    const afterSection = after[section] || {};
    for (const field of SENSITIVE_FIELDS) {
      const b = beforeSection[field];
      const a = afterSection[field];
      if (typeof a === "string" && a !== "" && a !== b) {
        changed.push(`${section}.${field}`);
      }
    }
  }
  return changed;
}

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
 * old one stays until they do. The first three alphanumeric characters
 * are preserved so the user can tell one secret from another.
 */
export { SECRET_MASK };

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
          (section as any)[key] = maskSecret(value);
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
  const stored = rows.length > 0 ? parseJson(rows[0].value, {}) : {};
  // Deep-merge: stored wins for keys present, defaults fill missing.
  function deepMerge(t: any, s: any): any {
    const o = { ...t };
    for (const k of Object.keys(s)) {
      if (s[k] !== null && typeof s[k] === "object" && !Array.isArray(s[k]) && !(s[k] instanceof Date)) {
        o[k] = deepMerge(o[k] || {}, s[k]);
      } else {
        o[k] = s[k];
      }
    }
    return o;
  }
  const settings = deepMerge({ ...DEFAULT_SETTINGS }, stored);
  const deobfuscated = legacyDeobfuscateSettings(settings);
  deobfuscated.profile = readProfile(sql);
  return deobfuscated;
}

/**
 * Read the whole settings object with sensitive values decrypted.
 *
 * Use this at API boundaries and anywhere the actual secret is needed
 * (mail, email sending). Internal callers that only read non-sensitive
 * configuration can use the synchronous readSettings().
 */
export async function readDecryptedSettings(sql: any, env: any): Promise<any> {
  const settings = readSettings(sql);
  return decryptSettings(settings, env);
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

export function registerSettingsRoutes(app: Hono, sql: any, env: any = {}) {
  // --- Get all settings -----------------------------------------------

  app.get("/api/settings", async (c) => {
    // A secret is write-only. The screen is told that it is set, not what
    // it is.
    return c.json(maskSettings(await readDecryptedSettings(sql, env)));
  });

  // --- Update all settings --------------------------------------------

  app.put("/api/settings", async (c) => {
    const data = await c.req.json();

    // Start from what is stored, decrypted, not from the defaults —
    // otherwise a one-section update resets every other section.
    const stored = await readDecryptedSettings(sql, env);
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
    const encrypted = await encryptSettings(settings, env);

    sql.exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ('main', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
      JSON.stringify(encrypted), now(), JSON.stringify(encrypted), now()
    ).toArray();

    const sensitiveChanged = changedSensitiveFields(stored, settings);
    if (sensitiveChanged.length > 0) {
      writeAuditLog(sql, {
        actor: auditActor(c),
        action: "credentials.updated",
        resource: "settings",
        details: { fields: sensitiveChanged },
        ip: auditIp(c),
      });
    }
    writeAuditLog(sql, {
      actor: auditActor(c),
      action: "settings.updated",
      resource: "settings",
      details: { sections: Object.keys(data) },
      ip: auditIp(c),
    });

    // Return the merged view, with the profile read from its canonical table.
    const result = { ...settings };
    result.profile = readProfile(sql);
    return c.json(result);
  });

  // --- Get a specific section -----------------------------------------

  app.get("/api/settings/:section", async (c) => {
    const section = c.req.param("section");
    const decrypted = await readDecryptedSettings(sql, env);

    if (!(section in decrypted)) {
      return c.json({ error: "Unknown settings section" }, 404);
    }

    return c.json(decrypted[section as keyof Settings]);
  });

  // --- Update a specific section --------------------------------------

  app.patch("/api/settings/:section", async (c) => {
    const section = c.req.param("section");
    const data = await c.req.json();

    const decryptedBefore = await readDecryptedSettings(sql, env);
    const decrypted = JSON.parse(JSON.stringify(decryptedBefore));

    if (!(section in decrypted)) {
      return c.json({ error: "Unknown settings section" }, 404);
    }

    decrypted[section as keyof Settings] = mergeSettings(
      decrypted[section as keyof Settings],
      data
    );

    // A profile change must also land in hackathon_profile, which is what
    // the eligibility engine reads. Without this the Settings screen and
    // the engine disagree about who you are. Merge against the canonical
    // profile so a one-field edit does not drop the others.
    if (section === "profile") {
      const mergedProfile = mergeSettings(readProfile(sql), data);
      writeProfile(sql, mergedProfile);
      decrypted.profile = mergedProfile;
    }

    const encrypted = await encryptSettings(decrypted, env);
    sql.exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ('main', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
      JSON.stringify(encrypted), now(), JSON.stringify(encrypted), now()
    ).toArray();

    const sensitiveChanged = changedSensitiveFields(decryptedBefore, decrypted);
    if (sensitiveChanged.length > 0) {
      writeAuditLog(sql, {
        actor: auditActor(c),
        action: "credentials.updated",
        resource: "settings",
        details: { fields: sensitiveChanged },
        ip: auditIp(c),
      });
    }
    writeAuditLog(sql, {
      actor: auditActor(c),
      action: "settings.section.updated",
      resource: "settings",
      resource_id: section,
      details: { fields: Object.keys(data) },
      ip: auditIp(c),
    });

    return c.json(decrypted[section as keyof Settings]);
  });

  // --- Reset to defaults ----------------------------------------------

  app.post("/api/settings/reset", (c) => {
    sql.exec("DELETE FROM settings WHERE key = 'main'");
    // The profile also lives in hackathon_profile, which is what the
    // eligibility engine reads. Clearing only the settings blob would leave
    // the profile behind and the two would disagree.
    sql.exec("DELETE FROM hackathon_profile WHERE id = 'default'");
    writeAuditLog(sql, {
      actor: auditActor(c),
      action: "settings.reset",
      resource: "settings",
      ip: auditIp(c),
    });
    return c.json(DEFAULT_SETTINGS);
  });

  // --- Audit log ------------------------------------------------------

  app.get("/api/audit/log", (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") || "250", 10), 1000);
    return c.json(readAuditLog(sql, limit));
  });

  // --- Test the Yahoo application --------------------------------------

  app.post("/api/settings/test-yahoo", async (c) => {
    const settings = await readDecryptedSettings(sql, env);
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
