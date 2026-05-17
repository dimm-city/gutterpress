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
  editing — "what does an `::: sidebar` look like again?".
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

A working version of this layout lives at
[`examples/with-design-guide/`](../examples/with-design-guide).

`print-md` discovers the manifest from whichever directory you point at,
so `print-md build ./design-guide` and `print-md build .` (the book) both
work, each finding its own `manifest.yaml`.

## Sharing styles, plugins, and assets

The point of the guide is fidelity to the book. Have both manifests
reference the same CSS files via the shared directory:

```yaml
# design-guide/manifest.yaml
styles:
  - shared/styles/main.css   # ← same file the book uses
  - styles/guide.css          # ← guide-only chrome (swatches, labels)
source:
  assets:
    - ../shared               # copies shared/ into the output dir
    - styles
```

print-md flattens any `..` parents in `source.assets` to a single basename
in the output, so the `styles` paths above reference the flattened
location (`shared/styles/main.css`), not the manifest-relative source
path. Apply the same convention to the book's manifest.

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
├── index.html              ← the print-md viewer (same UI as `preview`)
├── book.html               ← the rendered guide content (loaded into the iframe)
├── preview/                ← viewer scripts and styles
│   ├── scripts/
│   └── styles/
├── shared/                 ← copied from your manifest's assets
└── styles/
```

Open `_site/index.html` and you'll see the guide in the same chrome the
preview server uses — toolbar, page nav, zoom, print button — but with no
backing server. The toolbar's folder picker, GitHub clone, and exit
buttons are hidden because they need API routes that aren't there.

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

`book.pdf` is dropped into `_site/` alongside the viewer files. Link to
it from `00-overview.md` so readers can grab the print-ready version.

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
- [`docs/authoring-guide.md`](./authoring-guide.md) — markdown directives,
  page control, custom containers.
- [`docs/styling-theming.md`](./styling-theming.md) — theme examples and
  CSS conventions.
