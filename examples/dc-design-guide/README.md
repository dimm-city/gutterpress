# Dimm City — Design Guide

The canonical design reference for the Dimm City brand system. Built with
[print-md](../../README.md) and [Paged.js](https://pagedjs.org), it renders to a
print-quality PDF on US Letter (8.5 × 11 in) paper.

This is not just documentation — it is the gold-standard example of a custom
design guide in print-md. Every pattern, token, and component documented here is
live-rendered from the same CSS that would ship with a production Dimm City book.

## Preview

```sh
# From the print-md root
bun src/cli.ts preview examples/dc-design-guide --port 3590
```

Open `http://localhost:3590` — changes to any `.md` or `.css` file hot-reload in the
browser.

## What's Inside

| File | Content |
|---|---|
| `00-overview.md` | System overview and CSS architecture summary |
| `01-typography.md` | Type scale, font families, heading hierarchy |
| `02-palette.md` | Color tokens, surface tokens, border tokens, usage rules |
| `03-components.md` | Core print-md components (callouts, tables, pull quotes) |
| `04-dc-components.md` | DC-brand components (skill cards, stat blocks, AP tags, specialty system) |
| `05-page-templates.md` | Page type system — TOC, chapter-start, citizen file, full-bleed |
| `06-layout.md` | Multi-column layout, grid patterns, card arrays |
| `07-markdown-reference.md` | Container syntax, `@chapter` macro, plugin markers |
| `08-field-guide-components.md` | Field-guide-specific components (gear entries, definition blocks, colophon) |
| `101-publishing.md` | PDF export, print preflight, CMYK notes |

## CSS Architecture

The stylesheet cascade is a strict four-file hierarchy:

```
css/
├── index.css              ← imports in layer order
├── dc-brand.css           ← tokens (:root), fonts, all .dc-* components
├── page-rules.css         ← @page rules, named pages, counters
├── content-templates.css  ← Paged.js wrappers, .page.* layout
└── guide.css              ← specimen styles scoped to div.chapter
```

See [`CSS-PATTERNS.md`](CSS-PATTERNS.md) for the full architecture reference —
layer contracts, token conventions, markdown-friendly selector strategies, and
Paged.js-specific patterns. See [`CSS-AUDIT.md`](CSS-AUDIT.md) for the audit
history and outstanding items.

## Reference Documents

| Document | Purpose |
|---|---|
| [`CSS-PATTERNS.md`](CSS-PATTERNS.md) | Normative CSS architecture and authoring patterns |
| [`CSS-AUDIT.md`](CSS-AUDIT.md) | Token hygiene, layer violations, and compliance history |
| [`CSS-ARCHITECTURE.md`](CSS-ARCHITECTURE.md) | Structural refactor roadmap and session history |

## Adapting This Design Guide

To start a new project based on the DC brand:

1. Copy the `css/` folder into your project.
2. Create `css/project-overrides.css` and add it as the last import in `index.css`.
3. Override tokens in `project-overrides.css` — do not edit `dc-brand.css` directly.
4. The `--pmd-viewer-sheet-bg` token controls the page background color in the
   print-md preview; set it to your page background color.

```css
/* css/project-overrides.css */
:root {
  --bg:                  #1a1715;  /* dark page background */
  --pmd-viewer-sheet-bg: var(--bg);
  --paper-cream:         #e8e0d0;  /* adjusted cream for dark substrate */
}
```

## Brand Palette

| Role | Token | Value |
|---|---|---|
| Primary accent | `--crimson` | `#d41200` |
| Heading | `--blood` | `#a30900` |
| Banner background | `--rust` | `#c23000` |
| HUD chrome | `--hud-blue` | `#2a6a8a` |
| Page canvas | `--bg` | `#d4d4d4` |
| Card surface | `--paper-cream` | `#f5f0e6` |
| Primary text | `--ink` | `#1a1715` |

## Plugin

The `dimm-city-plugin.js` in `plugins/` processes three custom markers:

- `@skill` — wraps skill-card content blocks
- `@specialty` — wraps specialty opener pages
- `@learning-path` — wraps learning path card sequences

These markers are specific to the Dimm City Field Guide. A plain print-md project
does not need them — remove the `plugins:` entry from `manifest.yaml` and the
`dimm-city-plugin.js` reference.
