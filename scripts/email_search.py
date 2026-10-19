"""Search Outlook and Yahoo inboxes for hackathon-related emails.

Prerequisites:
  1. Microsoft app registration: https://portal.azure.com → App registrations
     - Add redirect URI: http://localhost:8080/callback
     - API permissions: Mail.Read (delegated)
     - Copy Client ID and Client Secret
  2. Yahoo app registration: https://developer.yahoo.com/apps/create
     - Add redirect URI: http://localhost:8080/callback
     - Copy Client ID and Client Secret

Usage:
    python email_search.py --outlook-client-id <id> --outlook-client-secret <secret> --yahoo-client-id <id> --yahoo-client-secret <secret>

Output: hackathon_emails.json (importable into taskmaster-pro)
"""
import json
import os
import sys
import time
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, urlencode
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)


# ── Hackathon search terms ────────────────────────────────────────────

HACKATHON_KEYWORDS = [
    "hackathon", "competition", "challenge", "deadline", "submission",
    "prize", "devpost", "mlh", "kaggle", "lablab", "ethglobal",
    "devfolio", "unstop", "hackerrank", "hackerearth",
]

HACKATHON_SENDERS = [
    "devpost.com", "mlh.io", "mlh.com", "kaggle.com", "lablab.ai",
    "ethglobal.com", "devfolio.co", "unstop.com", "hackerrank.com",
    "hackerearth.com", "hackathon", "challenge",
]

# ── OAuth callback server ─────────────────────────────────────────────

class CallbackHandler(BaseHTTPRequestHandler):
    """Handle OAuth callback and capture the authorization code."""
    code = None
    state = None

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        CallbackHandler.code = params.get("code", [None])[0]
        CallbackHandler.state = params.get("state", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>Authorization successful. You can close this window.</h1>")

    def log_message(self, format, *args):
        pass  # Suppress logs


def get_auth_code(auth_url: str, state: str) -> str:
    """Open browser for OAuth and wait for callback."""
    webbrowser.open(auth_url)
    server = HTTPServer(("localhost", 8080), CallbackHandler)
    CallbackHandler.code = None
    CallbackHandler.state = None
    while CallbackHandler.code is None:
        server.handle_one_request()
    server.server_close()
    return CallbackHandler.code


# ── Microsoft Graph (Outlook) ─────────────────────────────────────────

MS_SCOPES = ["Mail.Read", "User.Read"]
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"

# Search queries for Microsoft Graph
MS_SEARCH_QUERIES = [
    'from:devpost.com',
    'from:mlh.io',
    'from:kaggle.com',
    'from:lablab.ai',
    'from:ethglobal.com',
    'subject:hackathon',
    'subject:competition',
    'subject:challenge',
    'subject:deadline',
    'subject:submission',
]


def auth_outlook(client_id: str, client_secret: str) -> str:
    """Authenticate with Microsoft Graph and return access token."""
    auth_url = MS_AUTH_URL + "?" + urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": "http://localhost:8080/callback",
        "scope": " ".join(MS_SCOPES),
        "state": "outlook",
    })
    print("Opening browser for Outlook authorization...")
    code = get_auth_code(auth_url, "outlook")

    resp = requests.post(MS_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": "http://localhost:8080/callback",
        "grant_type": "authorization_code",
    })
    resp.raise_for_status()
    return resp.json()["access_token"]


