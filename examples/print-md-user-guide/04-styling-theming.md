# Styling & Theming {#ch-styling}

<div class="lede">Print-md uses plain CSS for all styling. Control colors, fonts, and layout through CSS custom properties. Add your own stylesheets on top of any built-in theme.</div>

## Built-in Themes

Declare themes in `manifest.yaml` using the `styles` key. Built-in theme files are bundled with Print-md and available by name:

```yaml
styles:
  - "themes/classic.css"    # Bundled theme
  - "styles/custom.css"     # Your overrides (layered on top)
```

Bundled themes cover common use cases out of the box and define the full token set so you only need to override the tokens you want to change.

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

### Web fonts (from a URL)

```css
@import url("https://fonts.googleapis.com/css2?family=Lato:wght@400;700");

:root {
  --font-display: "Lato", sans-serif;
}
```

> **Print note:** Fonts loaded from URLs require network access during the build. For offline builds or reproducible CI, use local fonts instead.

### Local fonts

Copy font files into your project and load with `@font-face`:

```css
@font-face {
  font-family: "MyFont";
  src: url("../fonts/my-font-regular.woff2") format("woff2"),
       url("../fonts/my-font-regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
}

:root { --font-body: "MyFont", serif; }
```

## Custom Page Templates

Named pages let you apply different margins, backgrounds, or decorations to specific page types. Declare them with `@page name` in CSS and apply with `@page name` in markdown.

```css
/* CSS: define the named page */
@page gallery {
  margin: 0.5in;
  background: var(--color-tint);
  @top-center { content: none; }
}
```

```markdown
@page gallery

## Art Gallery

Images here get the gallery page treatment.
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

Set minimum lines before a page break. The default in Print-md is 4:

```css
body {
  orphans: 4;
  widows: 4;
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
  - "themes/classic.css"     # 1. Base theme (loaded first)
  - "styles/variables.css"   # 2. Token overrides
  - "styles/custom.css"      # 3. Component customizations
  - "styles/chapter-art.css" # 4. Chapter-specific rules (last wins)
```

## Layout Marker CSS Classes

Each layout marker emits a predictable CSS class that you can style:

@section

| Marker | Emitted HTML | CSS Class |
|--------|-------------|-----------|
| `@page` | `<div class="page">` | `.page` |
| `@page chapter` | `<div class="page chapter">` | `.page.chapter` |
| `@section` | `<div class="region">` | `.region` |
| `@spread` | `<div class="spread">` | `.spread` |
| `@page-break` | `<div class="md-break">` | `.md-break` |
| `@column-break` | `<div class="md-column-break">` | `.md-column-break` |

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

Each chapter gets a `<div class="chapter" id="ch-name">` wrapper when you use `@page` or `@chapter` markers. Use it to scope overrides:

```markdown
@page #ch-bestiary

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
# Open http://localhost:3000 in Chrome
# Right-click → Inspect to view computed styles
```

Common issues:

- **Token not applying** — check spelling; `--color-accnt` vs `--color-accent`
- **Override not winning** — check cascade order in `manifest.yaml`; later files win
- **Font not loading** — check file path is relative to the CSS file, not the manifest
- **Page break in wrong place** — inspect the generated `book.html` to see which `@page` wrapper the content is inside
