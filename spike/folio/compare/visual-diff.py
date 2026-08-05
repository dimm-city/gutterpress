#!/usr/bin/env python3
"""Rasterise two PDFs at the same DPI, score per-page difference, and write
side-by-side contact sheets.

Verification only (PyMuPDF), like spikes/pdfprobe.py — never part of the runtime.

  visual-diff.py <a.pdf> <b.pdf> <outdir> [dpi]  -> JSON on stdout
"""
import json
import os
import sys

import fitz


def render(doc, i, dpi):
    return doc[i].get_pixmap(dpi=dpi)


def to_gray_bytes(pix):
    if pix.n > 1:
        pix = fitz.Pixmap(fitz.csGRAY, pix)
    return pix.samples, pix.width, pix.height


def diff_score(pa, pb):
    """Fraction of pixels differing by more than 12/255, on a common grid."""
    a, aw, ah = to_gray_bytes(pa)
    b, bw, bh = to_gray_bytes(pb)
    w, h = min(aw, bw), min(ah, bh)
    if w == 0 or h == 0:
        return 1.0
    diff = 0
    total = 0
    step = 2  # sample every other pixel: plenty for a difference score
    for y in range(0, h, step):
        ra = y * aw
        rb = y * bw
        for x in range(0, w, step):
            total += 1
            if abs(a[ra + x] - b[rb + x]) > 12:
                diff += 1
    return diff / max(1, total)


def sheet(pa, pb, path, label_a, label_b):
    gap = 24
    w = pa.width + pb.width + gap * 3
    h = max(pa.height, pb.height) + gap * 2
    out = fitz.open()
    page = out.new_page(width=w, height=h)
    page.draw_rect(fitz.Rect(0, 0, w, h), color=None, fill=(0.85, 0.85, 0.87))
    page.insert_image(fitz.Rect(gap, gap, gap + pa.width, gap + pa.height), pixmap=pa)
    x2 = gap * 2 + pa.width
    page.insert_image(fitz.Rect(x2, gap, x2 + pb.width, gap + pb.height), pixmap=pb)
    page.insert_text((gap, gap - 8), label_a, fontsize=9)
    page.insert_text((x2, gap - 8), label_b, fontsize=9)
    out.save(path)
    out.close()


def main(a_path, b_path, outdir, dpi="72"):
    dpi = int(dpi)
    os.makedirs(outdir, exist_ok=True)
    a = fitz.open(a_path)
    b = fitz.open(b_path)
    n = min(len(a), len(b))
    # first, middle and last spreads plus a couple of body pages
    picks = sorted({0, 1, min(2, n - 1), n // 3, n // 2, (2 * n) // 3, n - 2, n - 1})
    picks = [p for p in picks if 0 <= p < n]

    scores = []
    for i in range(n):
        scores.append(diff_score(render(a, i, 36), render(b, i, 36)))

    sheets = []
    for i in picks:
        pa = render(a, i, dpi)
        pb = render(b, i, dpi)
        path = os.path.join(outdir, f"page-{i + 1:03d}.pdf")
        sheet(pa, pb, path, f"gutterpress p{i + 1}", f"folio p{i + 1}")
        png = os.path.join(outdir, f"page-{i + 1:03d}.png")
        fitz.open(path)[0].get_pixmap(dpi=dpi).save(png)
        sheets.append({"page": i + 1, "png": png, "diff": round(scores[i], 4)})

    print(
        json.dumps(
            {
                "dpi": dpi,
                "compared": n,
                "pagesA": len(a),
                "pagesB": len(b),
                "meanDiff": round(sum(scores) / max(1, len(scores)), 4),
                "worst": sorted(
                    ({"page": i + 1, "diff": round(s, 4)} for i, s in enumerate(scores)),
                    key=lambda x: -x["diff"],
                )[:8],
                "identicalPages": sum(1 for s in scores if s < 0.005),
                "sheets": sheets,
            }
        )
    )


if __name__ == "__main__":
    main(*sys.argv[1:])
