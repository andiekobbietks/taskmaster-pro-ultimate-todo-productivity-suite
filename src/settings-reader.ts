/**
 * Reading one section of the stored settings.
 *
 * The settings live in the `settings` table as one JSON blob under the
 * key `main`. This module is the only place that knows how to find a
 * section inside it.
 *
 * It is separate from `settings.ts` on purpose: `settings.ts` imports
 * the mail and profile modules, and the mail module needs to read the
 * settings. A one-function module with no imports keeps that from
 * becoming a cycle.
 */

/** Parse JSON, falling back rather than throwing. */
export function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * One section of the stored settings.
 *
 * Returns an empty object when the table is empty, the key is missing,
 * or the blob cannot be parsed — a caller asking for "email" should not
 * have to handle three failure modes.
 */
export function readSettingsSection(sql: any, section: string): any {
  try {
    const rows = sql.exec("SELECT value FROM settings WHERE key = 'main'").toArray();
    if (rows.length === 0) return {};
    const all = parseJson<any>(rows[0].value, {});
    return all[section] || {};
  } catch {
    return {};
  }
}
