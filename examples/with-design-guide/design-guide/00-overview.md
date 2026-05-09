# Design Guide

This is the companion design guide for *My Book Title*. It uses the same
stylesheet, plugins, and page geometry as the book — so the typography and
components you see here are what the book actually ships.

## Audience

- The book's author, while writing — to confirm a heading or callout will
  render the way you remember.
- Co-writers and editors — to align on voice and visual tone without
  reading the full manuscript.
- Future-you, six months from now, when you can't remember which class to
  use for an aside.

## How this is built

This guide is a normal print-md project. `print-md preview ./design-guide`
runs it locally with hot reload; `print-md build ./design-guide --format
html --out ./_site` produces a static-site directory you can drop on
GitHub Pages or any static host. The same `book.pdf` print-ready download
is produced by `print-md run` (see "Download").

## Download

If the published guide also includes the print-ready PDF (run `print-md
run ./design-guide` before publishing), it will be at `book.pdf` next to
this page. [Download the PDF](book.pdf){.download}
