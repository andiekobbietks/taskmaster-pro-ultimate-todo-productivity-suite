/**
 * Calendar routes.
 *
 *   GET  /api/calendar.ics        the calendar feed (stable)
 *   GET  /api/calendar/export.ics  the same feed as a download
 *   GET  /api/calendar/methods    what the wizard can do, and what is experimental
 *   POST /api/calendar/push       push events to a calendar (experimental)
 *
 * The feed is the stable part: any calendar client can subscribe to the
 * URL and refresh it. The push paths (Microsoft Graph, CalDAV) are
 * experimental and say so.
 */

import { Hono } from "hono";
import { icalDocument, hackathonToIcal, type ICalEvent } from "./ical.ts";

/** The rows the calendar is built from: everything still open. */
function openRows(sql: any): any[] {
  return sql
    .exec(
      "SELECT * FROM hackathons WHERE status = 'open' ORDER BY " +
        "COALESCE(submission_deadline, end_date, start_date) ASC"
    )
    .toArray();
}

/** The events, in the order they were built. */
function eventsFrom(sql: any): ICalEvent[] {
  const events: ICalEvent[] = [];
  for (const r of openRows(sql)) {
    const e = hackathonToIcal(r, "TaskMaster Pro");
    if (e) events.push(e);
  }
  return events;
}

export function registerCalendarRoutes(app: Hono, sql: any): void {
  // --- The feed --------------------------------------------------------
  app.get("/api/calendar.ics", (c) => {
    const xml = icalDocument(eventsFrom(sql));
    return c.body(xml, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  });

  // --- The same feed, as a download ------------------------------------
  app.get("/api/calendar/export.ics", (c) => {
    const xml = icalDocument(eventsFrom(sql));
    return c.body(xml, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hackathons.ics"',
    });
  });

  // --- What the wizard may offer --------------------------------------
  //
  // The wizard reads this instead of hard-coding the list, so the
  // frontend and the backend cannot drift apart.
  app.get("/api/calendar/methods", (c) =>
    c.json({
      methods: [
        {
          id: "subscribe",
          name: "Subscribe (iPhone, Outlook, Google)",
          stable: true,
          needs_auth: false,
          how: "iPhone: Settings > Calendar > Add Calendar > Subscribe, then paste the feed URL. Outlook: File > Add calendar > From internet.",
          url: "/api/calendar.ics",
        },
        {
          id: "download",
          name: "Download .ics files",
          stable: true,
          needs_auth: false,
          how: "Download the calendar, then drag the file into Outlook or your calendar app.",
          url: "/api/calendar/export.ics",
        },
        {
          id: "graph",
          name: "Microsoft Graph (Outlook / Microsoft 365)",
          stable: false,
          needs_auth: true,
          how: "Sign in with a Microsoft account that has Calendars.ReadWrite. Events are written straight into your calendar.",
        },
        {
          id: "caldav",
          name: "CalDAV (iCloud or a self-hosted server)",
          stable: false,
          needs_auth: true,
          how: "Give the server URL and a username and password. Works with iCloud and with any CalDAV server.",
        },
      ],
      note:
        "The subscribe and download paths need nothing but the URL. The push " +
        "paths are experimental: they need a token, and the token handling is not " +
        "finished.",
    })
  );

  // --- Push (experimental) ---------------------------------------------
  app.post("/api/calendar/push", async (c) => {
    let body: any = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const method = String(body.method || "");
    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];

    if (method !== "graph" && method !== "caldav") {
      return c.json(
        {
          error: "unsupported_method",
          message:
            "Only 'graph' and 'caldav' can push. 'subscribe' and 'download' need " +
            "no push: give the user the URL and the client does the rest.",
        },
        400
      );
    }

    const rows = ids.length
      ? sql
          .exec(
            "SELECT * FROM hackathons WHERE id IN (" +
              ids.map(() => "?").join(",") + ")",
            ...ids
          )
          .toArray()
      : openRows(sql);

    // The push itself needs a token the app does not have yet. Rather
    // than pretend, it says exactly what is missing.
    return c.json(
      {
        ok: false,
        experimental: true,
        method,
        would_push: rows.length,
        events: rows.map((r: any) => {
          const e = hackathonToIcal(r, "TaskMaster Pro");
          return e
            ? { uid: e.uid, summary: e.summary, dtstart: e.dtstart, dtend: e.dtend }
            : null;
        }),
        missing:
          method === "graph"
            ? "A Microsoft Graph access token with Calendars.ReadWrite. The OAuth " +
              "flow is not wired up yet: add it, then this returns the events to POST."
            : "CalDAV credentials (server URL, username, password) and a write-capable " +
              "account. The PUT is not wired up yet.",
      },
      501
    );
  });
}
