"""
Browser-level checks for the defects fixed in v1.3.0.

The API suite (scripts/test-bugfixes.mjs) covers the routes. This covers
the behaviour a person actually sees: the Add Hackathon form, the settings
screen, per-card screenshot upload, bulk selection in both lists, and the
app rendering with no network at all.

Run it against a live server:

    npm run storybook:serve      # or: node scripts/mock-api.mjs 8821
    python scripts/verify-ui.py

Exit code 0 means every check passed.
"""
import json
import os
import re
import sys
import tempfile
import time
import urllib.request

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright is required: pip install playwright")
    sys.exit(2)

BASE = os.environ.get("TM_BASE", "http://127.0.0.1:8821")


def shots_dir():
    """Where to write the screenshots.

    Defaults to the Documents folder on Windows, where the rest of the
    project's output lives. On a CI runner there is no such folder, so it
    falls back to a temporary directory — deliberately not docs/, because
    CI fails when anything under docs/ drifts from what is committed.
    """
    chosen = os.environ.get("TM_SHOTS")
    if chosen:
        path = chosen
    elif os.path.isdir(r"C:\Users\Admin\Documents"):
        path = r"C:\Users\Admin\Documents"
    else:
        path = os.path.join(tempfile.gettempdir(), "tm-screenshots")
    os.makedirs(path, exist_ok=True)
    return path


SHOTS = shots_dir()

passed = 0
failed = []


