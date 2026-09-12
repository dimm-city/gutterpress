# Themes, styles, and assets

How Gutterpress composes CSS and how files reach the finished book.
Verified against the Gutterpress source that ships this package, 2026-09-08.

## Two CSS locations, different roles

- **`extensions/<id>/`** is a look — an extension *package*: `theme.css` plus
  a small `gutterpress.json` (or `theme.json`) naming what it carries, and any
  fonts or images the look owns. It is listed under `extensions:` as
  `./extensions/<id>`; a folder elsewhere (a shared `../../shared/house-style`)
  is listed by its own path and read in place.
- **`styles/`** is ordinary publication CSS — `book.css`, component sheets,
  page rules. No filename carries special meaning; `tokens.css` and
  `components.css` are conventions, not contracts.

Adding a built-in look copies the whole package into `extensions/<id>/` so the
book owns editable files; a `.zip`, bare CSS or URL import lands there too (a
URL import fetches only the stylesheet and metadata, never referenced fonts or
images — use a folder or `.zip` when the complete asset package must travel
with the look). Any number of looks may be on at once; a later entry's CSS
wins ties. Do not reorder an established list merely to force one entry first.

## The cascade

What the built document contains, in order:

```text
1. core layout primitives and author utilities (layered — they lose to everything below)
2. extension stylesheets, in `extensions:` list order
3. manifest `styles:` entries, in listed order
```

Project CSS is last, so it wins at equal specificity. Within each list, later
entries win. That is the entire precedence model.

```yaml
extensions:
  - ../../shared/house-style                     # shared look, read in place
styles:
  - ../../shared/styles/publisher-components.css # shared components
  - styles/book.css                              # this book, final say
```

## A `styles:` entry is a path to READ

Gutterpress does not copy stylesheets. It reads each entry and inlines it into
`book.html`. Three consequences:

1. **An entry may live anywhere**, including above the book root
   (`../../shared/styles/x.css`). Its location has no effect on the output.
2. **There is no staged destination**, so a path in `styles:` is the real source
   path — nothing to reverse-map, no flattening, no basename collisions.
3. **Shared design is referenced, not vendored.** Editing
   `shared/styles/publisher-components.css` changes every book that lists it.
   That is the point, and it is why `changeScope: book-only` must not touch it.

To override a shared declaration without editing the shared file, add the rule
to a book stylesheet listed later.

## How fonts and images travel

Every `url()` resolves against **the stylesheet that contains it**, not against
the book root:

```text
shared/themes/publisher/theme.css
  └── url("../../fonts/Publisher.woff2")  →  shared/fonts/Publisher.woff2
                                          →  embedded as a data: URI
```

- **Fonts always embed.** This is what guarantees the exact face reaches
  Chromium and therefore the PDF.
- **Images are copied**, never embedded, under a content-addressed name in
  `assets/` — wherever they live. That keeps a CSS image's URL distinct from
  any prose image's, which is what lets an `@page` background print.
- **A missing stylesheet or font is a build error**, named and located, at read
  time — not a silent fallback during pagination.
- **Remote `url()`s are left untouched** and warned about; print work should not
  depend on them.

`@import` inside a stylesheet is followed and inlined in place, preserving any
`media`, `supports`, or `layer` conditions the import carried.

## Markdown images must live inside the book

A Markdown image reference is copied verbatim at its authored relative path, so
it must resolve inside the book folder. `../` and absolute references are build
errors telling the author to copy the file into the project.

This is the one asymmetry worth remembering: **shared art referenced from
shared CSS is fine; shared art referenced from prose must be copied into the
book that uses it.**

## Extensions and profiles are direct references

```yaml
extensions:
  - ../../shared/plugins/publisher-components.js
  - ./plugins/book-components.js

pdfx:
  icc: ../../shared/profiles/CGATS21_CRPC1.icc
```

An extension entry is a bare specifier: `./x` and `../x` are paths (a plugin
file or an extension folder) that resolve from the manifest directory and may
point outside the book; anything else is an npm package, `name@version` pinned.
`profiles/` is a team naming convention only — the manifest names the ICC file
directly.

## Authored extensions vs. managed npm packages

- **Authored** — an ordinary `.js` file or extension folder the manifest lists
  by path. Git-tracked source; editable in `layout` or `content` scope when
  Markdown rendering behavior genuinely must change.
- **Managed** — installed by `gutterpress ext add <pkg>@<version> <book>`, which
  verifies and vendors the exact dependency graph beneath the book's
  `plugins/npm/` tree with integrity receipts, then pins `name@version` in the
  manifest's `extensions:` list.

`plugins/npm/**` is machine-owned. Never edit it, move it, or share it between
books. Commit it — a team relying on reproducible offline builds needs it.
