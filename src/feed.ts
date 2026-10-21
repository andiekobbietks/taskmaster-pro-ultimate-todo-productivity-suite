/**
 * Feeds, in both directions.
 *
 * Outbound: the app publishes the competitions it tracks as RSS 2.0, so
 * anything can subscribe to them — a reader, a script, another agent.
 *
 * Inbound: the app reads RSS and Atom, because there are no hackathon
 * listing feeds, but there are plenty of regional tech-news feeds that
 * mention hackathons.
 *
 * Yahoo Pipes used to be the service that turned a website into a feed.
 * It is gone: pipes.yahoo.com, query.yahooapis.com and yql.yahooapis.com
 * all fail to resolve, and the YQL page is an empty shell. So the app
 * does the job itself.
 */

// ── Writing a feed ───────────────────────────────────────────────────

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  /** RFC 822 date */
  pubDate?: string;
  guid?: string;
}

/**
 * Escape the five characters that XML cares about.
 */
function xmlEscape(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build an RSS 2.0 document.
 */
export function buildRssFeed(
  title: string,
  description: string,
  link: string,
  items: FeedItem[]
): string {
  const body = items
    .map((item) => {
      const parts = [
        "    <item>",
        `      <title>${xmlEscape(item.title)}</title>`,
        `      <link>${xmlEscape(item.link)}</link>`,
      ];
      if (item.guid) parts.push(`      <guid isPermaLink="false">${xmlEscape(item.guid)}</guid>`);
      if (item.pubDate) parts.push(`      <pubDate>${xmlEscape(item.pubDate)}</pubDate>`);
      if (item.description) {
        parts.push(`      <description>${xmlEscape(item.description)}</description>`);
      }
      parts.push("    </item>");
      return parts.join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(link)}</link>
    <description>${xmlEscape(description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;
}

// ── Reading a feed ───────────────────────────────────────────────────

export interface ParsedFeed {
  title: string;
  link: string;
  items: Array<{ title: string; link: string; description: string; pubDate?: string }>;
  /** Which format it was */
  format: "rss" | "atom";
}

function decodeEntities(value: string): string {
  return String(value || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(value: string): string {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function tagText(block: string, tag: string): string {
  // An Atom <link href="..."/> carries its value in an attribute and has
  // no text, so that form is checked first.
  const href = new RegExp("<" + tag + "\\b[^>]*\\bhref=[\"']([^\"']+)[\"']", "i").exec(block);
  if (href) return decodeEntities(href[1]);
  const m = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "i").exec(block);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/**
 * Parse an RSS 2.0 or Atom document.
 */
export function parseFeed(xml: string): ParsedFeed {
  const text = String(xml || "");

  const isAtom = /<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text);
  if (isAtom) {
    const items: ParsedFeed["items"] = [];
    const blocks = text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    for (const block of blocks) {
      items.push({
        title: stripTags(tagText(block, "title")),
        link: tagText(block, "link"),
        description: stripTags(tagText(block, "summary") || tagText(block, "content")),
        pubDate: tagText(block, "updated") || tagText(block, "published") || undefined,
      });
    }
    return {
      title: stripTags(tagText(text.slice(0, text.indexOf("</feed>")), "title")),
      link: tagText(text.slice(0, text.indexOf("</feed>")), "link"),
      items,
      format: "atom",
    };
  }

  const items: ParsedFeed["items"] = [];
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    items.push({
      title: stripTags(tagText(block, "title")),
      link: stripTags(tagText(block, "link")),
      description: stripTags(tagText(block, "description") || tagText(block, "content:encoded")),
      pubDate: tagText(block, "pubDate") || undefined,
    });
  }
  const head = text.slice(0, Math.max(text.indexOf("</channel>"), 0));
  return {
    title: stripTags(tagText(head, "title")),
    link: stripTags(tagText(head, "link")),
    items,
    format: "rss",
  };
}

/**
 * The items in a feed that look like they are about a hackathon.
 *
 * This is what turns a regional tech-news feed into a source of
 * competitions. It is a keyword filter, and it is noisy on purpose: a
 * person reads the list and decides.
 */
export function findHackathonMentions(
  feed: ParsedFeed,
  keywords: string[] = [
    "hackathon", "hack-", "hackfest", "hack day", "hackday",
    "devpost", "major league hacking", "mlh", "codefest",
  ]
): Array<{ title: string; link: string; description: string; pubDate?: string }> {
  const out: ParsedFeed["items"] = [];
  for (const item of feed.items) {
    const haystack = (item.title + " " + item.description).toLowerCase();
    if (keywords.some((k) => haystack.includes(k))) out.push(item);
  }
  return out;
}

/**
 * Fetch a feed and pull the hackathon mentions out of it.
 */
export async function readFeed(
  url: string,
  keywords?: string[]
): Promise<{ ok: boolean; title: string; format: string; total: number; matches: any[]; message?: string }> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "TaskMasterPro/1.3 (feed reader; contact: andiekobbietks@outlook.com)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!resp.ok) {
      return { ok: false, title: "", format: "", total: 0, matches: [],
               message: "The feed answered HTTP " + resp.status };
    }
    const xml = await resp.text();
    const feed = parseFeed(xml);
    const matches = findHackathonMentions(feed, keywords);
    return {
      ok: true,
      title: feed.title,
      format: feed.format,
      total: feed.items.length,
      matches,
    };
  } catch (err: any) {
    return { ok: false, title: "", format: "", total: 0, matches: [],
             message: err?.message || String(err) };
  }
}
