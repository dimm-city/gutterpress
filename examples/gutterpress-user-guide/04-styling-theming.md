# Styling & Theming {#ch-styling}

@section .lede

Gutterpress uses plain CSS for all styling. Control colors, fonts, and layout through CSS custom properties. A book's **look** is an extension — a folder of stylesheets listed in the manifest — and your own stylesheets always load on top of it.

@end-section

## Built-in Looks

Gutterpress ships three built-in looks, embedded in the CLI binary and library:

| Look id | Description |
|----------|-------------|
| `clean-book` | A calm, classic book look: serif body, generous margins, restrained accents. |
| `zine` | High-contrast, punchy sans-serif look for short photocopier-friendly zines. |
| `technical-doc` | Clean sans-serif manual look with clear hierarchy, code styling, and tidy tables. |

A look (a *theme*, in older docs and in `gutterpress new --kind theme`) is an
**extension**: a folder holding a stylesheet — `theme.css` — plus a small
metadata file, listed in the manifest's `extensions:` list alongside any
plugins ([Chapter 5](#ch-plugins) covers that list in full).

Adding a built-in look **copies** it into your project at `extensions/<id>/`,
so the book owns editable files rather than a hidden dependency on whichever
Gutterpress version happens to be installed, and adds `./extensions/<id>` to
the list:

```sh
gutterpress ext add clean-book ./my-book --look   # copy the built-in look in and list it
gutterpress ext list ./my-book                    # every extension, in load (= cascade) order
```

`gutterpress new` does exactly this with its template's starter look, so even
a freshly scaffolded project has a real, editable look from the start. The
resulting manifest reads:

```yaml
extensions:
  - ./extensions/clean-book   # The look: extensions/clean-book/theme.css
styles:
  - styles/book.css           # Your own overrides, loaded after every extension
```

`styles/book.css` starts as a comment block explaining this split. It is the
project's own layer: everything under `styles:` loads after every extension,
so a rule you write there overrides the look at equal specificity. Edit
`extensions/clean-book/theme.css` directly when you want to change the look
itself — it is your copy.

### Adding and switching looks

Any of these adds a look to the list:

```sh
gutterpress ext add zine ./my-book --look                     # another built-in (copied to extensions/zine/)
gutterpress ext add ./house-style ./my-book                   # a folder you already have — referenced in place, never copied
gutterpress ext add ./parchment.zip ./my-book                 # a packaged look → extensions/parchment/
gutterpress ext add ./parchment.css ./my-book                 # a single stylesheet → extensions/parchment/
gutterpress ext add https://example.com/looks/cool/ ./my-book # theme.css (+ optional theme.json) fetched → extensions/cool/
```

Zip, CSS and URL imports are checked before they land: every declared sheet
must exist and parse, and print-safety findings (a remote `url()`, say) are
reported as warnings. A look with fonts or images of its own travels as a
folder or a `.zip`; a URL import fetches only the stylesheet and metadata.

Two looks listed at once both load, and the later one wins ties — so
switching is adding the new look, then disabling or removing the old one:

```sh
gutterpress ext add zine ./my-book --look
gutterpress ext disable ./extensions/clean-book ./my-book   # keep it around, stop loading it
gutterpress ext remove ./extensions/clean-book ./my-book    # or drop the entry (the folder stays yours)
```

The desktop app's **Project settings → Look** view is the same list: add a
look, drag entries into a new order, switch one off, or remove it. There is no
separate apply or revert step — a look is just an entry, and the snapshot
history versions the manifest change like any other edit.

Bundled looks define the full token set (see below) so you only need to
override the tokens you want to change. This guide's own project (the one
you're reading) does not use a bundled look — it declares its own
`styles/guide.css` directly under `styles:` in `manifest.yaml`.

## CSS Custom Properties

Every built-in look is driven by CSS custom properties. Override any of them
in your own stylesheet and the look follows — no need to restyle elements.

These are the tokens **every** built-in look defines, so overriding them works
whichever look you started from:

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

The values above are `clean-book`'s; each look ships its own. A look may add
tokens of its own beyond this set — `technical-doc`, for example, adds
`--color-tint` for its code and note fills. Open `extensions/<id>/theme.css`
in your project to see everything a given look exposes; the `:root` block at
the top is the whole vocabulary.

### Creating a custom look

For one book, the fastest approach is three sections in `styles/book.css`:

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

To reuse a look across books, make it a folder. Any folder with a `theme.css`
is already a valid one-sheet look, and `gutterpress new "House Style" --kind
theme` scaffolds a layered six-sheet one with a `gutterpress.json`; either
way `gutterpress ext add ./house-style <book>` lists it, referenced in place.

### Looks with more than one stylesheet

A look folder is not limited to one `theme.css`. Its `gutterpress.json` (the
older `theme.json` name is still read) can declare an ordered list of sheets
and which sheet holds the tokens the Design panel edits:

```json
{
  "name": "Dimm City",
  "styles": ["css/tokens.css", "css/core.css", "css/components.css", "css/book.css"],
  "tokensFile": "css/tokens.css"
}
```

Paths are relative to the look's folder and must stay inside it. The sheets
load in that order at the look's position in `extensions:` — one entry,
however many files — and a sheet that must win over the others simply goes
last in the list. Disabling or removing the entry removes them all. A
metadata file without `styles` means `["theme.css"]`, so existing looks need
no change, and `tokensFile` defaults to the first entry in `styles`. A folder
that declares `styles` needs no `theme.css` at all; a `.zip` or URL import
still needs one to find the package root.

The other metadata fields are `author`, `description`, `preview` (an image,
relative to the folder), and — for a look that is also a plugin or a component
library — `markdown`, `snippets` and `components`. [Chapter 5](#ch-plugins)
covers those.

## Font Loading {#font-loading}

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

Writing `@page gallery` in *markdown* only sets `data-page="gallery"` on the page wrapper (see [Chapter 2, @page — start a new page](#ch-writing)) — by itself it does **not** bind that wrapper to the `@page gallery` CSS rule above. You still need a CSS declaration that assigns the `page` property to something in your markup — the simplest option is to target the `data-page` attribute the marker already gives you:

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

Extensions load first, in `extensions:` order, then your own `styles:` in their order. Later files override earlier ones:

```yaml
extensions:
  - "./extensions/clean-book"     # 1. The look (loaded first)
  - "./plugins/callouts"          # 2. A plugin's component CSS (wins ties over the look)
styles:
  - "styles/variables.css"        # 3. Token overrides
  - "styles/custom.css"           # 4. Component customizations
  - "styles/chapter-art.css"      # 5. Chapter-specific rules (last wins)
```

Gutterpress's own CSS sits underneath all of this in two cascade layers —
the marker structural CSS in `@layer gp.marker`, the `gp-*` utility
vocabulary in `@layer gp.vocab` — both declared before anything above. A
cascade layer always loses to unlayered CSS, so every extension stylesheet
and every stylesheet in `styles:` beats core's defaults automatically, at any
specificity — even a bare element selector.
You never need `!important`, or an extra selector to inflate specificity,
just to beat a `gp-*` rule.

If your own look is more than a couple of files, declare your own layer
order at the top of your first stylesheet instead of relying on the list
above:

```css
@layer tokens, base, components, templates, pages, book;
```

Every rule you place inside one of those layers then cascades by that fixed
order, not by which file the manifest happens to load last — so splitting a
file in two, or reordering `styles:`, can no longer silently flip who wins.

## Layout Marker CSS Classes

Each layout marker emits a predictable CSS class that you can style. This mirrors [Chapter 2's Layout Directives](#layout-directives) — repeated here as a CSS-focused cheat sheet:

@section

| Marker | Emitted wrapper | CSS selector |
|--------|-----------------|---------------|
| `@chapter` | `<div class="chapter">` (+ `data-chapter-label` when given a bare label) | `.chapter` |
| `@spread` | `<div class="spread">` | `.spread` |
| `@page` | `<div class="page">` | `.page` |
| `@page-break` | `<div class="gp-page-break">` (no page wrapper) | `.gp-page-break` |
| `@section` | `<div class="section">` | `.section` |
| `@continue` | `<div class="section gp-continued">` | `.section.gp-continued` |
| `@column-break` | `<div class="gp-column-break">` | `.gp-column-break` |

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
- **Override not winning** — check cascade order in `manifest.yaml`: extensions in list order, then `styles:`; later files win
- **Font not loading** — check file path is relative to the CSS file, not the manifest
- **Page break in wrong place** — inspect the generated `book.html` to see which `@page` wrapper the content is inside
