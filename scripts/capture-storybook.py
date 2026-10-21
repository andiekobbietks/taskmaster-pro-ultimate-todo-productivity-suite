"""Build the storybook bundle and capture a pixel sample of every component."""
import io
import json
import os
import subprocess
import sys
import time

LOCAL = r"C:\Users\Admin\Documents\taskmaster-pro"
SHOTS = r"C:\Users\Admin\AppData\Local\Temp\opencode\storybook-shots"

# 1. Build the storybook bundle
ESBUILD = os.path.join(LOCAL, "node_modules", ".bin", "esbuild.cmd")
r = subprocess.run([
    ESBUILD, "src/storybook.jsx", "--bundle", "--minify",
    "--format=iife", "--target=es2019", "--jsx=automatic",
    "--loader:.jsx=jsx", "--outfile=public/assets/storybook.js",
], cwd=LOCAL, capture_output=True, text=True)
if r.returncode != 0:
    print("BUILD FAILED")
    print((r.stdout + r.stderr)[-2000:])
    sys.exit(1)
print("storybook bundle built")

# 2. Copy the app CSS (build:css output already exists)
NPM = r"C:\Program Files\nodejs\npm.cmd"
css = os.path.join(LOCAL, "public", "assets", "app.css")
if not os.path.exists(css):
    subprocess.run([NPM, "run", "build:css"], cwd=LOCAL, capture_output=True)
print("css present:", os.path.exists(css))

# 3. Serve and screenshot
# Clear the directory first: the filenames are numbered by story order, so a
# leftover file from an earlier run would keep a stale number.
import shutil
if os.path.isdir(SHOTS):
    shutil.rmtree(SHOTS)
os.makedirs(SHOTS, exist_ok=True)
PORT = "8821"
proc = subprocess.Popen(
    ["node", "scripts/mock-api.mjs", PORT],
    cwd=LOCAL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)
time.sleep(3)

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900},
                                device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/storybook.html",
                  wait_until="networkidle", timeout=20000)
        time.sleep(2)
        print("page errors:", errors[:3])

        stories = page.locator("[data-story]")
        count = stories.count()
        print("stories found:", count)

        # Some components (Banner, Modal) are position: fixed, so they float
        # over the viewport and would appear over whichever story is being
        # captured. Hide the fixed elements that belong to other stories, so
        # each sample shows only its own component.
        page.add_style_tag(content=(
            "[data-capture-hidden] { visibility: hidden !important; }"
        ))

        captured = 0
        for i in range(count):
            story = stories.nth(i)
            title = story.get_attribute("data-story")
            mode = story.get_attribute("data-capture")

            if mode == "skip":
                print(f"  skipped: {title}")
                continue

            captured += 1
            slug = (title or "story").lower().replace(" ", "-").replace("/", "-")
            out = os.path.join(SHOTS, f"{captured:02d}-{slug}.png")

            story.scroll_into_view_if_needed()
            story.evaluate("""(el) => {
                document.querySelectorAll("[data-capture-hidden]").forEach(
                    (n) => n.removeAttribute("data-capture-hidden"));
                document.querySelectorAll("body *").forEach((n) => {
                    if (el.contains(n) || n.contains(el)) return;
                    if (getComputedStyle(n).position === "fixed") {
                        n.setAttribute("data-capture-hidden", "1");
                    }
                });
            }""")

            # A story whose component covers the viewport (the modal) cannot be
            # sampled as an element — the crop would be the section, not the
            # component. Capture the viewport instead.
            if mode == "viewport":
                page.screenshot(path=out)
            else:
                story.screenshot(path=out)
            print(f"  captured: {title} [{mode or 'element'}]")

        # Full page too
        page.evaluate("""() => {
            document.querySelectorAll("[data-capture-hidden]").forEach(
                (n) => n.removeAttribute("data-capture-hidden"));
        }""")
        page.screenshot(path=os.path.join(SHOTS, "00-full.png"), full_page=True)
        print("full page captured")
        browser.close()
finally:
    proc.terminate()

# 4. Publish the samples into docs/samples, so the handbook always shows
#    pixels of the code that ships.
SAMPLES = os.path.join(LOCAL, "docs", "samples")
# Remove the previous set so a renamed or dropped story does not leave a
# stale sample behind.
if os.path.isdir(SAMPLES):
    for old in os.listdir(SAMPLES):
        if old.endswith(".png"):
            os.remove(os.path.join(SAMPLES, old))
os.makedirs(SAMPLES, exist_ok=True)
for f in sorted(os.listdir(SHOTS)):
    if not f.endswith(".png") or f == "00-full.png":
        continue
    src = os.path.join(SHOTS, f)
    dst = os.path.join(SAMPLES, f)
    with open(src, "rb") as a, open(dst, "wb") as b:
        b.write(a.read())
    print("  published: %s" % f)

# 5. List what we got
print("\n=== captured ===")
for f in sorted(os.listdir(SHOTS)):
    print("  %s (%d bytes)" % (f, os.path.getsize(os.path.join(SHOTS, f))))
