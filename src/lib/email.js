/**
 * email.js — utilities for the inbox primitives.
 *
 * The interaction patterns (split view, unread dot, row keyboard nav, avatar
 * initial, skeleton) follow cloudflare/agentic-inbox, which is licensed under
 * the Apache License 2.0. These helpers are re-implemented against the
 * TaskMaster Pro design tokens rather than copied.
 *
 * Everything here is text-only on purpose: email HTML is never injected into
 * the DOM, so there is no sanitiser to get wrong.
 */

/**
 * Strip HTML tags and collapse whitespace, for a plain-text preview.
 *
 * @param {string} html - Raw HTML
 * @returns {string} Plain text
 */
export function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build a short one-line snippet from a body.
 *
 * @param {string} body - Email body (HTML or text)
 * @param {number} [maxLength=140] - Maximum characters
 * @returns {string} A single-line snippet
 */
export function getSnippetText(body, maxLength = 140) {
  const text = stripHtml(body).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}

/**
 * Format a byte count as a human-readable file size.
 *
 * @param {number} bytes - Size in bytes
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} e.g. "1.4 MB"
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${value} ${sizes[i]}`;
}

const DAY_MS = 86400000;

/**
 * Format a date for an email list row: time if today, weekday if this week,
 * otherwise a short date.
 *
 * @param {number|string|Date} date - The date
 * @returns {string} Formatted date
 */
export function formatListDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY_MS);

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Format a date for the detail panel header: full date and time.
 *
 * @param {number|string|Date} date - The date
 * @returns {string} Formatted date
 */
export function formatDetailDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The first letter of a sender address, for the avatar.
 *
 * @param {string} sender - Sender email address
 * @returns {string} One uppercase character
 */
export function senderInitial(sender) {
  if (!sender) return "?";
  const trimmed = sender.trim();
  return trimmed.charAt(0).toUpperCase() || "?";
}

/**
 * The display name for a sender: the local part of the address, capitalised.
 *
 * @param {string} sender - Sender email address
 * @returns {string} Display name
 */
export function senderName(sender) {
  if (!sender) return "Unknown sender";
  const local = sender.split("@")[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
