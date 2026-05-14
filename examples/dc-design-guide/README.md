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
| `05-page-templates.md` | Page type system — TOC, chapter-start, specialty spreads, full-bleed |
| `06-layout.md` | Multi-column layout, grid patterns, card arrays |
| `07-markdown-reference.md` | Container syntax, `@chapter` macro, plugin markers |
| `08-field-guide-components.md` | Field-guide-specific components (gear entries, definition blocks, sidebar boxes) |
| `101-publishing.md` | PDF export, print preflight, CMYK notes |
| **Part 2 — Field Guide in Action** | |
| `300-example-overview.md` | Part 2 intro — how to read the real-world examples |
| `301-example-front-matter.md` | Credits, TOC, intro pages — real field guide content |
| `302-example-chapter-opener.md` | Chapter start spreads |
| `303-example-specialty-overview.md` | Specialty chapter intro and card grid |
| `304-example-specialty-profile.md` | Full specialty profile with skills |
| `305-example-rules.md` | Rules and mechanics pages |
| `306-example-dm-npcs.md` | Dream Master pages, NPC stat blocks |
| `307-example-gear-tech.md` | Gear, cybernetics, and rules tables |

## CSS Architecture

The stylesheet cascade uses a five-file stack with strict layer ownership:

```
css/
├── index.css              ← imports in layer order
├── tokens.css             ← :root tokens, @font-face, html/body baseline, element resets
├── components.css         ← every .dc-* and .pmd-* component (base + thin variants)
├── page-templates.css     ← all columns:N rules (exclusive), .page.* layouts, paged wrapper scaffolding
├── page-rules.css         ← @page declarations, named pages, Paged.js counter fixes
└── guide.css              ← div.chapter scaffolding, .specimen chrome, guide-only rules
```

`dc-brand.css` no longer exists. All `.dc-*` component rules live in `components.css`.

See [`docs/CSS-PATTERNS.md`](docs/css-architecture.md) for the full architecture
reference — layer contracts, token conventions, markdown-friendly selector strategies,
and Paged.js-specific patterns.

## Reference Documents

| Document | Purpose |
|---|---|
| [`docs/CSS-PATTERNS.md`](docs/css-architecture.md) | Normative CSS architecture and authoring patterns |
| [`docs/ADDING-MACROS.md`](docs/adding-macros.md) | Short how-to for adding plugin macros and matching dc-prefixed component CSS |
| [`docs/field-guide-cleanup.md`](docs/field-guide-cleanup.md) | Field-guide migration notes — dc-* prefix adoption |

## Adapting This Design Guide

To start a new project based on the DC brand:

1. Copy the `css/` folder into your project.
2. Create `css/project-overrides.css` and add it as the last import in `index.css`.
3. Override tokens in `project-overrides.css` — do not edit `tokens.css` directly.
4. Override `--bg` to change the page background color. `page-rules.css` sets
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
| `@section #id .class` | `<div class="region ...">` | Grouped content region |
| `@spread #id .class` | `<div class="spread ...">` | Two-page spread container |
| `@break` | `<div class="md-break">` | Hard page break |
| `@specialty {.class}` | Specialty section wrapper | Chapter-02 specialty opener and skill card sequence |
| `@sidebar` | Sidebar callout | Floating reference/sidebar content |
| `@sidebar-box` | Sidebar box callout | Cream boxed aside with heading + dashed divider |
| `@learning-path` | Learning path banner + card group | Groups `@skill` cards under a spray-banner header |
| `@skill variant="N"` | Skill card (root-owned clip-path variant 1–5) | Individual skill card with tab, flavor, and abilities |
| `@procedure` | Numbered procedure block | Ordered list rendered as `dc-steps` |
| `@definition` | Definition callout | Italic definition block with left rule |
| `@continue` | Card continuation marker | Splits an oversized skill card across a page break |
| `@outcome` | Five-rung d20 outcome ladder | Crit / Hit / Mixed / Miss / Catastrophe table |
| `@chapter-opener C.N` | Chapter number badge | Opener spread chapter number for non-specialty chapters |

### Remaining migration work

These authoring patterns still have migration work remaining in older
container-heavy field-guide source:

| Current syntax | Canonical replacement path |
|---|---|
| `:::sidebar` / `:::wrapper {.dc-sidebar}` | `@sidebar` |
| `:::wrapper {.dc-sidebar-box}` | `@sidebar-box` |
| `:::procedure` | `@procedure` |
| `:::wrapper {.dc-definition-block}` | `@definition` |
| `:::pull-quote` / `:::wrapper {.dc-pullquote}` | `> [!PULLQUOTE]` |
| `:::wrapper {.two-column...}` / `:::wrapper {.two-column-list}` | `@section .two-column ...` |
| `:::lede` | Keep `:::lede` for now; no shipped `@lede` macro yet |
| `:::three-column` | `@three-column` |

Note: `@spread` is still available for real two-page spread layouts, but the
choose-specialty catalog no longer uses a dedicated spread wrapper. That grid is
now owned directly by `.page.choose-specialty`.

### Component System Rule

Reusable Dimm City components should be implemented as dc-prefixed base classes with thin variant overrides.

- One real base class owns the full default shell for a component.
- Variant classes should only override the few properties that actually change, such as surface, accent, border color, label text, or title treatment.
- CSS custom properties are allowed only when they form a small documented public API.
- Do not expose internal layout details like margin, padding, width, line-height, or break behavior as broad variable APIs by default.
- Existing markdown/macros can remain stable while emitted classes become thin wrappers over the canonical dc-prefixed base class.

Current reference implementation:
- The alert/callout family should use `.dc-alert` as the shell and thin variant classes layered on top.

Important distinction:
- `.dc-skill-card`, `.dc-path-shell`, and `.dc-specialty-card` are three different components. They may share visual language, but they should not be collapsed into one fake component family with a large internal variable API.

### Class naming convention

All classes emitted by the plugin use the `dc-` prefix. The only exception is
`.scream` (the ROLL THE DIE! inline span), which is intentionally unprefixed.
When adding new output, always verify a matching CSS rule exists before shipping.

### Per-page styling

Use `@page .class-name` for layout specifics unique to a single page — image
position, column arrangement, decorative placement. A class used only once is
correct and intentional; it is not an anti-pattern.
