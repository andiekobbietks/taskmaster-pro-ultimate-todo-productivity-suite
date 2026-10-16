/**
 * api.js — every request the front end makes goes through here.
 *
 * Why this exists: the app used to call `fetch()` directly in nine places and
 * only `console.error()` on failure. Two failure modes were invisible to the
 * person using the app:
 *
 *   1. Network failure — `fetch` rejects, nothing is logged to the screen, and
 *      the list quietly keeps showing yesterday's data.
 *   2. HTTP failure — a 400/500 with a JSON body does NOT reject `fetch`, so
 *      `await res.json()` succeeds and the app happily stores an error body as
 *      if it were the todos list.
 *
 * `api()` fixes both: it rejects on any non-2xx, and it pulls the server's own
 * `error` message out of the response body so the user sees what actually
 * went wrong instead of "TypeError: Failed to fetch".
 */

/** An error that is safe to show to the person using the app. */
export class ApiError extends Error {
  constructor(message, { status = 0, network = false, path = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.network = network;
    this.path = path;
  }
}

/**
 * Turn an unknown thrown value into a short, human sentence.
 * Used so a failure never surfaces as raw JavaScript.
 */
export function describeError(err) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

/**
 * Fetch JSON, rejecting with an ApiError on any failure.
 *
 * @param {string} path     e.g. "./api/todos?status=active"
 * @param {object} options  standard fetch options (method, headers, body)
 */
export async function api(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (networkErr) {
    // fetch only rejects on genuine transport problems (offline, DNS, CORS).
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      { network: true, path },
    );
  }

  // A JSON body is not guaranteed: a proxy or crash can return HTML.
  let body = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    // The Worker answers errors as `{ error: "…" }` — surface that verbatim.
    const serverMessage =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : null;
    throw new ApiError(
      serverMessage ?? `Request failed (${res.status} ${res.statusText})`,
      { status: res.status, path },
    );
  }

  return body;
}
