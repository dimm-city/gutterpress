---
title: "Gutterpress 0.11.15: DriveThruRPG-ready interiors"
description: "Black PDF/X text now prints on the black plate only, and DriveThruRPG interiors always end on the blank page the printer needs."
og:title: "Gutterpress 0.11.15: DriveThruRPG-ready interiors"
og:description: "Black PDF/X text prints on the black plate only, and DriveThruRPG interiors end on a blank page."
schema: BlogPosting
date: 2026-10-07T00:00:00Z
author: Dimm City
og:type: article
---

# Gutterpress 0.11.15: DriveThruRPG-ready interiors

Two fixes for books printed through DriveThruRPG, both on by default for the
`dtrpg` preset.

## Black text on the black plate

Chromium writes text colour as RGB, so the PDF/X conversion turned black text
into four-colour black, which DriveThruRPG rejects for text at 24pt and
below. The new `pdfx.blackText` option (`icc` or `k-only`) controls this.
The `dtrpg` preset uses `k-only`, which prints black and near-black text,
warm inks such as `#1a1512` included, at 100% K. Coloured text, and black
rules and panels, are unchanged.

## A blank last page, every time

The `dtrpg` preset now pads to 4-page signatures, and the new
`print.reserveLastPage` option adds a full signature of blank pages when the
content already fills one exactly, so the final page, which is reserved for
printer information, is always blank. The page count in the build log is the
number to enter in DriveThruRPG's cover Template Generator.

## Existing books build differently

Rebuilding an unchanged `dtrpg` book gives a PDF with 1–4 extra blank pages
at the end and, for `--format pdfx`, black text on the black plate only. To
keep the old output, set this in `manifest.yaml`:

```yaml
print:
  reserveLastPage: false
pdfx:
  blackText: icc
```

See the [full changelog](https://github.com/dimm-city/gutterpress/blob/main/CHANGELOG.md)
or [download the release](https://github.com/dimm-city/gutterpress/releases/latest).