def api(method, path, body=None):
    """Call the app's own API. Returns the parsed body, or None."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as e:
        print("  api %s %s failed: %s" % (method, path, e))
        return None


def seed_emails():
    """Make sure the inbox has something to select.

    Returns (ids_for_the_checks, ids_to_delete).

    Against the live Worker the inbox starts empty, so two messages are
    posted and those two are deleted afterwards. Against the mock API it
    already carries a fixed set of four and ignores writes, so nothing is
    posted and the existing ones are used and left alone.

    Only what this function creates is ever deleted. If the inbox already
    had messages, they are used for the checks and kept.

    The ids are read back from the list rather than taken from the POST
    response, because the two servers return different shapes there.
    """
    listing = api("GET", "/api/inbox")
    existing = listing if isinstance(listing, list) else []

    subjects = ["Verification check: deadline extended",
                "Verification check: account please confirm"]
    created = []

    if not existing:
        for subject in subjects:
            api("POST", "/api/inbox", {
                "sender": "notifications@devpost.com",
                "subject": subject,
                "body_text": "This message was created by scripts/verify-ui.py.",
            })
        listing = api("GET", "/api/inbox")
        existing = listing if isinstance(listing, list) else []
        created = [e["id"] for e in existing
                   if isinstance(e, dict) and e.get("subject") in subjects
                   and e.get("id")]

    usable = [e["id"] for e in existing
              if isinstance(e, dict) and e.get("id")
              and (not subjects or e.get("subject") in subjects)]
    if not usable:
        usable = [e["id"] for e in existing
                  if isinstance(e, dict) and e.get("id")]

    return usable, created


def delete_emails(ids):
    for i in ids:
        api("DELETE", "/api/inbox/" + i)



def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("  PASS  %s%s" % (name, (" - " + detail) if detail else ""))
    else:
        failed.append(name)
        print("  FAIL  %s%s" % (name, (" - " + detail) if detail else ""))


def run(page, results):
    # ── The Today view must load its own data ──
    # fetchDigest, fetchCapacity and fetchWeeklyPlan were defined and never
    # called, so the view showed "Loading..." until you pressed Refresh.
    page.locator("button", has_text=re.compile(r"^\s*Today")).first.click()
    time.sleep(1.5)
    results.append(("the Today view loads its digest",
                    page.locator("text=Loading...").count() == 0))
    results.append(("the digest shows the available hours",
                    page.locator("text=Available:").count() > 0))
    results.append(("the weekly capacity grid renders",
                    page.locator("text=Weekly capacity").count() > 0))
    page.screenshot(path=os.path.join(SHOTS, "tm-today-digest.png"), full_page=True)

    page.click("text=Hackathons")
    time.sleep(1)
    print("--- Hackathons ---")
    page.get_by_role("button", name="Add Hackathon", exact=True).click()
    time.sleep(1)
    name_input = page.get_by_placeholder("Amazon Developer Hackathon")
    results.append(("Add Hackathon opens a form", name_input.count() > 0))
    results.append(("the form has its selects",
                    page.locator("form select").count() >= 3))
    results.append(("the form has its date fields",
                    page.locator("form input[type=date]").count() == 3))
    name_input.fill("UI Test Hackathon")
    page.get_by_role("button", name="Add hackathon", exact=True).click()
    time.sleep(1.5)
    results.append(("the form closes after submit", name_input.count() == 0))
    results.append(("each card has a screenshot upload",
                    page.locator("label[title='Attach a screenshot to this hackathon']").count() > 0))
    results.append(("each card has a selection checkbox",
                    page.locator("input[aria-label^='Select ']").count() > 0))
    page.get_by_text("Select all").click()
    time.sleep(1)
    results.append(("the bulk bar appears", page.locator("text=Mark open").count() > 0))
    page.screenshot(path=os.path.join(SHOTS, "tm-hackathons-bulk.png"), full_page=True)
    page.get_by_role("button", name="Clear", exact=True).click()
    time.sleep(0.5)
    results.append(("Clear empties the selection",
                    page.locator("text=Mark open").count() == 0))

    print("--- Settings ---")
    page.click("text=Settings")
    time.sleep(1.5)
    values = page.locator("input").evaluate_all(
        "els => els.map(e => e.value).filter(Boolean)")
    results.append(("the storage bucket is populated",
                    "taskmaster-pro-screenshots" in values))
    page.get_by_role("button", name="profile", exact=True).click()
    time.sleep(1)
    profile_values = page.locator("input").evaluate_all(
        "els => els.map(e => e.value).filter(Boolean)")
    results.append(("the profile is populated",
                    "IT" in profile_values and "GB" in profile_values))
    page.get_by_role("button", name="email", exact=True).click()
    time.sleep(1)
    email_values = page.locator("input").evaluate_all(
        "els => els.map(e => e.value).filter(Boolean)")
    results.append(("the email settings are populated",
                    "imap.mail.yahoo.com" in email_values))
    results.append(("the JMAP fields are present",
                    page.locator("input[placeholder='https://apidata.fastmail.com']").count() == 1))
    results.append(("the Fetch mail now button is present",
                    page.get_by_role("button", name="Fetch mail now", exact=True).count() == 1))
    results.append(("the Yahoo client id field is present",
                    page.get_by_placeholder("your Yahoo consumer key").count() == 1))
    results.append(("the Yahoo test button is present",
                    page.get_by_role("button", name="Test connection", exact=True).count() == 1))
    page.screenshot(path=os.path.join(SHOTS, "tm-settings-populated.png"), full_page=True)

    # The capture manifest tab.
    page.get_by_role("button", name="capture", exact=True).click()
    time.sleep(1.5)
    results.append(("the capture tab shows the manifest",
                    page.get_by_text("Capture manifest").count() > 0))
    results.append(("the capture tab can queue the manifest",
                    page.get_by_role("button", name="Queue the manifest", exact=True).count() == 1))
    results.append(("the capture tab shows the captures",
                    page.get_by_text("Captures", exact=True).count() > 0))
    page.screenshot(path=os.path.join(SHOTS, "tm-capture-manifest.png"), full_page=True)

    print("--- Inbox ---")
    page.click("text=Inbox")
    time.sleep(1.5)
    results.append(("each email has a selection checkbox",
                    page.locator("input[aria-label^='Select email']").count() > 0))
    page.locator("input[aria-label^='Select email']").first.click()
    time.sleep(1)
    results.append(("the bulk bar appears", page.locator("text=Mark processed").count() > 0))
    results.append(("ticking does not open the detail panel",
                    page.locator("button[aria-label='Close email']").count() == 0))
    page.screenshot(path=os.path.join(SHOTS, "tm-inbox-select.png"), full_page=True)
    page.locator("[role=button][aria-label^='Open email']").first.click()
    time.sleep(1.5)
    results.append(("clicking a row opens the detail panel",
                    page.locator("button[aria-label='Close email']").count() == 1))


def main():
    usable, created = seed_emails()
    print("inbox: %d message(s) available, %d created by this run"
          % (len(usable), len(created)))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=30000)
        time.sleep(3)

        results = []
        run(page, results)

        print("--- Offline ---")
        blocked = []

        def guard(route):
            if route.request.url.startswith(BASE):
                route.continue_()
            else:
                blocked.append(route.request.url)
                route.abort()

        page.route("**/*", guard)
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=20000)
        time.sleep(2)
        results.append(("the app renders with no network",
                        page.locator("text=Settings").count() > 0))
        results.append(("the font falls back to a system stack",
                        "system-ui" in page.evaluate(
                            "getComputedStyle(document.body).fontFamily")))
        page.screenshot(path=os.path.join(SHOTS, "tm-offline.png"), full_page=True)

        browser.close()

    delete_emails(created)

    print()
    for name, ok in results:
        check(name, ok)
    if errors:
        check("no runtime errors", False, "; ".join(errors[:2]))

    print("\n" + "=" * 58)
    print("RESULT: %d passed, %d failed" % (passed, len(failed)))
    for f in failed:
        print("  FAILED: " + f)
    print("=" * 58)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
