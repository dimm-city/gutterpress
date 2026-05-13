@chapter #ch-examples .examples .chapter-03 ch="3"

# Field Guide in Action {.dc-chevron}

:::lede
Real pages from the Dimm City Field Guide rendered through the DC print system. Every spread in Part 2 uses actual book content — no placeholder text, no fabricated specimens. What you see here is what the published book looks like, built from the same markdown and CSS.
:::

---

## What Is Part 2?

The spec chapters (01–08) explain the design system in terms of tokens, syntax, and components. Part 2 is the payoff: real Field Guide pages rendered live, showing how those components combine under actual conditions.

Each chapter in Part 2 covers one type of page. The annotation above the rendered content names the page template, CSS classes, and any macros in use. The rendered block beneath it is the actual book markdown — same source, same stylesheet, same output.

---

## Part 2 Contents

<div class="dc-toc">
<ol>
<li><a href="#ch-example-front-matter">Front Matter</a> — Table of Contents, Credits, and Introduction pages</li>
<li><a href="#ch-example-chapter-opener">Chapter Opener</a> — chapter-start spreads with fiction column and rules column</li>
<li><a href="#ch-example-specialty-overview">Specialty Overview</a> — the "Choose a Specialty" spread and specialty card grid</li>
<li><a href="#ch-example-specialty-profile">Specialty Profile</a> — full Augmerc specialty block with learning paths and skill cards</li>
<li><a href="#ch-example-rules">Rules Pages</a> — core rules prose: dice, distances, conditions, NPC types</li>
<li><a href="#ch-example-dm-npcs">DM &amp; NPC Pages</a> — Dream Mastery chapter, NPC stat blocks, Fodder / Operator / Master examples</li>
<li><a href="#ch-example-gear-tech">Gear &amp; Tech</a> — useful items, aug cards, Ego Points table, and cybernetics rules</li>
</ol>
</div>

---

## How to Read These Examples

Each example chapter follows the same structure:

**Annotation paragraph** — a short paragraph naming the active page template, the CSS classes applied to `@page`, and any macro directives (`@specialty`, `@learning-path`, `@skill`, `@chapter-opener`). Cross-references point to the spec chapters for token details.

**Live rendered block** — the actual Field Guide markdown that follows the annotation. Images reference `img/placeholder-plate.png` in place of the book's original artwork paths (which don't resolve in the design guide context). All class attributes, macros, and prose are verbatim from the source.

The rendered output is the design system working as-shipped. If something looks wrong here, it's a real bug — not a specimen issue.
