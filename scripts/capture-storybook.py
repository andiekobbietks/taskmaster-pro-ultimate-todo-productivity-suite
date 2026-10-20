"""Build the storybook bundle and capture a pixel sample of every component."""
import io
import json
import os
import subprocess
import sys
import time

LOCAL = r"C:\Users\Admin\AppData\Local\Temp\opencode\tp"
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
NPM = os.path.join(os.path.dirname(os.environ.get("APPDATA", "")), "npm", "npm.cmd")
css = os.path.join(LOCAL, "public", "assets", "app.css")
if not os.path.exists(css):
    subprocess.run([NPM, "run", "build:css"], cwd=LOCAL, capture_output=True)
print("css present:", os.path.exists(css))

# 3. Serve and screenshot
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

        for i in range(count):
            story = stories.nth(i)
            title = story.get_attribute("data-story")
            slug = (title or "story").lower().replace(" ", "-").replace("/", "-")
            out = os.path.join(SHOTS, f"{i+1:02d}-{slug}.png")
            story.screenshot(path=out)
            print(f"  captured: {title}")

        # Full page too
        page.screenshot(path=os.path.join(SHOTS, "00-full.png"), full_page=True)
        print("full page captured")
        browser.close()
finally:
    proc.terminate()

# 4. List what we got
print("\n=== captured ===")
for f in sorted(os.listdir(SHOTS)):
    print("  %s (%d bytes)" % (f, os.path.getsize(os.path.join(SHOTS, f))))
