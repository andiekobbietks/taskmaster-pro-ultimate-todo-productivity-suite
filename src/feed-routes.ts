/**
 * The feed routes.
 *
 *   GET  /api/feed.xml     the competitions the app tracks, as RSS 2.0
 *   POST /api/feed/fetch    read a feed and pull the hackathon mentions out
 *
 * The first is for anything that wants to subscribe. The second is for
 * finding the competitions in the first place: there is no hackathon
 * listing feed, but there are regional tech-news feeds that mention them.
 */
import { Hono } from "hono";
import { buildRssFeed, readFeed, type FeedItem } from "./feed.ts";
import { readProfile } from "./profile.ts";
import { evaluateEligibility, type EligibilityRules } from "./hackathons.ts";

function rfc822(ms: number): string {
  return new Date(ms).toUTCString();
}

export function registerFeedRoutes(app: Hono, sql: any): void {
  // --- The app's own feed ---------------------------------------------
  app.get("/api/feed.xml", (c) => {
    const rows = sql.exec(
      "SELECT * FROM hackathons WHERE status = 'open' ORDER BY created_at DESC LIMIT 100"
    ).toArray();
    const profile = readProfile(sql);

    const items: FeedItem[] = rows.map((r: any) => {
      const rules = safeJson(r.eligibility_json) as EligibilityRules;
      const verdict = evaluateEligibility(rules || ({} as any), profile);
      const deadline = r.submission_deadline || r.end_date;
      const bits = [
        r.platform,
        deadline ? "closes " + deadline : "",
        r.prize ? "prize " + r.prize : "",
        verdict.eligible ? verdict.qualification_path : "not eligible: " + verdict.reasons.join("; "),
      ].filter(Boolean);

      return {
        title: r.name,
        link: r.url || "",
        description: bits.join(" · "),
        pubDate: rfc822(Number(r.created_at) || Date.now()),
        guid: r.id,
      };
    });

    const xml = buildRssFeed(
      "TaskMaster Pro — competitions being tracked",
      "The hackathons and competitions tracked in this TaskMaster Pro instance, " +
      "with the deadline, the prize and the eligibility verdict.",
      "",
      items
    );
    return c.body(xml, 200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  });

  // --- Read a feed and find the hackathons in it ----------------------
  app.post("/api/feed/fetch", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      // An empty body is fine.
    }
    const url = String(body.url || "").trim();
    if (!url) {
      return c.json({ error: "A feed url is needed" }, 400);
    }
    if (!/^https?:\/\//i.test(url)) {
      return c.json({ error: "The feed url must be http or https" }, 400);
    }
    const result = await readFeed(url, body.keywords);
    return c.json(result, result.ok ? 200 : 502);
  });

  // --- The feeds that are known to work, for a first run ---------------
  app.get("/api/feed/known", (c) => {
    return c.json({
      note:
        "There is no RSS feed that lists hackathons, for any platform, in any " +
        "region. These are the feeds that do work, and they find hackathons " +
        "mentioned in articles rather than listings. Filter them with " +
        "POST /api/feed/fetch.",
      feeds: [
        { url: "https://techcabal.com/feed/", region: "Africa", items: 10,
          note: "Pan-African tech news" },
        { url: "https://www.gadget.co.za/feed/", region: "South Africa", items: 30,
          note: "Gadget, South Africa" },
        { url: "https://analyticsindiamag.com/feed", region: "India", items: 50,
          note: "AIM — had the most hackathon mentions of any feed checked" },
        { url: "https://yourstory.com/feed", region: "India", items: 20,
          note: "YourStory" },
        { url: "https://ec.europa.eu/commission/presscorner/api/rss?language=en",
          region: "EU", items: 10, note: "EU press releases" },
        { url: "https://hnrss.org/frontpage", region: "Global", items: 20,
          note: "Hacker News" },
      ],
      dead: [
        "https://devpost.com/feed.rss — returns the homepage as HTML, not a feed",
        "https://pipes.yahoo.com — does not resolve; Yahoo Pipes is gone",
        "https://query.yahooapis.com — does not resolve; YQL is gone",
        "https://mlh.io/feed.rss — 404",
      ],
    });
  });
}

function safeJson(value: any): any {
  try {
    return typeof value === "string" ? JSON.parse(value || "{}") : (value ?? {});
  } catch {
    return {};
  }
}
