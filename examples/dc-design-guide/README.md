# Dimm City — Design Guide

The canonical design reference for the Dimm City brand system. Built with
[print-md](../../README.md) and [Paged.js](https://pagedjs.org), it renders to a
print-quality PDF on US Letter (8.5 × 11 in) paper.

This is not just documentation — it is the gold-standard example of a custom
design guide in print-md. Every pattern, token, and component documented here is
live-rendered from the same CSS that would ship with a production Dimm City book.

**This design guide is the source of truth for the DC print system.** Any
discrepancy between what is documented here and what the CSS or plugin produces
means the code is wrong. Once the guide is complete, all CSS, plugin, and field
guide changes must be validated against it.

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
| **Part 2 — Field Guide in Action** | |
| `300-example-overview.md` | Part 2 intro — how to read the real-world examples |
| `301-example-front-matter.md` | Credits, TOC, intro pages — real field guide content |
| `302-example-chapter-opener.md` | Chapter start spreads |
| `303-example-specialty-overview.md` | Specialty chapter intro and card grid |
| `304-example-specialty-profile.md` | Full specialty profile with skills |
| `305-example-rules.md` | Rules and mechanics pages |
| `306-example-dm-npcs.md` | Dream Master pages, NPC stat blocks |
| `307-example-gear-tech.md` | Gear, aug cards, cybernetics |

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

See [`docs/CSS-PATTERNS.md`](docs/CSS-PATTERNS.md) for the full architecture
reference — layer contracts, token conventions, markdown-friendly selector strategies,
and Paged.js-specific patterns.

## Reference Documents

| Document | Purpose |
|---|---|
| [`docs/CSS-PATTERNS.md`](docs/CSS-PATTERNS.md) | Normative CSS architecture and authoring patterns |
| [`docs/field-guide-cleanup.md`](docs/field-guide-cleanup.md) | Field-guide migration notes — dc-* prefix adoption |

## Adapting This Design Guide

To start a new project based on the DC brand:

1. Copy the `css/` folder into your project.
2. Create `css/project-overrides.css` and add it as the last import in `index.css`.
3. Override tokens in `project-overrides.css` — do not edit `dc-brand.css` directly.
4. Override `--bg` to change the page background color. `content-templates.css` sets
   `.pagedjs_sheet { background-color: var(--bg) }` directly — no additional hook
   variable is needed.

```css
/* css/project-overrides.css */
:root {
  --bg:          #1a1715;  /* dark page background */
  --paper-cream: #e8e0d0;  /* adjusted cream for dark substrate */
}
```

## Brand Palette

| Role | Token | Value |
|---|---|---|
| Primary accent | `--crimson` | `#d41200` |
| Heading | `--blood` | `#a30900` |
| Banner background | `--rust` | `#c23000` |
| HUD chrome | `--hud-blue` | `#2a6a8a` |
| Page canvas | `--bg` | `#d3cec6` |
| Card surface | `--paper-cream` | `#f5f0e6` |
| Primary text | `--ink` | `#1a1715` |

## Plugin

`plugins/dimm-city-plugin.js` is a server-side markdown-it plugin that extends
print-md with Dimm City-specific authoring macros. It processes markers in the
markdown source during the build step and emits structured HTML.

### Implemented macros

| Marker | Emits | Purpose |
|---|---|---|
| `@chapter #id .class` | `<div class="chapter ...">` | Chapter wrapper with CSS class and data attributes |
| `@page .class` | `<div class="page ...">` | Named page break with CSS classes |
| `@section .class` | `<div class="region ...">` | Grouped content region |
| `@spread .class` | `<div class="spread ...">` | Two-page spread container |
| `@break` | `<div class="md-break">` | Hard page break |
| `@specialty {.class}` | Specialty section wrapper | Chapter-02 specialty opener and skill card sequence |
| `@learning-path` | Learning path banner + card group | Groups `@skill` cards under a spray-banner header |
| `@skill variant="N"` | Skill card (clip-path variant 1–5) | Individual skill card with tab, flavor, and abilities |
| `@continue` | Card continuation marker | Splits an oversized skill card across a page break |
| `@outcome` | Five-rung d20 outcome ladder | Crit / Hit / Mixed / Miss / Catastrophe table |
| `@chapter-opener C.N` | Chapter number badge | Opener spread chapter number for non-specialty chapters |

### Planned macros (triple-colon containers to be replaced)

These `:::` container patterns work today but will be replaced by named macros
in a future plugin update:

| Current syntax | Planned macro |
|---|---|
| `:::sidebar` | `@sidebar` |
| `:::lede` | `@lede` |
| `:::pull-quote` | `@pullquote` |
| `:::procedure` | `@procedure` |
| `:::two-column` / `:::: two-column` | `@two-column` |
| `:::wrapper {.dc-definition-block}` | `@definition` |
| `:::wrapper {.dc-sidebar-box}` | `@sidebar-box` |

### Class naming convention

All classes emitted by the plugin use the `dc-` prefix. The only exception is
`.scream` (the ROLL THE DIE! inline span), which is intentionally unprefixed.
When adding new output, always verify a matching CSS rule exists before shipping.

### Per-page styling

Use `@page .class-name` for layout specifics unique to a single page — image
position, column arrangement, decorative placement. A class used only once is
correct and intentional; it is not an anti-pattern.
