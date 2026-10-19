"""
screenshot_pipeline.py — auto-capture screenshots of competition pages
and upload them as attachments to taskmaster-pro tickets.

Usage:
    pip install playwright requests
    playwright install chromium
    python screenshot_pipeline.py --api http://localhost:8787

Config file (screenshots.json):
[
  {
    "ticket_id": "hack-1",
    "url": "https://devpost.com/hackathons/amazon-developer-hackathon",
    "name": "Amazon Developer Hackathon"
  },
  ...
]
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

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


def load_config(config_path: str) -> list[dict]:
    """Load screenshot configuration from JSON file."""
    path = Path(config_path)
    if not path.exists():
        print(f"ERROR: Config file not found: {config_path}")
        print("Create a screenshots.json file with:")
        print(json.dumps([{
            "ticket_id": "hack-1",
            "url": "https://example.com/hackathon",
            "name": "Example Hackathon"
        }], indent=2))
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


def take_screenshot(page, url: str, output_path: str) -> bool:
    """Navigate to URL and take a full-page screenshot."""
    try:
        page.goto(url, wait_until="networkidle", timeout=30000)
        time.sleep(2)  # Allow dynamic content to render
        page.screenshot(path=output_path, full_page=True)
        return True
    except Exception as e:
        print(f"  WARNING: Failed to screenshot {url}: {e}")
        return False


def upload_screenshot(api_base: str, ticket_id: str, filepath: str) -> bool:
    """Upload a screenshot to the taskmaster API as an attachment."""
    try:
        with open(filepath, "rb") as f:
            files = {"file": (os.path.basename(filepath), f, "image/png")}
            resp = requests.post(
                f"{api_base}/api/todos/{ticket_id}/attachments",
                files=files,
                timeout=30,
            )
        if resp.status_code == 201:
            return True
        else:
            print(f"  WARNING: Upload failed ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        print(f"  WARNING: Upload error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Screenshot pipeline for taskmaster-pro")
    parser.add_argument("--api", default="http://localhost:8787", help="Taskmaster API base URL")
    parser.add_argument("--config", default="screenshots.json", help="Path to screenshot config")
    parser.add_argument("--output-dir", default="screenshots", help="Directory to save screenshots")
    parser.add_argument("--dry-run", action="store_true", help="Take screenshots but don't upload")
    args = parser.parse_args()

    config = load_config(args.config)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True)

    print(f"Screenshot pipeline: {len(config)} pages to capture")
    print(f"API: {args.api}")
    print(f"Output: {output_dir}")
    print()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = context.new_page()

        success = 0
        failed = 0

        for item in config:
            ticket_id = item["ticket_id"]
            url = item["url"]
            name = item.get("name", ticket_id)

            print(f"[{ticket_id}] {name}")
            print(f"  URL: {url}")

            filename = f"{ticket_id.replace('/', '-')}.png"
            filepath = str(output_dir / filename)

            if take_screenshot(page, url, filepath):
                print(f"  Screenshot saved: {filepath}")

                if not args.dry_run:
                    if upload_screenshot(args.api, ticket_id, filepath):
                        print(f"  Uploaded to taskmaster")
                        success += 1
                    else:
                        failed += 1
                else:
                    success += 1
            else:
                failed += 1

            print()

        browser.close()

    print(f"Done: {success} succeeded, {failed} failed")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
