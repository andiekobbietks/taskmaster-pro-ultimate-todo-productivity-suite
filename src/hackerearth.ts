/**
 * HackerEarth, as a data source.
 *
 * HackerEarth lists hackathons at /challenges/hackathon, but the page is a
 * Next.js app rendered with React Server Components (inline
 * `self.__next_f.push(...)` payloads) and no public, unauthenticated JSON
 * feed has been found. The documented HackerEarth APIs (code-eval v4 and
 * recruiter tests) are client-secret authed and do not list community
 * hackathons.
 *
 * This module keeps the shape of a real importer but reports the failure
 * honestly instead of shipping a brittle scraper against a payload that can
 * change silently.
 */

const LISTING_URL = "https://www.hackerearth.com/challenges/hackathon";

export async function fetchHackerEarthEvents(
  doFetch: typeof fetch = fetch
): Promise<{ events: any[] | null; ok: boolean; problem?: string }> {
  let res: Response;
  try {
    res = await doFetch(LISTING_URL, {
      headers: {
        Accept: "text/html",
        "User-Agent": "taskmaster-pro",
      },
    });
  } catch (err) {
    return { events: null, ok: false, problem: "Network error reaching HackerEarth" };
  }
  if (!res.ok) {
    return {
      events: null,
      ok: false,
      problem: `HackerEarth returned HTTP ${res.status}`,
    };
  }

  let html: string;
  try {
    html = await res.text();
  } catch {
    return { events: null, ok: false, problem: "Could not read HackerEarth response" };
  }

  // No public JSON feed or __NEXT_DATA__ block has been observed (measured
  // 2026-10-22). Returning an empty list with endpoint_ok:false lets the
  // diagnostics surface the dead feed instead of silently showing nothing.
  if (html.includes("__NEXT_DATA__") || html.includes('"hackathons":')) {
    // If a future page rev exposes structured data, this branch can be
    // replaced with real parsing. For now it is a guard, not a parser.
    return {
      events: null,
      ok: false,
      problem:
        "HackerEarth page contains structured data markers that are not " +
        "stable enough to parse without tests.",
    };
  }

  return {
    events: null,
    ok: false,
    problem:
      "No keyless JSON feed found. HackerEarth serves a Next.js RSC payload " +
      "and no public listing endpoint is documented.",
  };
}

/**
 * Honest no-op ingest for HackerEarth.
 */
export async function ingestHackerEarth(
  _sql: any,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<{
  fetched: number;
  imported: number;
  updated: number;
  endpoint_ok: boolean;
  problem: string;
}> {
  const doFetch = opts.fetchImpl || fetch;
  const result = await fetchHackerEarthEvents(doFetch);
  return {
    fetched: 0,
    imported: 0,
    updated: 0,
    endpoint_ok: result.ok,
    problem: result.problem || "Unknown failure",
  };
}
