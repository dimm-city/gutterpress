@chapter #ch-examples .examples .chapter-03 ch="3"

# Field Guide in Action {.dc-chevron}

@lede

Real pages from the Dimm City Field Guide rendered through the DC print system. Every spread in Part 2 uses actual book content — no placeholder text, no fabricated specimens. What you see here is what the published book looks like, built from the same markdown and CSS.

@end-lede

## What Is Part 2?

@section .two-column

The spec chapters (01–08) explain the design system in terms of tokens, syntax, and components. Part 2 is the payoff: real Field Guide pages rendered live, showing how those components combine under actual conditions.

@column-break

Each chapter in Part 2 covers one type of page. The annotation above the rendered content names the active page template, CSS classes, and any macros in use. The rendered block beneath it is the actual book markdown — same source, same stylesheet, same output.

@end-section

## Part 2 Contents

<div class="dc-toc">
<ol>
<li><a href="#ch-example-front-matter">Front Matter</a> — Table of Contents, Credits, and Introduction pages</li>
<li><a href="#ch-example-chapter-opener">Chapter Opener</a> — chapter-start spreads with fiction column and rules column</li>
<li><a href="#ch-example-specialty-overview">Specialty Overview</a> — the "Choose a Specialty" spread and specialty card grid</li>
<li><a href="#ch-example-specialty-profile">Specialty Profile</a> — full Augmerc specialty block with learning paths and skill cards</li>
<li><a href="#ch-example-rules">Rules Pages</a> — core rules prose: dice, distances, conditions, NPC types</li>
<li><a href="#ch-example-dm-npcs">DM &amp; NPC Pages</a> — Dream Mastery chapter, NPC stat blocks, Fodder / Operator / Master examples</li>
<li><a href="#ch-example-gear-tech">Gear &amp; Tech</a> — useful items, Ego Points table, and cybernetics rules</li>
</ol>
</div>



## Page Templates at a Glance

| Chapter | Templates applied | Key macros |
|---------|-------------------|------------|
| Front Matter | `page-toc`, `page-credits`, `page-intro` | `@toc`, `@lede` |
| Chapter Opener | `page-chapter-start` | `@chapter-opener`, `---{.column-break}` |
| Specialty Overview | `card-grid` | `@specialty`, `@specialty-card` |
| Specialty Profile | `@page` (bare) | `@specialty`, `@learning-path`, `@skill` |
| Rules Pages | `chapter-start`, `the-players` | `@chapter-opener`, markdown tables |
| DM & NPC Pages | `chapter-04` | H4/H5/H6 stat block format |
| Gear & Tech | `tech-cybernetics` | EP table, `SysChk` inline code |

## How to Read These Examples

Each example chapter follows the same structure:

@section .two-column

@definition

**Annotation block** — Names the active page template, CSS classes on `@page`, and macros in use. Part of the design guide, not the Field Guide source. Cross-references point to spec chapters for token details.

@end-definition

@column-break

@definition

**Live rendered block** — Actual Field Guide markdown. Images use `placehold.co` in place of book artwork paths. All class attributes, macros, and prose are verbatim from the source.

@end-definition

@end-section

The rendered output is the design system working as-shipped. If something looks wrong here, it's a real bug — not a specimen issue.
