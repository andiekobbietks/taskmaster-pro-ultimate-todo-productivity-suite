"""
capture-wacz.py — record a competition page as a WACZ archive, and post it
to taskmaster-pro.

A screenshot is a picture of the rendered page. A WACZ is the traffic that
produced it: every request and every response, as the raw bytes, with the
page list and a CDX index beside them. The API calls that drove the page
are in there, and with them the state machine — which is what the
compiler pipeline needs.

Nothing here depends on the Wayback Machine.

Usage:
    python scripts/capture-wacz.py --api http://localhost:8787
    python scripts/capture-wacz.py --url https://example.com --name "Example"

Config file (captures.json), same shape as screenshots.json:
    [
      {
        "ticket_id": "hack-1",
        "url": "https://devpost.com/hackathons/amazon-developer-hackathon",
        "name": "Amazon Developer Hackathon"
      }
    ]

The archive is written to disk and then posted to POST /api/archive/wacz.
"""
import argparse
import gzip
import io
import json
import os
import sys
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

# The content types worth keeping. A capture is mostly HTML, CSS, JS and
# JSON; the rest is noise that bloats the archive.
KEEP_TYPES = (
    "text/html", "text/css", "text/javascript", "application/javascript",
    "application/json", "text/plain", "image/svg+xml", "image/png",
    "image/jpeg", "image/gif", "image/webp", "font/woff", "font/woff2",
    "application/xhtml+xml", "text/xml", "application/xml",
)


def load_config(path: str) -> list:
    p = Path(path)
    if not p.exists():
        print("ERROR: Config file not found: %s" % path)
        print("Create it with:")
        print(json.dumps([{
            "ticket_id": "hack-1",
            "url": "https://example.com/hackathon",
            "name": "Example Hackathon",
        }], indent=2))
        sys.exit(1)
    with open(p) as f:
        return json.load(f)


# ── WARC ──────────────────────────────────────────────────────────────

