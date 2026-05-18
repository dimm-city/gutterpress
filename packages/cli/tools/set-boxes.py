"""Optional: set TrimBox/BleedBox on a PDF.

Chromium doesn't reliably set TrimBox/BleedBox for interiors.
If you *must* provide these boxes, you can run this script after the build.

Requires: pikepdf
  pip install pikepdf

Usage:
  python3 scripts/set-boxes.py --in dist/book.pdf --out dist/book.boxed.pdf --bleed 0.125

Notes:
- This sets TrimBox = Letter (8.5x11) and BleedBox = TrimBox expanded by bleed
- The BleedBox must be <= MediaBox; so this script also expands MediaBox to include BleedBox
  (which some platforms might dislike). Test with DriveThru.
"""

import argparse
import pikepdf

PT_PER_IN = 72.0

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--in", dest="inp", required=True)
  ap.add_argument("--out", dest="out", required=True)
  ap.add_argument("--bleed", type=float, default=0.125)
  args = ap.parse_args()

  bleed = args.bleed * PT_PER_IN
  # Letter in points
  w = 8.5 * PT_PER_IN
  h = 11.0 * PT_PER_IN

  with pikepdf.open(args.inp) as pdf:
    for page in pdf.pages:
      trim = pikepdf.Array([0, 0, w, h])
      bleed_box = pikepdf.Array([-bleed, -bleed, w + bleed, h + bleed])
      page.TrimBox = trim
      page.BleedBox = bleed_box
      page.MediaBox = bleed_box
    pdf.save(args.out)

if __name__ == "__main__":
  main()
