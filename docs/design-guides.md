# Companion design guides

A *design guide* is a living styleguide that ships alongside the book it
documents. It's authored exactly like a book — markdown, the same
manifest, the same plugins, the same CSS — and it's published as a static
HTML site that you can open while writing.

The guide demonstrates every typography choice, callout, page template,
and palette swatch the book uses. Because both projects share the same
stylesheet, the guide is correct by construction: if the book's heading
treatment changes, the guide updates the next time you publish it.

## Why bother

- **Author reference.** A click away from the manuscript while you're
  editing — "what does an `@section .sidebar` look like again?".
- **Editor / co-author alignment.** A link you can paste into a chat to
  agree on tone before someone changes a heading.
- **Onboarding.** Six months later, future-you (or a new collaborator)
  reads the guide instead of guessing.

## Recommended layout

Put the design guide next to the book in the same repo:

```text
my-book/
├── manifest.yaml                 # the book
├── chapter-01.md
├── chapter-02.md
├── shared/
│   └── styles/main.css           # consumed by BOTH manifests
├── design-guide/
│   ├── manifest.yaml             # the design guide
│   ├── 00-overview.md
│   ├── 01-typography.md
│   ├── 02-callouts.md
│   ├── 03-page-templates.md
│   ├── 04-palette.md
│   └── styles/guide.css          # design-guide-only swatches/labels
└── .github/workflows/
    └── publish-design-guide.yml  # GitHub Pages deploy
```

[`examples/with-design-guide/`](../examples/with-design-guide) is a working
variation on this layout. It is a MULTI-book project — `book-01/` and `book-02/`
sit beside `design-guide/` rather than inside a single book — and it keeps the
shared stylesheet in the guide itself (`design-guide/styles/guide.css`) instead
of a separate `shared/` directory. The style-sharing approach described below
is the same in both shapes.

`print-md` discovers the manifest from whichever directory you point at,
so `print-md build ./design-guide` and `print-md build .` (the book) both
work, each finding its own `manifest.yaml`.

## Sharing styles, plugins, and assets

The point of the guide is fidelity to the book. Have both manifests
reference the same CSS file directly — no copying, no shared asset
directory:

```yaml
# design-guide/manifest.yaml
styles:
  - shared/styles/main.css   # ← same file the book uses
  - styles/guide.css          # ← guide-only chrome (swatches, labels)
```

A `styles:` entry is a path print-md *reads*, not a file it ships — the
stylesheet's text is inlined into `book.html` at render time, so its real
location on disk is irrelevant to the output. That's what lets the guide and
the book both point straight at `shared/styles/main.css` with a plain
manifest-relative path — no asset list, no copied `shared/` folder, and no
"name the destination instead of the source" rule to remember. Any fonts or
images that stylesheet references (via `url(...)`) resolve relative to the
stylesheet itself and are embedded or copied automatically; only images an
author references directly from *markdown* must live inside that project's
own folder. Apply the same `styles:` path to the book's manifest.

If the book uses plugins, list the same `plugins:` entries in both
manifests so the guide demonstrates the real markdown extensions.

## Authoring loop

```sh
print-md preview ./design-guide
```

Opens the live preview server with hot reload. Edits to the design guide
or to `shared/styles/main.css` reflect immediately. The toolbar's print
button, page nav, zoom, debug overlay, and background color picker all
work — they're the same UI you ship in the published static site.

## What to cover in the guide

A useful guide is exhaustive about what the book actually uses. Start
with these sections and add to them as the manuscript grows:

- **Typography** — heading scale, body face, line height, inline elements
  (bold/italic/code), block quotes, lists.
- **Callouts and asides** — every `@callout`, `@sidebar`, and `> [!TYPE]`
  alert variant the book uses, with one realistic example each.
- **Page templates** — `@page chapter`, `@spread`, `@end-section`, plus a
  representative full body page so leading and hyphenation are visible at
  scale.
- **Palette** — the small set of colors the book is allowed to use, with
  hex (and CMYK if heading to print).
- **Plugin components** — anything provided by `markdown-it` plugins
  loaded via the manifest (TTRPG modules, dimm-city, custom plugins).

## Build the static site

```sh
print-md build ./design-guide --format html --out ./_site
```

Produces a complete deployable directory:

```text
_site/
├── book.html               ← the rendered guide, CSS + fonts inlined (pre-paginated)
├── index.html              ← redirects to book.html, for hosts that need a default entry point
└── preview/
    └── scripts/            ← pagedjs-interface.js and pagedjs-bridge.js (page nav, zoom, toolbar)
```

There's no `shared/` or `styles/` in the output: your stylesheets are read and
inlined straight into `book.html`, not copied. Any images the guide actually
references travel with it too, at the relative path you authored them at (or
under `assets/` for a CSS-referenced image that lives outside the project).
`vendor/paged.polyfill.js` only appears as a fallback when no Chromium is
available at build time — the browser paginates at load instead of shipping
pre-paginated pages.

Open `_site/book.html` directly in a browser to view the paginated guide.
The toolbar UI lives in the print-md Electron desktop app (`packages/viewer`)
and is not part of the static HTML build output.

## Publish to GitHub Pages

1. Copy
   [`examples/with-design-guide/.github/workflows/publish-design-guide.yml`](../examples/with-design-guide/.github/workflows/publish-design-guide.yml)
   into your book repo at the same path.
2. **Settings → Pages → Source: GitHub Actions**.
3. Push to `main`. The workflow runs `print-md build ./design-guide
   --format html --out ./design-guide-site` and deploys the directory.

The guide is now reachable at `https://<owner>.github.io/<repo>/`.

## Other static hosts

The build output is just a directory of files. Any host that serves a
directory works:

- **Netlify / Cloudflare Pages** — set the publish directory to the
  output dir, and the build command to `bunx print-md build ./design-guide
  --format html --out <publish-dir>`.
- **S3 / object storage** — sync the output dir to a bucket with static
  hosting enabled.

The viewer uses relative paths for its scripts and styles, so subpath
hosting (`example.com/docs/design-guide/`) works without configuration.

## Including a print-ready PDF

To also publish a downloadable PDF next to the guide, run:

```sh
print-md build ./design-guide --format pdf --out ./_site
```

The PDF — named `<title-slug>-pdf.pdf` (a slug of the manifest `title`, e.g.
`your-book-title-design-guide-pdf.pdf`) — is dropped into `_site/` alongside
the viewer files. Link to it from `00-overview.md` so readers can grab the
print-ready version.

For a fully validated PDF/X (CMYK, embedded fonts, post-build checks),
use:

```sh
print-md build ./design-guide --format pdfx --icc path/to/profile.icc
```

## Side-manifest variant

If you'd rather keep the guide content in the same directory as the book
and just have a second manifest, every print-md command takes
`--manifest`:

```sh
print-md build . --manifest ./design-guide.manifest.yaml --format html --out ./_site
```

The sibling-directory layout above is generally cleaner, but the
side-manifest form is there when you need it.

## See also

- [`examples/with-design-guide/`](../examples/with-design-guide) — the
  paired book + guide reference.
- [Print-md User Guide](../examples/print-md-user-guide/) — markdown directives,
  page control, CSS theming, and all core features.
- [User Guide: Chapter 4 — Styling & Theming](../examples/print-md-user-guide/04-styling-theming.md) — theme examples and
  CSS conventions.
