#!/usr/bin/env python3
"""Ink bounding box per page, in points (verification only, PyMuPDF).

Catches geometry defects that text extraction cannot see: a background that
stops short of the trim, a page whose content box is inset when it shouldn't
be, a full-bleed image that isn't.
"""
import json
import sys

import fitz

DPI = 72
THRESHOLD = 245  # anything darker than this counts as ink


def box(page):
    pix = page.get_pixmap(dpi=DPI)
    if pix.n > 1:
        pix = fitz.Pixmap(fitz.csGRAY, pix)
    w, h, s = pix.width, pix.height, pix.samples
    minx, maxx, miny, maxy = w, -1, h, -1
    for y in range(h):
        row = y * w
        line = s[row : row + w]
        # fast reject: skip blank rows
        if min(line) >= THRESHOLD:
            continue
        if y < miny:
            miny = y
        maxy = y
        for x in range(w):
            if line[x] < THRESHOLD:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
    if maxx < 0:
        return None
    scale = 72 / DPI
    return [round(minx * scale, 1), round(miny * scale, 1),
            round(maxx * scale, 1), round(maxy * scale, 1)]


def main(path):
    doc = fitz.open(path)
    print(
        json.dumps(
            {
                "pages": [
                    {"page": i + 1, "box": box(p), "media": [round(v, 1) for v in list(p.rect)]}
                    for i, p in enumerate(doc)
                ]
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1])
