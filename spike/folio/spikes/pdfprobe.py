#!/usr/bin/env python3
"""Verification-only PDF probe (PyMuPDF).

NOT part of the Folio runtime. The spike needs an independent reader to prove
claims about Chromium's PDF output (text placement, page geometry, raster
comparison). Folio itself only ever *writes* PDFs, with pdf-lib.

Usage:
  pdfprobe.py text   <pdf>                 -> JSON per-page text + word boxes
  pdfprobe.py render <pdf> <outdir> [dpi]  -> page PNGs, prints JSON manifest
  pdfprobe.py info   <pdf>                 -> JSON page boxes / metadata
"""
import json
import sys

import fitz  # PyMuPDF


def cmd_text(path):
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc):
        words = [
            {
                "x0": round(w[0], 2),
                "y0": round(w[1], 2),
                "x1": round(w[2], 2),
                "y1": round(w[3], 2),
                "text": w[4],
            }
            for w in page.get_text("words")
        ]
        pages.append({"page": i, "text": page.get_text().strip(), "words": words})
    print(json.dumps({"pageCount": len(pages), "pages": pages}))


def cmd_info(path):
    doc = fitz.open(path)
    out = []
    for i, page in enumerate(doc):
        out.append(
            {
                "page": i,
                "mediabox": [round(v, 3) for v in list(page.mediabox)],
                "cropbox": [round(v, 3) for v in list(page.cropbox)],
                "rect": [round(v, 3) for v in list(page.rect)],
                "rotation": page.rotation,
            }
        )
    fonts = sorted({f[3] for p in doc for f in p.get_fonts(full=True)})
    cat = doc.pdf_catalog()
    mark_info = doc.xref_get_key(cat, "MarkInfo")
    struct_root = doc.xref_get_key(cat, "StructTreeRoot")
    print(
        json.dumps(
            {
                "pageCount": len(out),
                "pages": out,
                "fonts": fonts,
                "metadata": doc.metadata,
                "markInfo": mark_info[1] if mark_info[0] != "null" else None,
                "structTreeRoot": struct_root[0] != "null",
                "isTagged": struct_root[0] != "null",
                "hasOutline": bool(doc.get_toc()),
                "toc": doc.get_toc(),
            }
        )
    )


def cmd_render(path, outdir, dpi="96"):
    import os

    os.makedirs(outdir, exist_ok=True)
    doc = fitz.open(path)
    files = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=int(dpi))
        f = os.path.join(outdir, f"page-{i + 1:03d}.png")
        pix.save(f)
        files.append({"page": i, "file": f, "w": pix.width, "h": pix.height})
    print(json.dumps({"files": files}))


if __name__ == "__main__":
    cmd = sys.argv[1]
    {"text": cmd_text, "info": cmd_info, "render": cmd_render}[cmd](*sys.argv[2:])
