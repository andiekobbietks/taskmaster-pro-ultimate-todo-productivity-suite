"""Search Outlook and Yahoo inboxes for hackathon-related emails via IMAP.

Simpler than OAuth — just use app passwords.

Setup (one-time, 2 minutes each):

  Outlook (andiekobbietks@outlook.com):
    1. Go to: https://account.microsoft.com/security
    2. Click "Advanced security options"
    3. Under "App passwords", click "Create a new app password"
    4. Copy the generated password

  Yahoo (andre.enne@yahoo.com):
    1. Go to: https://login.yahoo.com/account/security
    2. Click "Generate app password"
    3. Select "Other app" and name it "taskmaster"
    4. Copy the generated password

Usage:
    python email_search_imap.py \
      --outlook-email andiekobbietks@outlook.com \
      --outlook-password <app-password> \
      --yahoo-email andre.enne@yahoo.com \
      --yahoo-password <app-password>

Output: hackathon_emails.json (importable into taskmaster-pro)
"""
import json
import os
import sys
import imaplib
import email as email_lib
from email.header import decode_header
from datetime import datetime, timedelta

try:
    import requests
except ImportError:
    pass  # Not needed for IMAP-only mode


# ── Hackathon detection ──────────────────────────────────────────────

HACKATHON_KEYWORDS = [
    "hackathon", "competition", "challenge", "deadline", "submission",
    "prize", "devpost", "mlh", "kaggle", "lablab", "ethglobal",
    "devfolio", "unstop", "hackerrank", "hackerearth", "hackday",
    "hackfest", "codeathon", "ideathon", "datathon",
]

HACKATHON_SENDERS = [
    "devpost", "mlh.io", "mlh.com", "kaggle.com", "lablab.ai",
    "ethglobal", "devfolio", "unstop.com", "hackerrank.com",
    "hackerearth.com", "hackathon", "challenge", "competition",
]

# How far back to search (days)
SEARCH_DAYS = 365


# ── Helpers ──────────────────────────────────────────────────────────

def decode_str(s):
    """Decode email header strings."""
    if not s:
        return ""
    parts = decode_header(s)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            result.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            result.append(part)
    return "".join(result)


def search_inbox(imap, source_label: str) -> list[dict]:
    """Search an IMAP inbox for hackathon-related emails."""
    results = []
    try:
        imap.select("INBOX")

        # Search by date (last N days) + keywords
        since_date = (datetime.now() - timedelta(days=SEARCH_DAYS)).strftime("%d-%b-%Y")
        search_criteria = f'(SINCE {since_date})'

        status, messages = imap.search(None, search_criteria)
        if status != "OK":
            print(f"  Search failed: {status}")
            return results

        msg_ids = messages[0].split()
        print(f"  Found {len(msg_ids)} emails since {since_date}, scanning...")

        for msg_id in msg_ids:
            try:
                status, msg_data = imap.fetch(msg_id, "(RFC822)")
                if status != "OK":
                    continue

                msg = email_lib.message_from_bytes(msg_data[0][1])
                sender = decode_str(msg.get("From", ""))
                subject = decode_str(msg.get("Subject", ""))
                date = msg.get("Date", "")
                body_preview = ""

                # Get body preview (first 500 chars of text)
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_type() == "text/plain":
                            try:
                                payload = part.get_payload(decode=True)
                                if payload:
                                    body_preview = payload.decode(
                                        part.get_content_charset() or "utf-8",
                                        errors="replace"
                                    )[:500]
                                    break
                            except Exception:
                                pass
                else:
                    try:
                        payload = msg.get_payload(decode=True)
                        if payload:
                            body_preview = payload.decode(
                                msg.get_content_charset() or "utf-8",
                                errors="replace"
                            )[:500]
                    except Exception:
                        pass

                # Check if hackathon-related
                combined = (sender + " " + subject + " " + body_preview).lower()
                is_platform = any(d in combined for d in HACKATHON_SENDERS)
                has_keyword = any(k in combined for k in HACKATHON_KEYWORDS)

                if is_platform or has_keyword:
                    # Check for attachments
                    has_attachments = False
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get("Content-Disposition", "").startswith("attachment"):
                                has_attachments = True
                                break

                    results.append({
                        "source": source_label,
                        "id": msg_id.decode(),
                        "sender": sender,
                        "subject": subject,
                        "received_at": date,
                        "body_preview": body_preview.strip(),
                        "has_attachments": has_attachments,
                        "is_platform": is_platform,
                    })
            except Exception as e:
                pass  # Skip problematic emails

    except Exception as e:
        print(f"  Error: {e}")

    return results


# ── Main ──────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Search Outlook and Yahoo for hackathon emails via IMAP")
    parser.add_argument("--outlook-email", help="Outlook email address")
    parser.add_argument("--outlook-password", help="Outlook app password")
    parser.add_argument("--yahoo-email", help="Yahoo email address")
    parser.add_argument("--yahoo-password", help="Yahoo app password")
    parser.add_argument("--output", default="hackathon_emails.json", help="Output file")
    args = parser.parse_args()

    all_results = []

    # Outlook
    if args.outlook_email and args.outlook_password:
        print("\n=== Searching Outlook (IMAP) ===")
        try:
            mail = imaplib.IMAP4_SSL("outlook.office365.com", 993)
            mail.login(args.outlook_email, args.outlook_password)
            results = search_inbox(mail, "outlook")
            print(f"  Found {len(results)} hackathon-related emails")
            all_results.extend(results)
            mail.logout()
        except Exception as e:
            print(f"  Outlook IMAP error: {e}")
            print("  Check: IMAP enabled? App password correct? 2FA enabled?")

    # Yahoo
    if args.yahoo_email and args.yahoo_password:
        print("\n=== Searching Yahoo (IMAP) ===")
        try:
            mail = imaplib.IMAP4_SSL("imap.mail.yahoo.com", 993)
            mail.login(args.yahoo_email, args.yahoo_password)
            results = search_inbox(mail, "yahoo")
            print(f"  Found {len(results)} hackathon-related emails")
            all_results.extend(results)
            mail.logout()
        except Exception as e:
            print(f"  Yahoo IMAP error: {e}")
            print("  Check: App password correct? 2FA enabled?")

    # Deduplicate
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

    # Summary by platform
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

    # Print recent emails
    print("\n=== Recent emails ===")
    for r in unique[:10]:
        print(f"  [{r['source']}] {r['received_at'][:16]} | {r['subject'][:60]}")
        print(f"    from: {r['sender'][:50]}")


if __name__ == "__main__":
    main()
