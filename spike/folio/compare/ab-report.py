#!/usr/bin/env python3
"""
A/B report: Gutterpress (Paged.js) vs Folio on the same book.

Independent of Folio's own code — everything is read back out of the two PDFs
with poppler, so the tool being evaluated never grades its own homework.

    python3 compare/ab-report.py <gutterpress.pdf> <folio.pdf>
"""
import re
import subprocess
import sys
from collections import Counter


def pages_text(pdf):
    out = subprocess.run(["pdftotext", "-layout", pdf, "-"],
                         capture_output=True, text=True).stdout
    return out.split("\f")


def words_bbox(pdf):
    """{word: [(page, glyph_height, x0)]} from the whole document."""
    out = subprocess.run(["pdftotext", "-bbox", pdf, "-"],
                         capture_output=True, text=True).stdout
    per = {}
    for i, pg in enumerate(out.split("<page ")[1:], 1):
        for m in re.finditer(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>',
            pg,
        ):
            x0, y0, y1, t = float(m[1]), float(m[2]), float(m[4]), m[5]
            per.setdefault(t, []).append((i, round(y1 - y0, 2), round(x0, 1)))
    return per


def anchors(pdf):
    """Unique long lines -> the single page they appear on."""
    d = {}
    for i, pg in enumerate(pages_text(pdf), 1):
        for line in pg.splitlines():
            s = line.strip()
            if len(s) > 25 and not s.startswith("P."):
                d.setdefault(s, []).append(i)
    return {s: v[0] for s, v in d.items() if len(v) == 1}


def text_left_edge(pdf, page):
    out = subprocess.run(["pdftotext", "-bbox", "-f", str(page), "-l", str(page), pdf, "-"],
                         capture_output=True, text=True).stdout
    xs = [float(m[1]) for m in re.finditer(r'<word xMin="([\d.]+)"', out)]
    return min(xs) if xs else None


def main(gp_pdf, fo_pdf):
    gp_pages, fo_pages = pages_text(gp_pdf), pages_text(fo_pdf)
    print("=" * 68)
    print("A/B REPORT — Gutterpress (Paged.js) vs Folio")
    print("=" * 68)
    print(f"\npages: gutterpress {len(gp_pages)}   folio {len(fo_pages)}"
          f"   ratio {len(gp_pages)/max(1,len(fo_pages)):.3f}")

    # ---- 1. type scale -------------------------------------------------
    gw, fw = words_bbox(gp_pdf), words_bbox(fo_pdf)
    common = [w for w in gw if w in fw and len(w) > 6]
    ratios = []
    for w in common:
        a, b = gw[w][0][1], fw[w][0][1]
        if b:
            ratios.append(a / b)
    if ratios:
        match = sum(1 for r in ratios if abs(r - 1) < 0.012)
        print(f"\n-- type scale --")
        print(f"   words compared: {len(ratios)}")
        print(f"   glyph height within ±1.2%: {match}/{len(ratios)} "
              f"({100*match/len(ratios):.1f}%)")
        print(f"   median ratio gp/folio: {sorted(ratios)[len(ratios)//2]:.4f}")

    # ---- 2. page alignment --------------------------------------------
    ga, fa = anchors(gp_pdf), anchors(fo_pdf)
    shared = sorted(set(ga) & set(fa), key=lambda s: ga[s])
    if shared:
        same = sum(1 for s in shared if ga[s] == fa[s])
        off1 = sum(1 for s in shared if abs(ga[s] - fa[s]) <= 1)
        off2 = sum(1 for s in shared if abs(ga[s] - fa[s]) <= 2)
        drift = [ga[s] / fa[s] for s in shared if fa[s]]
        print(f"\n-- page alignment ({len(shared)} shared anchor lines) --")
        print(f"   same page:      {same}/{len(shared)} ({100*same/len(shared):.1f}%)")
        print(f"   within ±1 page: {off1}/{len(shared)} ({100*off1/len(shared):.1f}%)")
        print(f"   within ±2 page: {off2}/{len(shared)} ({100*off2/len(shared):.1f}%)")
        print(f"   median gp/folio page ratio: {sorted(drift)[len(drift)//2]:.3f}")
        print("\n   drift profile (every ~10th anchor):")
        print(f"   {'gp':>5} {'folio':>6} {'delta':>6}  anchor")
        for s in shared[:: max(1, len(shared) // 12)]:
            print(f"   {ga[s]:>5} {fa[s]:>6} {fa[s]-ga[s]:>+6}  {s[:50]}")

    # ---- 3. mirrored margins (named-page geometry) ---------------------
    print(f"\n-- mirrored gutters (text left edge by page parity) --")
    for name, pdf, n in (("gutterpress", gp_pdf, len(gp_pages)),
                         ("folio", fo_pdf, len(fo_pages))):
        recto, verso = [], []
        for p in range(9, min(n, 40)):
            e = text_left_edge(pdf, p)
            if e is None:
                continue
            (recto if p % 2 == 1 else verso).append(round(e))
        rc = Counter(recto).most_common(1)
        vc = Counter(verso).most_common(1)
        print(f"   {name:12} recto≈{rc[0][0] if rc else '?'}pt  verso≈{vc[0][0] if vc else '?'}pt"
              f"   (mirrored: {'YES' if rc and vc and abs(rc[0][0]-vc[0][0])>5 else 'NO'})")

    # ---- 4. folio chips / running feet ---------------------------------
    print(f"\n-- printed folio numbers --")
    for name, ps in (("gutterpress", gp_pages), ("folio", fo_pages)):
        nums = [re.findall(r"P\.\s*(\d+)", pg) for pg in ps]
        have = [n[0] for n in nums if n]
        print(f"   {name:12} {len(have)}/{len(ps)} pages carry a folio; "
              f"first={have[0] if have else '-'} last={have[-1] if have else '-'}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
