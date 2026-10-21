"""Strip a UTF-8 BOM from files that should not have one.

PowerShell's Set-Content -Encoding UTF8 writes a BOM, and a BOM in a
TypeScript or JavaScript source file is a trap: it is invisible in most
editors and breaks tooling that reads the file as UTF-8.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

targets = []
for base in ("src", "scripts", "public"):
    for dirpath, _dirnames, filenames in os.walk(os.path.join(ROOT, base)):
        for name in filenames:
            if name.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".html", ".css")):
                targets.append(os.path.join(dirpath, name))

fixed = []
for path in targets:
    with open(path, "rb") as f:
        data = f.read()
    if data.startswith(b"\xef\xbb\xbf"):
        with open(path, "wb") as f:
            f.write(data[3:])
        fixed.append(os.path.relpath(path, ROOT))

if fixed:
    print("BOM removed from:")
    for p in fixed:
        print("  " + p)
else:
    print("no BOMs found")
