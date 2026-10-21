"""
Make the app icons, from the mark the app already draws.

The header mark is a rounded square in brand-600 with a white check in a
box: `w-8 h-8 rounded-lg bg-brand-600` holding lucide's CheckSquare. The
icons are that same mark, drawn at each size the platforms ask for.

Pillow has no anti-aliasing, so everything is drawn at 8x and reduced.

Run:  python scripts/make-icons.py
"""
import os
from PIL import Image, ImageDraw

# The colours the app uses: brand-600 from tailwind.config.cjs, and the
# page background from the body class in public/index.html.
BRAND = (94, 106, 210, 255)      # #5E6AD2
PAGE = (248, 250, 252, 255)      # #F8FAFC
SS = 8                           # supersample factor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets")

# lucide's check-square, in a 24x24 box, as a stroke path.
# The box: M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11
# The tick: M9 11l3 3L22 4
BOX = [(21, 12), (21, 19), (19, 21), (5, 21), (3, 19), (3, 5), (5, 3), (16, 3)]
TICK = [(9, 11), (12, 14), (22, 4)]


def draw_mark(size, radius_ratio=0.25, padding_ratio=0.1875):
    """The brand square with the white check, at `size` pixels.

    The padding matches the app: the header draws a 20px glyph in a 32px
    square, so the mark is 62.5% of the square, centred.
    """
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = s * radius_ratio
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BRAND)

    # The glyph, in a 24-unit box mapped into the square with padding.
    pad = s * padding_ratio
    inner = s - pad * 2
    unit = inner / 24.0
    stroke = max(2, int(s * 0.085))

    def pts(path):
        return [(pad + x * unit, pad + y * unit) for (x, y) in path]

    d.line(pts(BOX) + [pts(BOX)[0]], fill=(255, 255, 255, 255),
           width=stroke, joint="curve")
    d.line(pts(TICK), fill=(255, 255, 255, 255), width=stroke, joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def draw_maskable(size):
    """A maskable icon: full bleed, with the mark inside the safe zone.

    The safe zone is the middle 80% of the square, so the glyph is
    drawn inside the middle 60% and the colour goes edge to edge.
    """
    s = size * SS
    img = Image.new("RGBA", (s, s), BRAND)
    d = ImageDraw.Draw(img)
    inset = s * 0.20
    unit = (s - inset * 2) / 24.0
    stroke = max(2, int(s * 0.075))

    def pts(path):
        return [(inset + x * unit, inset + y * unit) for (x, y) in path]

    d.line(pts(BOX) + [pts(BOX)[0]], fill=(255, 255, 255, 255),
           width=stroke, joint="curve")
    d.line(pts(TICK), fill=(255, 255, 255, 255), width=stroke, joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def write(img, name):
    path = os.path.join(OUT, name)
    img.save(path, "PNG", optimize=True)
    return path, os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []

    # The sizes the manifest and the platforms ask for.
    for size in (192, 512):
        p, n = write(draw_mark(size), f"icon-{size}.png")
        made.append((p, n))
    p, n = write(draw_maskable(512), "icon-512-maskable.png")
    made.append((p, n))

    # iOS puts this on the Home Screen. iOS does not round it: it masks
    # the icon itself, so the square has to be square.
    p, n = write(draw_mark(180, radius_ratio=0.0, padding_ratio=0.16),
                 "apple-touch-icon.png")
    made.append((p, n))

    # The browser tab.
    for size in (32, 16):
        p, n = write(draw_mark(size), f"favicon-{size}.png")
        made.append((p, n))

    # A larger square for anyone who wants the mark as a file.
    p, n = write(draw_mark(1024), "icon-1024.png")
    made.append((p, n))

    for path, size in made:
        print(f"  {os.path.basename(path):<28} {size:>7,} bytes")


if __name__ == "__main__":
    print("Icons written to", OUT)
    main()