def search_outlook(access_token: str) -> list[dict]:
    """Search Outlook inbox for hackathon-related emails."""
    headers = {"Authorization": f"Bearer {access_token}"}
    results = []

    # Build a single search query combining all keywords
    search_query = " OR ".join(f'"{k}"' for k in HACKATHON_KEYWORDS[:5])
    url = "https://graph.microsoft.com/v1.0/me/messages"

    # Search with $search parameter
    params = {
        "$search": '"hackathon" OR "competition" OR "challenge" OR "deadline"',
        "$select": "id,subject,from,receivedDateTime,body,hasAttachments,webLink",
        "$top": 50,
        "$orderby": "receivedDateTime desc",
    }

    resp = requests.get(url, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    for msg in data.get("value", []):
        sender = msg.get("from", {}).get("emailAddress", {}).get("address", "")
        subject = msg.get("subject", "")
        body = msg.get("body", {}).get("content", "")
        received = msg.get("receivedDateTime", "")

        # Check if sender is a known hackathon platform
        is_platform = any(d in sender.lower() for d in HACKATHON_SENDERS)
        # Check if subject contains hackathon keywords
        has_keyword = any(k in (subject + " " + body[:500]).lower() for k in HACKATHON_KEYWORDS)

        if is_platform or has_keyword:
            results.append({
                "source": "outlook",
                "id": msg.get("id"),
                "sender": sender,
                "subject": subject,
                "received_at": received,
                "body_preview": body[:500],
                "has_attachments": msg.get("hasAttachments", False),
                "web_link": msg.get("webLink"),
                "is_platform": is_platform,
            })

    return results


# ── Yahoo Mail ────────────────────────────────────────────────────────

YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
YAHOO_AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"

# Yahoo Mail API (via IMAP is more reliable, but let's try the REST API first)
YAHOO_MAIL_URL = "https://mail.yahooapis.com/v2/messages"


def auth_yahoo(client_id: str, client_secret: str) -> str:
    """Authenticate with Yahoo and return access token."""
    auth_url = YAHOO_AUTH_URL + "?" + urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": "http://localhost:8080/callback",
        "scope": "mail-r",
        "state": "yahoo",
    })
    print("Opening browser for Yahoo authorization...")
    code = get_auth_code(auth_url, "yahoo")

    resp = requests.post(YAHOO_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": "http://localhost:8080/callback",
        "grant_type": "authorization_code",
    })
    resp.raise_for_status()
    return resp.json()["access_token"]


def search_yahoo(access_token: str) -> list[dict]:
    """Search Yahoo inbox for hackathon-related emails."""
    headers = {"Authorization": f"Bearer {access_token}"}
    results = []

    # Yahoo Mail API v2
    url = "https://mail.yahooapis.com/v2/messages"
    params = {
        "q": "hackathon OR competition OR challenge OR deadline",
        "fields": "id,subject,from,date,snippet,hasAttachments",
        "count": 50,
    }

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        for msg in data.get("messages", []):
            sender = msg.get("from", {}).get("email", "")
            subject = msg.get("subject", "")

            is_platform = any(d in sender.lower() for d in HACKATHON_SENDERS)
            has_keyword = any(k in (subject + " " + msg.get("snippet", "")).lower() for k in HACKATHON_KEYWORDS)

            if is_platform or has_keyword:
                results.append({
                    "source": "yahoo",
                    "id": msg.get("id"),
                    "sender": sender,
                    "subject": subject,
                    "received_at": msg.get("date"),
                    "body_preview": msg.get("snippet", ""),
                    "has_attachments": msg.get("hasAttachments", False),
                    "is_platform": is_platform,
                })
    except Exception as e:
        print(f"Yahoo API error: {e}")
        print("Note: Yahoo Mail API may require different authentication or endpoints.")
        print("Alternative: use IMAP to access Yahoo Mail.")

    return results


# ── IMAP fallback for Yahoo ───────────────────────────────────────────

