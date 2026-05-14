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
