#!/usr/bin/env python3
"""Verification-only PDF probe — poppler backend.

Drop-in replacement for the PyMuPDF implementation, with the same CLI and the
same JSON shapes, for machines that have poppler-utils but no PyMuPDF. Chosen
because poppler ships on every Linux print box (and is already a Gutterpress
build dependency for validation), while PyMuPDF needs pip.

NOT part of the Folio runtime — Folio only ever *writes* PDFs, with pdf-lib.
This is the independent reader the spikes assert against.

  pdfprobe.py text     <pdf>                 -> JSON per-page text + word boxes
  pdfprobe.py info     <pdf>                 -> JSON page boxes / fonts / metadata
  pdfprobe.py render   <pdf> <outdir> [dpi]  -> page PNGs, prints JSON manifest
  pdfprobe.py drawings <pdf> [page]          -> vector strokes (content stream)
"""
import json
import os
import re
import subprocess
import sys
import zlib
import xml.etree.ElementTree as ET

XHTML = "{http://www.w3.org/1999/xhtml}"


def _run(args: list[str]) -> str:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{args[0]} failed: {r.stderr.strip()}")
    return r.stdout


def _pages_with_words(path):
    """Word boxes per page, in PDF points with a top-left origin (PyMuPDF's
    convention, which every spike is written against). pdftotext -bbox-layout
    already reports top-left coordinates, so no flip is needed."""
    xml = _run(["pdftotext", "-bbox-layout", path, "-"])
    root = ET.fromstring(xml)
    pages = []
    for i, page in enumerate(root.iter(f"{XHTML}page")):
        words = []
        lines = []
        for line in page.iter(f"{XHTML}line"):
            texts = []
            for w in line.iter(f"{XHTML}word"):
                text = (w.text or "").strip()
                if not text:
                    continue
                words.append(
                    {
                        "x0": round(float(w.get("xMin")), 2),
                        "y0": round(float(w.get("yMin")), 2),
                        "x1": round(float(w.get("xMax")), 2),
                        "y1": round(float(w.get("yMax")), 2),
                        "text": text,
                    }
                )
                texts.append(text)
            if texts:
                lines.append(" ".join(texts))
        pages.append({"page": i, "text": "\n".join(lines).strip(), "words": words})
    return pages


def cmd_text(path):
    pages = _pages_with_words(path)
    print(json.dumps({"pageCount": len(pages), "pages": pages}))


def _page_boxes(path):
    out = {}
    info = _run(["pdfinfo", "-box", "-f", "1", "-l", "1000000", path])
    for m in re.finditer(
        r"Page\s+(\d+)\s+(MediaBox|CropBox):\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)",
        info,
    ):
        page = int(m.group(1)) - 1
        box = [round(float(m.group(i)), 3) for i in range(3, 7)]
        out.setdefault(page, {})[m.group(2)] = box
    return out, info


def cmd_info(path):
    boxes, info = _page_boxes(path)
    pages = [
        {
            "page": p,
            "mediabox": b.get("MediaBox", []),
            "cropbox": b.get("CropBox", b.get("MediaBox", [])),
            "rect": b.get("CropBox", b.get("MediaBox", [])),
            "rotation": 0,
        }
        for p, b in sorted(boxes.items())
    ]
    fonts = sorted(
        {
            line.split()[0]
            for line in _run(["pdffonts", path]).splitlines()[2:]
            if line.strip()
        }
    )
    meta = {}
    for key, out_key in (
        ("Title", "title"),
        ("Author", "author"),
        ("Producer", "producer"),
        ("Creator", "creator"),
    ):
        m = re.search(rf"^{key}:\s+(.*)$", info, re.M)
        if m and m.group(1).strip():
            meta[out_key] = m.group(1).strip()
    tagged = bool(re.search(r"^Tagged:\s+yes", info, re.M))
    print(
        json.dumps(
            {
                "pageCount": len(pages),
                "pages": pages,
                "fonts": fonts,
                "metadata": meta,
                "markInfo": "<</Marked true>>" if tagged else None,
                "structTreeRoot": tagged,
                "isTagged": tagged,
                "hasOutline": False,  # use pdf-lib's inspectPdf for the outline
                "toc": [],
            }
        )
    )


def cmd_render(path, outdir, dpi="96"):
    os.makedirs(outdir, exist_ok=True)
    prefix = os.path.join(outdir, "page")
    _run(["pdftoppm", "-png", "-r", str(dpi), path, prefix])
    files = []
    for name in sorted(os.listdir(outdir)):
        if not name.startswith("page") or not name.endswith(".png"):
            continue
        num = int(re.search(r"(\d+)", name).group(1))
        files.append({"page": num - 1, "file": os.path.join(outdir, name)})
    print(json.dumps({"files": files}))


def _content_streams(path, page_index):
    """Raw content stream bytes for one page, via pdftocairo -> no. Poppler has
    no content-stream dump, so parse the file directly: find the page object,
    follow /Contents, inflate."""
    data = open(path, "rb").read()
    # every stream in the file, inflated where possible
    streams = []
    for m in re.finditer(rb"stream\r?\n", data):
        start = m.end()
        end = data.find(b"endstream", start)
        if end == -1:
            continue
        raw = data[start:end]
        try:
            streams.append(zlib.decompress(raw))
        except zlib.error:
            streams.append(raw)
    return streams


def cmd_drawings(path, page="0"):
    """Vector strokes on a page.

    Poppler exposes no drawing model, so this reads the content streams and
    collects `m`/`l`/`re` path constructions — enough for what the spikes ask
    (are crop marks drawn, and where). Coordinates are PDF user space with a
    bottom-left origin, converted to the top-left origin the probe reports
    elsewhere.
    """
    idx = int(page)
    boxes, _ = _page_boxes(path)
    box = boxes.get(idx, {}).get("MediaBox") or [0, 0, 612, 792]
    height = box[3] - box[1]

    items = []
    for stream in _content_streams(path, idx):
        try:
            text = stream.decode("latin-1")
        except Exception:
            continue
        nums = r"(-?[\d.]+)"
        for m in re.finditer(rf"{nums}\s+{nums}\s+m\s+{nums}\s+{nums}\s+l", text):
            x0, y0, x1, y1 = (float(m.group(i)) for i in range(1, 5))
            items.append(
                {
                    "rect": [
                        round(min(x0, x1), 2),
                        round(height - max(y0, y1), 2),
                        round(max(x0, x1), 2),
                        round(height - min(y0, y1), 2),
                    ],
                    "type": "s",
                }
            )
        for m in re.finditer(rf"{nums}\s+{nums}\s+{nums}\s+{nums}\s+re", text):
            x, y, w, h = (float(m.group(i)) for i in range(1, 5))
            items.append(
                {
                    "rect": [
                        round(x, 2),
                        round(height - (y + h), 2),
                        round(x + w, 2),
                        round(height - y, 2),
                    ],
                    "type": "re",
                }
            )
    print(
        json.dumps(
            {
                "count": len(items),
                "items": items,
                "page": [round(v, 2) for v in box],
            }
        )
    )


if __name__ == "__main__":
    cmd = sys.argv[1]
    {
        "text": cmd_text,
        "info": cmd_info,
        "render": cmd_render,
        "drawings": cmd_drawings,
    }[cmd](*sys.argv[2:])