def search_yahoo_imap(email: str, password: str) -> list[dict]:
    """Search Yahoo inbox via IMAP (fallback if REST API fails)."""
    import imaplib
    import email as email_lib
    from email.header import decode_header

    results = []
    try:
        mail = imaplib.IMAP4_SSL("imap.mail.yahoo.com", 993)
        mail.login(email, password)
        mail.select("INBOX")

        # Search for hackathon-related emails
        for keyword in ["hackathon", "competition", "challenge", "deadline"]:
            status, messages = mail.search(None, f'SUBJECT "{keyword}"')
            if status == "OK":
                for msg_id in messages[0].split():
                    status, msg_data = mail.fetch(msg_id, "(RFC822)")
                    if status == "OK":
                        msg = email_lib.message_from_bytes(msg_data[0][1])
                        sender = msg.get("From", "")
                        subject = msg.get("Subject", "")
                        date = msg.get("Date", "")

                        # Decode subject
                        decoded_parts = decode_header(subject)
                        subject = "".join(
                            part.decode(enc or "utf-8") if isinstance(part, bytes) else part
                            for part, enc in decoded_parts
                        )

                        is_platform = any(d in sender.lower() for d in HACKATHON_SENDERS)

                        results.append({
                            "source": "yahoo-imap",
                            "id": msg_id.decode(),
                            "sender": sender,
                            "subject": subject,
                            "received_at": date,
                            "body_preview": "",
                            "has_attachments": msg.is_multipart(),
                            "is_platform": is_platform,
                        })

        mail.close()
        mail.logout()
    except Exception as e:
        print(f"Yahoo IMAP error: {e}")

    return results


# ── Main ──────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Search Outlook and Yahoo for hackathon emails")
    parser.add_argument("--outlook-client-id", help="Microsoft app client ID")
    parser.add_argument("--outlook-client-secret", help="Microsoft app client secret")
    parser.add_argument("--yahoo-client-id", help="Yahoo app client ID")
    parser.add_argument("--yahoo-client-secret", help="Yahoo app client secret")
    parser.add_argument("--yahoo-email", help="Yahoo email address (for IMAP fallback)")
    parser.add_argument("--yahoo-password", help="Yahoo app password (for IMAP fallback)")
    parser.add_argument("--output", default="hackathon_emails.json", help="Output file")
    args = parser.parse_args()

    all_results = []

    # Outlook
    if args.outlook_client_id and args.outlook_client_secret:
        print("\n=== Searching Outlook ===")
        try:
            token = auth_outlook(args.outlook_client_id, args.outlook_client_secret)
            results = search_outlook(token)
            print(f"Found {len(results)} hackathon-related emails in Outlook")
            all_results.extend(results)
        except Exception as e:
            print(f"Outlook error: {e}")

    # Yahoo (REST API)
    if args.yahoo_client_id and args.yahoo_client_secret:
        print("\n=== Searching Yahoo (REST API) ===")
        try:
            token = auth_yahoo(args.yahoo_client_id, args.yahoo_client_secret)
            results = search_yahoo(token)
            print(f"Found {len(results)} hackathon-related emails in Yahoo")
            all_results.extend(results)
        except Exception as e:
            print(f"Yahoo REST API error: {e}")
            print("Trying IMAP fallback...")

    # Yahoo (IMAP fallback)
    if args.yahoo_email and args.yahoo_password:
        print("\n=== Searching Yahoo (IMAP) ===")
        results = search_yahoo_imap(args.yahoo_email, args.yahoo_password)
        print(f"Found {len(results)} hackathon-related emails in Yahoo via IMAP")
        all_results.extend(results)

    # Deduplicate by (source, id)
    seen = set()
    unique = []
    for r in all_results:
        key = (r["source"], r["id"])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    # Sort by received_at descending
    unique.sort(key=lambda x: x.get("received_at", ""), reverse=True)

    # Write output
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(unique, f, indent=2, ensure_ascii=False)

    print(f"\nTotal: {len(unique)} unique hackathon emails found")
    print(f"Output written to: {args.output}")

    # Print summary
    print("\n=== Summary ===")
    platforms = {}
    for r in unique:
        sender = r["sender"].lower()
        platform = "unknown"
        for d in HACKATHON_SENDERS:
            if d in sender:
                platform = d
                break
        platforms[platform] = platforms.get(platform, 0) + 1

    for platform, count in sorted(platforms.items(), key=lambda x: -x[1]):
        print(f"  {platform}: {count}")


if __name__ == "__main__":
    main()
