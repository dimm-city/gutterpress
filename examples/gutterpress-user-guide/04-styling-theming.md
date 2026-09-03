# Styling & Theming {#ch-styling}

@section .lede

Gutterpress uses plain CSS for all styling. Control colors, fonts, and layout through CSS custom properties. Add your own stylesheets on top of any built-in theme.

@end-section

## Built-in Themes

Gutterpress ships three built-in themes, embedded in the CLI binary and library:

| Theme id | Description |
|----------|-------------|
| `clean-book` | A calm, classic book look: serif body, generous margins, restrained accents. |
| `zine` | High-contrast, punchy sans-serif look for short photocopier-friendly zines. |
| `technical-doc` | Clean sans-serif manual look with clear hierarchy, code styling, and tidy tables. |

Applying a theme **copies** its `theme.css` (and any bundled fonts/assets) into your project at `themes/<id>/`, so the project carries its own copy with no external path dependency, and wires the matching `styles:` entry into `manifest.yaml` for you. Apply, import, list, and revert themes from the desktop app's Theme panel, or from the terminal with `gutterpress theme` — both call the same underlying code, so either way produces the same tracked, switchable result:

```sh
gutterpress theme list ./my-book              # built-in + project themes, and which is active
gutterpress theme apply clean-book ./my-book  # copy the theme in and make it active
gutterpress theme import ./my-theme ./my-book # vendor a folder/.zip/.css/URL theme (not yet active)
gutterpress theme revert ./my-book            # back to whichever theme was active before
gutterpress theme remove zine ./my-book       # drop a project theme (never a built-in)
```

`gutterpress new` applies its template's starter theme this same way, so even a
freshly scaffolded project has a real, switchable theme from the start — not a
one-off copy of its CSS. The resulting manifest entry looks like:

```yaml
styles:
  - "themes/clean-book/theme.css"   # The applied theme
  - "styles/book.css"               # Your own overrides (layered on top, empty until you write in it)
```

Bundled themes define the full token set (see below) so you only need to override the tokens you want to change. This guide's own project (the one you're reading) does not use a bundled theme — it declares its own `styles/guide.css` directly in `manifest.yaml`.

## CSS Custom Properties

Every built-in theme is driven by CSS custom properties. Override any of them
in your own stylesheet and the theme follows — no need to restyle elements.

These are the tokens **every** built-in theme defines, so overriding them works
whichever theme you started from:

```css
:root {
  /* Palette */
  --color-ink:        #1a1a1a;   /* body text                */
  --color-ink-muted:  #555555;   /* captions, secondary text */
  --color-accent:     #2b4c7e;   /* headings, links          */
  --color-paper:      #ffffff;   /* page background          */
  --color-rule:       #d9d9d9;   /* borders, rules           */

  /* Typography */
  --font-body:    "Georgia", serif;
  --font-display: "Georgia", serif;
  --font-mono:    "Menlo", monospace;

  /* Size */
  --fs-body: 11pt;      /* body copy — everything else scales from here */
  --fs-h1:   2.1rem;
  --fs-h2:   1.5rem;
  --fs-h3:   1.2rem;
  --leading: 1.55;
}
```

The values above are `clean-book`'s; each theme ships its own. A theme may add
tokens of its own beyond this set — `technical-doc`, for example, adds
`--color-tint` for its code and note fills. Open the `theme.css` that was
copied into your project to see everything a given theme exposes; the `:root`
block at the top is the whole vocabulary.

### Creating a custom theme

The fastest approach is a single CSS file with three sections:

```css
/* 1. Override brand tokens */
:root {
  --color-accent: #7b2f8a;   /* headings, links */
  --font-body:    "Garamond", serif;
  --fs-body:      11.5pt;
}

/* 2. Override page geometry */
@page { size: 6in 9in; margin: 0.75in; }

/* 3. Add component rules */
.my-special-block {
  background: #f3f5f9;
  border-left: 3pt solid var(--color-accent);
  padding: 0.5em 0.8em;
}
```

## Font Loading

Download the font into your project and load it with `@font-face` — this is
the only supported path. A remote `@import url("https://fonts.googleapis...")`
or a remote `@font-face src: url(...)` is a **build error**, not a warning:
Gutterpress's print-safety linter rejects any remote URL in CSS, because a font
fetched from the network at print time is a dependency the build can't
guarantee is still there (or unchanged) the next time someone builds this
book — offline, in CI, or a year from now. A downloaded, embedded font is
guaranteed to be the one that ships.

Put the font file anywhere in your project — there's no required location.
`url(...)` in `@font-face` resolves relative to the **stylesheet that
contains it**, not the manifest or project root, and Gutterpress embeds the font
into `book.html` automatically:

```css
@font-face {
  font-family: "MyFont";
  src: url("fonts/my-font-regular.woff2") format("woff2"),
       url("fonts/my-font-regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
}

:root { --font-body: "MyFont", serif; }
```

If the path doesn't resolve, the build fails immediately with the missing
file's name — instead of silently falling back to a system font that still
passes PDF validation, which is what used to happen.

## Custom Page Templates

Named pages let you apply different margins, backgrounds, or decorations to specific page types, using the CSS Paged Media `page` property together with a named `@page` rule:

```css
/* CSS: define the named page */
@page gallery {
  margin: 0.5in;
  @top-center { content: none; }
}
```

Writing `@page gallery` in *markdown* only sets `data-page="gallery"` on the page wrapper (see [Chapter 2, @page — start a new page](./02-writing-content.md)) — by itself it does **not** bind that wrapper to the `@page gallery` CSS rule above. You still need a CSS declaration that assigns the `page` property to something in your markup — the simplest option is to target the `data-page` attribute the marker already gives you:

```css
[data-page="gallery"] { page: gallery; }
```

```markdown
@page gallery

## Art Gallery

Images here get the gallery page treatment.
```

This guide's own cover page (`00-cover.md`) uses the same mechanism with a hand-written class instead of `data-page`:

```css
.cover-page { page: cover; }
```

## Page Setup CSS

### Running headers and footers

Gutterpress uses CSS margin boxes for headers and footers:

```css
h1 { string-set: chapter-title content(); }

@page :left {
  @top-left {
    content: string(chapter-title);
    font-size: 8pt;
    text-transform: uppercase;
  }
  @bottom-left {
    content: counter(page);
    font-size: 8pt;
  }
}

@page :right {
  @top-right {
    content: string(chapter-title);
    font-size: 8pt;
    text-transform: uppercase;
  }
  @bottom-right {
    content: counter(page);
    font-size: 8pt;
  }
}
```

### Widow and orphan control

`orphans`/`widows` control the minimum number of lines that must stay together at the top/bottom of a page break. Core Gutterpress sets **no default** — Chromium follows the CSS default of 2. This guide's own `guide.css` raises both to 3:

```css
body {
  orphans: 3;
  widows: 3;
}
```

### Print-specific break utilities

```css
/* Keep a block from splitting across pages */
.no-break {
  break-inside: avoid;
  page-break-inside: avoid;  /* legacy alias, older browsers */
}

/* Force a new page before an element */
.break-before {
  break-before: page;
  page-break-before: always;
}
```

## CSS Cascade Order

Stylesheets are applied in the order listed in `manifest.yaml`. Later files override earlier ones:

```yaml
styles:
  - "themes/clean-book/theme.css" # 1. Base theme (loaded first)
  - "styles/variables.css"        # 2. Token overrides
  - "styles/custom.css"           # 3. Component customizations
  - "styles/chapter-art.css"      # 4. Chapter-specific rules (last wins)
```

Gutterpress's own CSS sits underneath all of this in two cascade layers —
the marker structural CSS in `@layer gp.marker`, the `gp-*` utility
vocabulary in `@layer gp.vocab` — both declared before anything above. A
cascade layer always loses to unlayered CSS, so every stylesheet in
`styles:` (and anything loaded via `engineStyles.native`) beats core's
defaults automatically, at any specificity — even a bare element selector.
You never need `!important`, or an extra selector to inflate specificity,
just to beat a `gp-*` rule.

If your own theme is more than a couple of files, declare your own layer
order at the top of your first stylesheet instead of relying on the list
above:

```css
@layer tokens, base, components, templates, pages, book;
```

Every rule you place inside one of those layers then cascades by that fixed
order, not by which file the manifest happens to load last — so splitting a
file in two, or reordering `styles:`, can no longer silently flip who wins.

## Layout Marker CSS Classes

Each layout marker emits a predictable CSS class that you can style. This mirrors [Chapter 2's Layout Directives](./02-writing-content.md#layout-directives) — repeated here as a CSS-focused cheat sheet:

@section

| Marker | Emitted wrapper | CSS selector |
|--------|-----------------|---------------|
| `@chapter` | `<div class="chapter">` (+ `data-chapter-label` when given a bare label) | `.chapter` |
| `@spread` | `<div class="spread">` | `.spread` |
| `@page` | `<div class="page">` | `.page` |
| `@page-break` | `<div class="gp-page-break">` (no page wrapper) | `.gp-page-break` |
| `@section` | `<div class="section">` | `.section` |
| `@continue` | `<div class="section gp-continued">` | `.section.gp-continued` |
| `@column-break` | `<div class="gp-column-break">` (or a `.col` boundary — see [`.col-split`](./02-writing-content.md#col-split--a-fixed-hard-authored-column-split)) | `.gp-column-break` |

Note: `@section` emits `.section`, never `.region`; `@page-break` emits `.gp-page-break`, never `.md-break`.

@end-section

## Component Customization

### Tables

```css
/* Compact table for dense reference pages */
.chapter#ch-reference table {
  font-size: 8pt;
}

/* Fixed-layout for flag reference tables */
.chapter#ch-cli table {
  table-layout: fixed;
}
.chapter#ch-cli td:first-child { width: 26%; }
```

### Code blocks

```css
/* Tighter code spacing inside a reference chapter */
.chapter#ch-reference pre {
  margin: 0.4em 0 0.6em;
}
```

### Scoping with chapter IDs

A `<div class="chapter" id="ch-name">` wrapper comes from `@chapter #ch-name` — **not** from `@page`. `@page #id` produces `<div class="page" id="...">`, which is a different element with a different class; a `.chapter#ch-bestiary` selector will not match anything inside a `@page`-only wrapper. Use `@chapter` when you want the `.chapter` scoping hook:

```markdown
@chapter #ch-bestiary

# Bestiary
```

```css
.chapter#ch-bestiary table { font-size: 8pt; }
.chapter#ch-bestiary h2    { color: #2f8a6b; }
```

## Debugging Styles

Run the preview and open browser DevTools:

```bash
gutterpress preview ./my-book
# Open http://localhost:3579 in Chrome
# Right-click → Inspect to view computed styles
```

Common issues:

- **Token not applying** — check spelling; `--color-accnt` vs `--color-accent`
- **Override not winning** — check cascade order in `manifest.yaml`; later files win
- **Font not loading** — check file path is relative to the CSS file, not the manifest
- **Page break in wrong place** — inspect the generated `book.html` to see which `@page` wrapper the content is inside