def warc_header(warc_type: str, url: str, content_length: int,
                 http_headers: dict) -> bytes:
    """The WARC record header for one record."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "WARC/1.0",
        "WARC-Type: %s" % warc_type,
        "WARC-Date: %s" % now,
        "WARC-Record-ID: <urn:uuid:%s>" % uuid.uuid4(),
        "WARC-Target-URI: %s" % url,
        "Content-Type: application/http; msgtype=response",
        "Content-Length: %d" % content_length,
    ]
    if http_headers.get("content-type"):
        lines.append("WARC-Identified-Payload-Type: %s"
                     % http_headers["content-type"].split(";")[0].strip())
    return ("\r\n".join(lines) + "\r\n\r\n").encode("utf-8")


def http_response_bytes(status: int, status_text: str, headers: dict,
                        body: bytes) -> bytes:
    """Reconstruct the raw HTTP response."""
    reason = status_text or ""
    head = ["HTTP/1.1 %d %s" % (status, reason)]
    seen = set()
    for k, v in headers.items():
        # Playwright lower-cases the header names. Restore the usual
        # capitalisation, which is what the server sent.
        name = "-".join(p.capitalize() for p in k.split("-"))
        seen.add(name.lower())
        head.append("%s: %s" % (name, v))
    if "content-length" not in seen and body is not None:
        head.append("Content-Length: %d" % len(body))
    return ("\r\n".join(head) + "\r\n\r\n").encode("utf-8") + (body or b"")


def build_warc(records: list) -> bytes:
    """Assemble the WARC bytes from the captured responses."""
    out = io.BytesIO()
    for r in records:
        payload = http_response_bytes(
            r["status"], r.get("status_text", ""), r["headers"], r["body"])
        out.write(warc_header(
            "response", r["url"], len(payload), r["headers"]))
        out.write(payload)
        out.write(b"\r\n\r\n")
    return out.getvalue()


# ── WACZ ──────────────────────────────────────────────────────────────

def build_wacz(warc: bytes, pages: list, title: str) -> bytes:
    """Package the WARC, the page list and the description as a WACZ.

    The layout is the Webrecorder specification 1.1.1.
    """
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("archive/data.warc.gz", gzip.compress(warc))
        z.writestr("pages/pages.jsonl",
                   "".join(json.dumps(p) + "\n" for p in pages))

        # The CDX index, in the CDXJ form the spec uses.
        cdx = []
        for p in pages:
            cdx.append(json.dumps({
                "url": p["url"],
                "mime": p.get("mimeType", "text/html"),
                "status": str(p.get("status", "200")),
                "timestamp": p.get("timestamp", ""),
            }))
        z.writestr("indexes/index.cdx.gz", gzip.compress(
            ("\n".join(cdx) + "\n").encode("utf-8")))

        import hashlib
        package = {
            "profile": "wacz",
            "title": title,
            "description": "Captured for the taskmaster-pro archive.",
            "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "software": "taskmaster-pro/scripts/capture-wacz.py",
        }
        package_bytes = json.dumps(package, indent=2).encode("utf-8")
        z.writestr("datapackage.json", package_bytes)
        z.writestr("datapackage-digest.json", json.dumps({
            "path": "datapackage.json",
            "hash": "sha256:" + hashlib.sha256(package_bytes).hexdigest(),
        }))
    return out.getvalue()


# ── Capture ───────────────────────────────────────────────────────────

def capture(page, url: str, settle: float, allow_external: bool) -> dict:
    """Load a page and record every response it makes.

    By default only same-origin responses are recorded. A capture of a
    competition page should hold that page and its assets, not the
    analytics and font hosts it happened to call. It also makes the
    capture hermetic, which is what CI needs.
    """
    recorded: list = []
    host = urlsplit(url).netloc

    def on_response(response):
        try:
            if not allow_external:
                if urlsplit(response.url).netloc != host:
                    return
            ctype = (response.headers or {}).get("content-type", "")
            base = ctype.split(";")[0].strip().lower()
            if base and not any(base.startswith(k) for k in KEEP_TYPES):
                return
            body = response.body()
        except Exception:
            # A body that cannot be read (a redirect, an aborted request)
            # is not worth recording.
            return
        recorded.append({
            "url": response.url,
            "status": response.status,
            "status_text": response.status_text,
            "headers": dict(response.all_headers()),
            "body": body,
        })

    page.on("response", on_response)
    try:
        page.goto(url, wait_until="networkidle", timeout=45000)
    except Exception as e:
        print("  WARNING: %s did not reach networkidle (%s)" % (url, e))
        try:
            page.wait_for_timeout(3000)
        except Exception:
            pass
    time.sleep(settle)
    page.remove_listener("response", on_response)
    return {"responses": recorded}


def pages_from(recorded: list, url: str, title: str) -> list:
    """The page list, one line per captured page."""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pages = []
    seen = set()
    for r in recorded:
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        pages.append({
            "id": "page-%d" % (len(pages) + 1),
            "url": r["url"],
            "title": title if r["url"] == url else r["url"],
            "timestamp": stamp,
            "mimeType": r["headers"].get("content-type", "text/html").split(";")[0],
            "status": str(r["status"]),
        })
    return pages


def post_wacz(api_base: str, wacz: bytes, url: str, job_id: str = "") -> tuple:
    """Send the archive to the app."""
    headers = {
        "Content-Type": "application/octet-stream",
        "X-Target-Url": url,
    }
    if job_id:
        # With a job id the app closes the job and creates the competition.
        headers["X-Job-Id"] = job_id
    try:
        resp = requests.post(
            api_base + "/api/archive/wacz",
            data=wacz,
            headers=headers,
            timeout=120,
        )
        return resp.status_code, resp.text
    except Exception as e:
        return 0, str(e)


def queued_jobs(api_base: str, limit: int) -> list:
    """The capture jobs the app is holding, waiting to be done."""
    try:
        resp = requests.get(api_base + "/api/capture/queue?limit=%d" % limit,
                            timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else []
    except Exception as e:
        print("  WARNING: could not read the queue: %s" % e)
        return []


def main():
    parser = argparse.ArgumentParser(
        description="Capture competition pages as WACZ archives")
    parser.add_argument("--api", default="http://localhost:8787",
                        help="TaskMaster API base URL")
    parser.add_argument("--config", default="captures.json",
                        help="Path to the capture config")
    parser.add_argument("--output-dir", default="captures",
                        help="Directory to write the archives into")
    parser.add_argument("--from-app", action="store_true",
                        help="Take the work from the app's capture queue, so "
                             "there is no configuration file to keep in step")
    parser.add_argument("--url", default=None,
                        help="Capture one URL instead of a config file")
    parser.add_argument("--name", default="Capture",
                        help="Name for a single capture")
    parser.add_argument("--settle", type=float, default=2.0,
                        help="Seconds to wait after the page settles")
    parser.add_argument("--allow-external", action="store_true",
                        help="Record third-party responses too, not just the "
                             "page's own origin")
    parser.add_argument("--dry-run", action="store_true",
                        help="Write the archive but do not post it")
    args = parser.parse_args()

    if args.from_app:
        # The app holds the manifest. Ask it what it wants done.
        queued = queued_jobs(args.api, 50)
        jobs = [{"ticket_id": None, "url": j["source_url"],
                 "name": j.get("name") or j["source_url"],
                 "job_id": j["id"]} for j in queued]
        if not jobs:
            print("The app has nothing queued. Add pages to the capture "
                  "manifest in Settings, then queue them.")
            sys.exit(0)
        print("The app asked for %d capture(s)." % len(jobs))
    elif args.url:
        jobs = [{"ticket_id": None, "url": args.url, "name": args.name}]
    else:
        jobs = load_config(args.config)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        for job in jobs:
            url = job["url"]
            name = job.get("name") or url
            print("Capturing %s" % url)

            result = capture(page, url, args.settle, args.allow_external)
            recorded = result["responses"]
            if not recorded:
                print("  WARNING: nothing was recorded")
                failures += 1
                continue

            warc = build_warc(recorded)
            pages = pages_from(recorded, url, name)
            wacz = build_wacz(warc, pages, name)

            safe = "".join(c if c.isalnum() or c in "-_" else "-"
                           for c in name)[:60].strip("-") or "capture"
            path = out_dir / (safe + ".wacz")
            with open(path, "wb") as f:
                f.write(wacz)

            total = sum(len(r["body"]) for r in recorded)
            print("  %d responses, %d bytes of body, archive %d bytes -> %s"
                  % (len(recorded), total, len(wacz), path))

            if args.dry_run:
                continue

            code, text = post_wacz(args.api, wacz, url, job.get("job_id", ""))
            if code == 200:
                try:
                    got = json.loads(text)
                    extracted = got.get("extracted", {})
                    print("  posted: %d pages, deadline=%s prize=%s"
                          % (got.get("pages_captured", 0),
                             extracted.get("deadline", "-"),
                             extracted.get("prize", "-")))
                except Exception:
                    print("  posted: HTTP %d" % code)
            else:
                print("  WARNING: post failed (HTTP %s): %s" % (code, text[:160]))
                failures += 1

        browser.close()

    print()
    print("Done. %d capture(s), %d failure(s)." % (len(jobs), failures))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
