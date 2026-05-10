@chapter #ch-toc .toc

# Dimm City Design Guide

<div class="dc-intro">This is the Dimm City print design system — cyberpunk and creaturepunk, built on print-md. Everything in these pages is live: the type, color, and components you see here are rendered through the same CSS as the Field Guide. Use this guide to understand, customize, and extend the system.</div>

<ol>
<li><a href="#ch-overview">Design System Overview</a> — how to use this guide and customize it for your book</li>
<li><a href="#ch-typography">Typography</a> — lixdu display, Tomorrow mono, Titillium Web body; the full type scale</li>
<li><a href="#ch-palette">Color Palette</a> — paper, fire, HUD, surface, and border tokens with usage rules</li>
<li><a href="#ch-components">Core Components</a> — prose, callouts, notes, pull quotes, and tables</li>
<li><a href="#ch-dc-components">DC Component Library</a> — banners, ability cards, tags, stickers, stat blocks, and outcome ladders</li>
<li><a href="#ch-templates">Page Templates</a> — named page types, chapter openers, and full-bleed spreads</li>
<li><a href="#ch-layout">Layout &amp; Composition</a> — columns, floats, page markers, and break utilities</li>
<li><a href="#ch-reference">Markdown Reference</a> — all syntax with live examples</li>
<li><a href="#ch-cli">CLI Reference</a> — build, preview, and publish commands</li>
</ol>

---

## Quick Start

1. Edit brand tokens in `css/dc-brand.css` — colors, fonts, and spacing all live in the `:root` block at the top of that file.
2. Run `print-md preview dc-design-guide` to see your changes live in the browser.
3. Add book-specific rules at the end of `css/dc-brand.css` — one file, one source of truth.
4. Remove or add chapters to `manifest.yaml` as needed — the guide only documents what you actually ship.
