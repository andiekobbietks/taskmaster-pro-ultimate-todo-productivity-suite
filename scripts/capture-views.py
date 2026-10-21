"""
Capture the app's views as pixel samples.

The handbook documents 11 components. It does not document the screens a
product manager or a designer actually looks at: Today, Hackathons, Inbox
and Settings. Those are the views the product is judged on.

These are captured from the running app, not from the component library,
because a view is a composition — a component sample cannot show how the
parts sit together.

Usage:
    python scripts/capture-views.py

Writes docs/samples/views/*.png at two times resolution.
"""
import io
import os
import re
import subprocess
import sys
import time

LOCAL = r"C:\Users\Admin\Documents\taskmaster-pro"
SHOTS = r"C:\Users\Admin\AppData\Local\Temp\opencode\view-shots"
OUT = os.path.join(LOCAL, "docs", "samples", "views")
PORT = "8822"

# npx is not on PATH for a child process on Windows, so it is named outright.
NPX = r"C:\Program Files\nodejs\npx.cmd"

# The views worth showing, in the order a person meets them.
# (slug, nav label, the heading the view must show, what the view is for)
VIEWS = [
    ("today", "Today", "Today's Digest",
     "What the app is for: one screen that answers 'what should I do today'."),
    ("hackathons", "Hackathons", "Hackathon Tracker",
     "Every competition being tracked, with its deadline, prize and eligibility verdict."),
    ("inbox", "Inbox", "Inbox",
     "The mail that arrives from the competitions, matched to the competition they belong to."),
    ("settings", "Settings", "Settings",
     "Profile, notifications, mail configuration and the storage backend, in four tabs."),
]

print("building the front end")
r = subprocess.run(
    [NPX, "esbuild", "src/app.jsx", "--bundle", "--minify", "--format=iife",
     "--target=es2019", "--jsx=automatic", "--loader:.jsx=jsx",
     "--outfile=public/assets/app.js"],
    cwd=LOCAL, capture_output=True, text=True)
if r.returncode != 0:
    print("BUILD FAILED")
    print((r.stdout + r.stderr)[-2000:])
    sys.exit(1)

css = os.path.join(LOCAL, "public", "assets", "app.css")
if not os.path.exists(css):
    subprocess.run(["npm", "run", "build:css"], cwd=LOCAL, capture_output=True)

if os.path.isdir(SHOTS):
    import shutil
    shutil.rmtree(SHOTS)
os.makedirs(SHOTS, exist_ok=True)

print("starting the mock API on", PORT)
proc = subprocess.Popen(["node", "scripts/mock-api.mjs", PORT], cwd=LOCAL,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
time.sleep(3)

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960},
                                device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://127.0.0.1:%s/" % PORT, wait_until="domcontentloaded",
                  timeout=30000)
        time.sleep(3)
        print("page errors:", errors[:3])

        for slug, label, heading, _ in VIEWS:
            # The nav button carries a count badge, so its accessible name is
            # "Hackathons 7" rather than "Hackathons". And "Due Today" sits
            # above "Today" in the DOM, so a plain text match would pick the
            # wrong one. Anchor on the start of the text.
            page.locator("button", has_text=re.compile(r"^\s*%s" % label)).first.click()
            time.sleep(2)

            # Check the right view actually opened, rather than trusting the
            # click to have landed.
            found = page.locator("h1, h2").filter(has_text=heading).count()
            if found == 0:
                print("  WARNING: %s did not show the heading %r" % (label, heading))
            else:
                print("  %-12s -> heading %r" % (label, heading))

            # Hide the floating error banner if one is showing, so it does
            # not cover the view it is meant to illustrate.
            page.evaluate("""() => {
                document.querySelectorAll('[role=alert]').forEach((n) => {
                    n.style.visibility = 'hidden';
                });
            }""")
            time.sleep(0.3)

            out = os.path.join(SHOTS, "%s.png" % slug)

            # Capture the view itself, not the whole window. The sidebar is
            # the same on every screen, and in a document page it takes a
            # third of the width and shrinks the part that matters.
            main = page.locator("main")
            if main.count() > 0:
                # The view is its own scroll container. Take it from the
                # top, or the sticky header sits over the first row.
                main.evaluate("el => el.scrollTop = 0")
                time.sleep(0.4)
                main.screenshot(path=out)
            else:
                page.screenshot(path=out, full_page=True)
            print("  captured: %s" % label)
        browser.close()
finally:
    proc.terminate()

# Publish into docs/samples/views.
if os.path.isdir(OUT):
    for old in os.listdir(OUT):
        if old.endswith(".png"):
            os.remove(os.path.join(OUT, old))
else:
    os.makedirs(OUT, exist_ok=True)


def crop_to_content(path, padding=24):
    """Cut the empty space off the bottom of a view sample.

    The main element is always a full viewport tall, so a short view leaves
    a large blank area. In a document that reads as a mistake.
    """
    from PIL import Image
    img = Image.open(path).convert("RGB")
    w, h = img.size
    # The background is the page colour, so find the last row that differs
    # from the top-left pixel.
    bg = img.getpixel((2, 2))
    last = 0
    for y in range(h - 1, -1, -1):
        row = [img.getpixel((x, y)) for x in range(0, w, 8)]
        if any(abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 12 for p in row):
            last = y
            break
    cut = min(h, last + padding)
    if cut < h - 8:
        img.crop((0, 0, w, cut)).save(path)
        return h, cut
    return h, h


print()
print("=== published ===")
for f in sorted(os.listdir(SHOTS)):
    if f.endswith(".png"):
        src = os.path.join(SHOTS, f)
        before, after = crop_to_content(src)
        with open(src, "rb") as a, open(os.path.join(OUT, f), "wb") as b:
            b.write(a.read())
        print("  docs/samples/views/%s (%d bytes, cropped %d -> %d px)"
              % (f, os.path.getsize(os.path.join(OUT, f)), before, after))
