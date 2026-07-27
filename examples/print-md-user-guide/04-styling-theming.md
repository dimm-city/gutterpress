# Styling & Theming {#ch-styling}

<div class="lede">Print-md uses plain CSS for all styling. Control colors, fonts, and layout through CSS custom properties. Add your own stylesheets on top of any built-in theme.</div>

## Built-in Themes

Print-md ships four built-in themes, embedded in the CLI binary and library:

| Theme id | Description |
|----------|-------------|
| `clean-book` | A calm, classic book look: serif body, generous margins, restrained accents. |
| `ttrpg-supplement` | Bold display headings, warm parchment fills, and boxed stat blocks for game books. |
| `zine` | High-contrast, punchy sans-serif look for short photocopier-friendly zines. |
| `technical-doc` | Clean sans-serif manual look with clear hierarchy, code styling, and tidy tables. |

Applying a theme **copies** its `theme.css` (and any bundled fonts/assets) into your project at `themes/<id>/`, so the project carries its own copy with no external path dependency, and wires the matching `styles:` entry into `manifest.yaml` for you. Today that apply/import flow lives in the desktop viewer's Theme panel; the resulting manifest entry looks like:

```yaml
styles:
  - "themes/clean-book/theme.css"   # Applied via the viewer's Theme panel
  - "styles/custom.css"             # Your overrides (layered on top)
```

Bundled themes define the full token set (see below) so you only need to override the tokens you want to change. This guide's own project (the one you're reading) does not use a bundled theme — it declares its own `styles/guide.css` directly in `manifest.yaml`.

## CSS Custom Properties

The entire design system is driven by CSS custom properties defined on `:root`. Override any token in your own stylesheet:

```css
:root {
  /* Palette */
  --color-ink:         #1a1a2e;
  --color-ink-muted:   #4a4a66;
  --color-accent:      #1b4f8a;
  --color-accent-alt:  #c0532a;
  --color-paper:       #ffffff;
  --color-tint:        #f0f4fa;
  --color-rule:        #d0d4e8;

  /* Typography */
  --font-body:    "Georgia", serif;
  --font-display: "Helvetica Neue", sans-serif;
  --font-mono:    "Menlo", monospace;

  /* Type Scale */
  --fs-h1:    24pt;
  --fs-h2:    16pt;
  --fs-h3:    13pt;
  --fs-h4:    11pt;
  --fs-body:  11pt;
  --fs-small:  9pt;
  --fs-micro:  8pt;
}
```

### Creating a custom theme

The fastest approach is a single CSS file with three sections:

```css
/* 1. Override brand tokens */
:root {
  --color-accent:     #7b2f8a;   /* your primary color */
  --color-accent-alt: #2f8a6b;   /* your secondary     */
  --font-body: "Garamond", serif;
}

/* 2. Override page geometry */
@page { size: 6in 9in; margin: 0.75in; }

/* 3. Add component rules */
.my-special-block {
  background: var(--color-tint);
  border-left: 3pt solid var(--color-accent);
  padding: 0.5em 0.8em;
}
```

## Font Loading

Download the font into your project and load it with `@font-face` — this is
the only supported path. A remote `@import url("https://fonts.googleapis...")`
or a remote `@font-face src: url(...)` is a **build error**, not a warning:
print-md's print-safety linter rejects any remote URL in CSS, because a font
fetched from the network at print time is a dependency the build can't
guarantee is still there (or unchanged) the next time someone builds this
book — offline, in CI, or a year from now. A downloaded, embedded font is
guaranteed to be the one that ships.

Put the font file anywhere in your project — there's no required location.
`url(...)` in `@font-face` resolves relative to the **stylesheet that
contains it**, not the manifest or project root, and print-md embeds the font
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
  background: var(--color-tint);
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

Paged.js uses CSS margin boxes for headers and footers:

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

`orphans`/`widows` control the minimum number of lines that must stay together at the top/bottom of a page break. Core print-md sets **no default** — Paged.js follows the CSS default of 2. This guide's own `guide.css` raises both to 3:

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
  page-break-inside: avoid;  /* Paged.js legacy */
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

## Layout Marker CSS Classes

Each layout marker emits a predictable CSS class that you can style. This mirrors [Chapter 2's Layout Directives](./02-writing-content.md#layout-directives) — repeated here as a CSS-focused cheat sheet:

@section

| Marker | Emitted wrapper | CSS selector |
|--------|-----------------|---------------|
| `@chapter` | `<div class="chapter">` (+ `data-chapter-label` when given a bare label) | `.chapter` |
| `@spread` | `<div class="spread">` | `.spread` |
| `@page` | `<div class="page">` | `.page` |
| `@page-break` | `<div class="md-page-break">` (no page wrapper) | `.md-page-break` |
| `@section` | `<div class="section">` | `.section` |
| `@continue` | `<div class="section pmd-continued">` | `.section.pmd-continued` |
| `@column-break` | `<div class="md-column-break">` (or a `.col` boundary inside `.col-split`) | `.md-column-break` |

Note: `@section` emits `.section`, never `.region`; `@page-break` emits `.md-page-break`, never `.md-break`.

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
.chapter#ch-bestiary table { font-size: var(--fs-micro); }
.chapter#ch-bestiary h2    { color: var(--color-accent-alt); }
```

## Debugging Styles

Run the preview and open browser DevTools:

```bash
print-md preview ./my-book
# Open http://localhost:3579 in Chrome
# Right-click → Inspect to view computed styles
```

Common issues:

- **Token not applying** — check spelling; `--color-accnt` vs `--color-accent`
- **Override not winning** — check cascade order in `manifest.yaml`; later files win
- **Font not loading** — check file path is relative to the CSS file, not the manifest
- **Page break in wrong place** — inspect the generated `book.html` to see which `@page` wrapper the content is inside
