# Design Guide

<div class="lede">This is the visual reference for <em>Your Book Title</em>. It documents the typography, color palette, components, and page templates — a single source of truth for authors, editors, and designers.</div>

This guide renders with the same stylesheet and page geometry as the book itself. Every specimen you see here is exactly what the book ships.

## What's in this guide

| Chapter | Contents |
|---------|----------|
| **Typography** | Type scale, headings, body, inline elements |
| **Color Palette** | Brand tokens with hex values and usage rules |
| **Components** | Callouts, sidebars, pull quotes, spec blocks |
| **Page Templates** | Cover, chapter opener, full-bleed spread |
| **Layout** | Multi-column, image floats, utilities |
| **Markdown Reference** | Every print-md syntax feature with live examples |
| **CLI Reference** | Build, preview, and publish commands |

## How to make this your own

### 1. Copy the directory

```
cp -r examples/with-design-guide/design-guide  my-project/design-guide
```

### 2. Edit the brand tokens

Open `styles/guide.css` and update **§ 1 BRAND TOKENS** at the top. Every rule inherits from these variables — a full rebrand is a single section edit.

```css
:root {
  --color-accent:      #1b4f8a;   /* your primary brand color      */
  --color-accent-alt:  #c0532a;   /* your secondary / highlight    */
  --color-ink:         #1a1a2e;   /* body text                     */
  --font-body:    "Georgia", serif;
  --font-display: "Helvetica Neue", sans-serif;
}
```

### 3. Preview live

```
print-md preview design-guide --port 3580
```

### 4. Delete what you don't need

The guide is most useful when it only documents what you actually use. Remove any component or template section that your book doesn't ship.

### 5. Publish

```
# Static HTML site (GitHub Pages, Netlify, etc.)
print-md build design-guide --format html --out ./_site

# PDF download to bundle alongside
print-md build design-guide --format pdf --out ./_site/guide.pdf
```

## Project structure

```
design-guide/
├── manifest.yaml         ← file list, page geometry, stylesheet
├── styles/guide.css      ← single stylesheet shared by book + guide
├── 00-overview.md        ← this file
├── 01-typography.md
├── 02-palette.md
├── 03-components.md
├── 04-page-templates.md
├── 05-layout.md
└── 06-markdown-reference.md
```

## Download

[Download PDF](guide.pdf){.download}
