#!/usr/bin/env python3
"""Independent reader: does ink reach the page edge? (ENGINE.md §5)

Renders a PDF page with poppler's pdftoppm, then samples pixels near all four
edges with Pillow. NOT part of Folio or Gutterpress — verification only, same
spirit as spikes/pdfprobe.py (poppler backend), scoped to this fixture set
because neither existing probe script samples pixels.

Usage: edge-ink.py <pdf> <page 1-based> [dpi]
Prints JSON: { top, bottom, left, right, corner } -> "#rrggbb" sampled 2px
inside each edge, at the midpoint of that edge.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image


def main():
    pdf, page, dpi = sys.argv[1], int(sys.argv[2]), (sys.argv[3] if len(sys.argv) > 3 else "72")
    with tempfile.TemporaryDirectory() as tmp:
        prefix = os.path.join(tmp, "p")
        subprocess.run(
            ["pdftoppm", "-png", "-r", dpi, "-f", str(page), "-l", str(page), pdf, prefix],
            check=True,
            capture_output=True,
        )
        files = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
        if not files:
            raise SystemExit(f"pdftoppm produced no output for page {page}")
        img = Image.open(os.path.join(tmp, files[0])).convert("RGB")
        w, h = img.size
        inset = 2

        def hexpx(x, y):
            x = max(0, min(w - 1, x))
            y = max(0, min(h - 1, y))
            return "#%02x%02x%02x" % img.getpixel((x, y))

        print(
            json.dumps(
                {
                    "width": w,
                    "height": h,
                    "top": hexpx(w // 2, inset),
                    "bottom": hexpx(w // 2, h - 1 - inset),
                    "left": hexpx(inset, h // 2),
                    "right": hexpx(w - 1 - inset, h // 2),
                    "corner": hexpx(inset, inset),
                    "center": hexpx(w // 2, h // 2),
                }
            )
        )


if __name__ == "__main__":
    main()
