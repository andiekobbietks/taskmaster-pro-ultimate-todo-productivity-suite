/**
 * Shared secret masking utilities.
 *
 * Used by both the Worker (settings.ts) and the browser bundle (app.jsx)
 * so the client and server agree on what a masked secret looks like.
 */

/**
 * Mask a secret so only the first three alphanumeric characters are
 * visible. Non-alphanumeric characters are stripped from the prefix.
 *
 * @param {string | undefined | null} value
 * @returns {string}
 */
export function maskSecret(value) {
  if (!value || typeof value !== "string" || value === "") return "";
  const prefix = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3);
  return prefix + "•".repeat(Math.max(6, value.length - prefix.length));
}

/**
 * Return true if a value is a masked secret produced by maskSecret().
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMasked(value) {
  return typeof value === "string" && /^[a-zA-Z0-9]{0,3}•+$/.test(value);
}

/**
 * Given a settings section, delete any keys whose current value is a
 * masked placeholder. This prevents the client from writing the mask
 * back over the real secret when saving an unrelated field.
 *
 * @param {Record<string, unknown> | undefined} section
 * @returns {Record<string, unknown> | undefined}
 */
export function withoutMasks(section) {
  if (!section) return section;
  const out = { ...section };
  for (const key of Object.keys(out)) {
    if (isMasked(out[key])) delete out[key];
  }
  return out;
}

/**
 * Legacy constant for callers that still expect a single mask token.
 * New code should prefer maskSecret() / isMasked().
 */
export const SECRET_MASK = "••••••••";
