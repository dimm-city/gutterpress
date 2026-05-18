@chapter #ch-toc .toc.guide-toc

# Dimm City Design Guide

@lede

This is the Dimm City print design system — cyberpunk and creaturepunk, built on print-md. Everything in these pages is live: the type, color, and components you see here are rendered through the same CSS as the Field Guide. The guide has two parts: **Part 1** is the implementation reference — token tables, CSS specs, and syntax you reach for while building. **Part 2** is real Field Guide pages rendered through that same CSS — see how all the pieces come together in an actual book.

@end-lede

<div class="dc-toc">

## Part 1 — Implementation Reference

<ol>
<li><a href="#ch-overview">Design System Overview</a> — how to use this guide</li>
<li><a href="#ch-typography">Typography</a> — display, mono, body; type scale</li>
<li><a href="#ch-palette">Color Palette</a> — paper, fire, HUD, surface tokens</li>
<li><a href="#ch-components">Core Components</a> — callouts, pull quotes, tables</li>
<li><a href="#ch-dc-components">DC Component Library</a> — skill cards, stat blocks, banners</li>
<li><a href="#ch-templates">Page Templates</a> — named page types, chapter openers</li>
<li><a href="#ch-layout">Layout &amp; Composition</a> — columns, floats, break utilities</li>
<li><a href="#ch-reference">Markdown Reference</a> — all syntax with examples</li>
<li><a href="#ch-fg-components">Field Guide Components</a> — definition blocks, gear entries</li>
<li><a href="#ch-cli">CLI Reference</a> — preview, build, publish</li>
</ol>

## Part 2 — Field Guide in Action

<ol>
<li><a href="#ch-examples">Examples Overview</a> — how to read these pages</li>
<li><a href="#ch-example-front-matter">Front Matter</a> — credits, TOC, intro</li>
<li><a href="#ch-example-chapter-opener">Chapter Opener</a> — chapter start spreads</li>
<li><a href="#ch-example-specialty-overview">Specialty Overview</a> — chapter intro pages</li>
<li><a href="#ch-example-specialty-profile">Specialty Profile</a> — full specialty spread</li>
<li><a href="#ch-example-rules">Rules &amp; Mechanics</a> — dice, outcomes, distances</li>
<li><a href="#ch-example-dm-npcs">Dream Master Pages</a> — NPC stat blocks, encounter hooks</li>
<li><a href="#ch-example-gear-tech">Gear &amp; Tech</a> — weapons, tables, cybernetics</li>
</ol>
</div>

---

## Quick Start

1. Edit brand tokens in `css/tokens.css` — colors, fonts, and spacing all live in the `:root` block at the top of that file. For project-specific overrides, use `css/project-overrides.css` instead of modifying the source files directly.
2. Run `print-md preview dc-design-guide` to see your changes live in the browser.
3. Remove or add chapters to `manifest.yaml` as needed — the guide only documents what you actually ship.

## Quick Start — What Each Chapter Covers

### Part 1 — Implementation Reference

| Chapter | Covers |
|---------|--------|
| **1 — Design System Overview** | Guide structure, CSS architecture, component model, how to customize the brand |
| **2 — Typography** | Typefaces, type scale, heading styles, body prose, code blocks, and font tokens |
| **3 — Color Palette** | All `--crimson`, `--hud-blue`, surface, and text tokens; contrast ratios; usage rules |
| **4 — Core Components** | Alerts, callouts, sidebars, procedures, definitions, gear cards — every `.pmd-*` component |
| **5 — DC Component Library** | Specialty cards, skill cards, learning paths, chapter openers — all `.dc-*` game content |
| **6 — Page Templates** | Every named page layout: `page-chapter-start`, `citizen-file`, `spread-gear`, and more |
| **7 — Layout & Composition** | Column breaks, two-column and three-column grids, `.pmd-no-break`, flow utilities |
| **8 — Markdown Reference** | Full macro syntax — every `@macro` / `@end-macro` pair with usage examples |
| **9 — Field Guide Components** | Stat grids, roll tables, option tables, class entries, and other book-specific blocks |
| **10 — Publishing** | Print export, DTRPG preset, PDF validation, asset requirements |

### Part 2 — Field Guide in Action

| Chapter | Covers |
|---------|--------|
| **Examples Overview** | How real-world examples are organized and what pages to reference |
| **Front Matter** | Title spread, legal page, ToC layout |
| **Chapter Opener** | Chapter-start two-column spread and Citizen File info page |
| **Specialty Overview** | Specialty intro spread and overview layout |
| **Specialty Profile** | Full specialty profile with skill cards and learning path |
| **Rules & Mechanics** | Action economy, combat, and multi-column rules content |
| **Dream Master Pages** | DM notes, NPC stat blocks, and encounter tables |
| **Gear & Tech** | Gear card grids and equipment reference spreads |
