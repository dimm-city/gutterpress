# dc-design-guide — CSS Architecture & Patterns

This document defines the CSS authoring conventions for the dc-design-guide and any
project that adapts it. It is the normative reference for all structural decisions —
when in doubt, consult this document before touching the source files.

---

## 1. Print-First Philosophy

This is a print document system. There are no `@media screen` rules, no responsive
breakpoints, no hover states. The output medium is a PDF rendered by Chromium's print
engine via Paged.js, and every rule must survive that pipeline unchanged.

**Physical units everywhere.** All sizing uses `pt` or `in` — units that map directly
to physical paper. `px` appears only for border widths where sub-point precision is
useful (`--bw-thin: 1px`, `--callout-border-width-small: 2px`). Component chrome dimensions (tab labels, icon badges, stat-cell keys) also use `px` where visual relationship to the surrounding layout matters more than physical print size — `9px` for a label superscript reads consistently at all print zoom levels. Avoid `em` for layout
geometry (column widths, gutters, card padding) — use `0.25in` not `1.5em`. The
exception is typographic rhythm: heading margins and padding that should scale
proportionally with the heading's own font-size (`h1, h2, h3 { margin: 1.5em 0 0.5em }`)
are correctly expressed in `em`. Bullet gaps and inline padding on `code` elements are
also correct uses of `em`. The rule is about column geometry, not typographic spacing.

**What Paged.js silently ignores.** Several CSS properties are accepted by Chromium
but discarded by the Paged.js polyfill:

| Property | Problem | Fix |
|---|---|---|
| `position: fixed` | Meaningless in the page-box model | Use `position: absolute` inside a margin box |
| `filter:` on layout boxes | Renders on screen, drops in PDF export | Use tiled PNG on `.pagedjs_sheet` for texture effects |
| `clamp(N vw, …)` | `vw` resolves to the page-box width (fixed), not the viewport — `clamp()` may return its middle value, defeating the responsive intent | Use fixed `pt` values |
| `break-before: recto/right/left` | Silently treated as `break-before: page` | Use `RectoChapterHandler` in `index.ts` |
| `counter-set` | Paged.js polyfill does not implement it | Use `counter-reset` only |
| `text-wrap: balance/pretty` | CSS4 properties, Paged.js ignores them | Document the caveat inline |
| `position: sticky` | No-op in paged context | Use margin-box running elements instead |
| `column-fill: balance` | Balancing is unreliable across page breaks in Paged.js | Test column behavior; prefer `auto` when balance causes regressions |

**The design guide is the canonical test bed.** If you are unsure how a rule renders,
add a specimen in `guide.css` scoped to `div.chapter` and build a preview. Never
assume browser behavior matches Paged.js behavior.

---

## 2. The Four-Layer Architecture

The stylesheet cascade is a strict four-file hierarchy imported in explicit order.
Later files win specificity ties. No file imports another directly — all imports flow
through `index.css`.

```css
/* css/index.css */
@import url("./dc-brand.css");          /* tokens, fonts, all DC components */
@import url("./page-rules.css");        /* @page rules, named pages, counters */
@import url("./content-templates.css"); /* Paged.js wrappers, page-type layout */
@import url("./guide.css");             /* design-guide specimens and overrides */

/* Project overrides — create this file to customize tokens without editing dc-brand.css.
   Intentionally last so overrides win the cascade. Silently absent = no-op. */
/* @import url("./project-overrides.css"); */
```

### Layer Responsibilities

| Layer | Owns | Must NOT contain |
|---|---|---|
| `dc-brand.css` | `:root` token block, `@font-face`, element resets, all `.dc-*` and `.pmd-*` component classes | `@page` rules, `.pagedjs_*` selectors, chapter-scoped overrides |
| `page-rules.css` | Every `@page` declaration, named-page geometry, margin-box content, counter resets. Exception: may contain direct `.pagedjs_*` selector overrides when Paged.js's own generated rules cannot be defeated any other way. | Component styles, token definitions, `.page.*` layout rules |
| `content-templates.css` | Paged.js structural wrappers (`.pagedjs_sheet`, `.page`, `.page-break`), page-type content layout (`.page.chapter-start` etc.), column structure | Brand tokens, `@page` at-rules, specimen styles |
| `guide.css` | Specimen layout scoped to `div.chapter`, code block formatting, chapter-break display rules, chapter-scoped overrides | Rules that would affect a production book build outside the design guide |

### Layer Contract Rules

**Tokens flow downward only.** The `:root` block is the exclusive property of
`dc-brand.css`. No other layer defines custom properties on `:root`. All layers
consume tokens via `var(--token)`. A `project-overrides.css` imported last is the
only sanctioned override path — do not edit `dc-brand.css` for project-specific
changes.

**No upward `!important` fights.** Layers do not override each other with
`!important`. The documented exception is defeating Paged.js injected margin-box
content, where `content: none !important` is required because Paged.js generates
`@page` rules at higher specificity than author stylesheets can normally reach.

**Selector ownership is exclusive.** If you are writing a rule for `.dc-callout`, it
belongs in `dc-brand.css`. If you are writing a rule for `.pagedjs_sheet`, it belongs
in `content-templates.css`. A `.dc-*` selector in `page-rules.css` is a bug.

**Reusable components use a real base class plus thin variants.** For shared UI
systems like alerts, banners, panels, and stat grids, the canonical dc-prefixed
base class owns the full default shell. Variant classes should only override the
few properties that actually change.

Use CSS custom properties only when they form a small documented public API for a
component, such as surface, accent, foreground, label text, or title color.
Do not expose internal layout details like padding, margin, width, line-height,
break behavior, or label typography as broad variable APIs by default.

Important: visually related components are not automatically one component
family. In the dc-design-guide, `.dc-skill-card`, `.dc-path-shell`, and
`.dc-specialty-card` are distinct components and should not be forced into one
large variable-driven abstraction.

---

## 3. The Token System

All design decisions that recur in two or more rules are expressed as custom
properties in the `:root` block of `dc-brand.css`. The taxonomy follows a strict
hierarchy: color → typography → spacing → geometry.

### Color Tokens

```css
/* Semantic brand colors — names carry meaning, not just hex values */
--crimson:        #d41200;  /* primary accent — vivid banner red */
--blood:          #a30900;  /* heading color — 5.46:1 contrast on --bg */
--orange:         #f24d00;  /* spray orange — bullets, decorative accents */
--rust:           #c23000;  /* creaturepunk accent — banner backgrounds, h1 chevrons */
--amber:          #e89200;  /* footer chrome, running counters */
--hud-blue:       #2a6a8a;  /* primary HUD chrome border */

/* Print substrate */
--bg:             #d4d4d4;  /* page background — light cool gray canvas */
--paper-cream:    #f5f0e6;  /* warm cream — primary card surface */
--paper-light:    #ebe5d8;  /* aside / sticker / quote */
--paper-aged:     #ddd6c6;  /* deeper aged — emphasis aside */

/* Ink scale */
--ink:            #1a1715;  /* primary text — near-black, warm cast */
--ink-dark:       #2a2622;  /* secondary headings */
--ink-smoke:      #4a4540;  /* body emphasis, italics on cream */
--ink-dust:       #8a8378;  /* muted labels, subtitles */
```

Color token names are semantic — `--blood` is not "dark red", it is the specific
heading-level red chosen because `--crimson` fails WCAG AA contrast (2.43:1) against
the page background while `--blood` reaches 5.46:1. That constraint is baked into the
token name, not scattered across heading rules.

### Typography Tokens

```css
/* Type families — named by role, not by font name */
--font-display:  'lixdu', 'Tomorrow', sans-serif;
--font-body:     'Titillium Web', Georgia, sans-serif;
--font-mono:     'Tomorrow', 'Titillium Web', monospace;

/* Type scale — physical units, 12pt body floor */
--fs-body:    12pt;
--fs-body-sm: 11pt;    /* design floor — never go below this for prose */
--fs-body-xs: 11.5pt;  /* between sm and body — outcome text, cover body, TOC items */
--fs-footer:  9.5pt;   /* @page margin-box footer text */

/* Line height */
--lh-normal:  1.5;
--lh-tight:   1.35;

/* Letter spacing — named by use */
--ls-display:  0.1em;   /* all-caps display headings */
--ls-cap-sm:   3px;     /* mono micro-caps (.tag, .dc-tag) */
```

### Spacing and Geometry Tokens

```css
/* Spacing — physical units */
--space-sm:  0.08in;
--space-md:  0.12in;
--space-lg:  0.15in;
--space-xl:  0.20in;
--gutter:    0.15in;    /* column gap, structural section margins */
--space-2xl: 0.25in;    /* spacing-scale step; do not substitute for --gutter */

/* Page geometry — must match @page size declaration exactly */
--page-width:     8.625in;
--page-height:    11.25in;
--page-margin:    0.5in;
--binding-margin: 0.75in;  /* spine-side in @page :left/:right */
```

### Page Background and the Viewer

The page background color is controlled entirely within `content-templates.css` — no
viewer hook token is needed:

```css
/* content-templates.css */
.pagedjs_sheet {
  background-color: var(--bg);
  background-image: url("https://placehold.co/200x200/png?text=Brick");
  background-repeat: repeat;
}
```

To change the page background in an adapted project, override `--bg` in
`project-overrides.css`. The viewer picks it up automatically because
`.pagedjs_sheet` reads it directly — there is no intermediate viewer hook variable.

### What Makes a Good Token

**Good — `--ls-cap-sm`**: Used in five rules across three files. Semantically distinct
(letter-spacing for micro-cap labels). Has no alias.

**Good — `--gutter`**: The column gap appears in grid declarations and structural
margins. One change reflows all of them without changing the spacing scale.

**Anti-pattern — removed `--secondary-color`**: Was a 1:1 alias of `--crimson` with
no additional meaning. All eight consumers were updated to `var(--crimson)` directly.
Aliases that add no semantic distinction split the refactoring surface without buying
readability.

**Anti-pattern — alias with wrong fallback**: `--accent-color1: var(--hud-blue,
#ff6a3d)` — the fallback `#ff6a3d` is bright orange, the opposite of HUD blue. Wrong
fallbacks silently corrupt rendering when the primary token fails to resolve. All
fallbacks must match the canonical token's value family.

---

## 4. Page Template System

Page layout is controlled through two independent axes. Neither axis alone is
sufficient — a page needs both a geometry declaration and a content layout declaration.
Separating them into two distinct layers eliminates the specificity fights that follow
when both are merged.

### Axis 1 — `@page` Named Pages (`page-rules.css`)

`@page` rules own geometry: page size, margin sizes, running headers and footers.
Named pages are declared in `page-rules.css`, and a corresponding element rule assigns
a CSS class to that named page in the same file:

```css
/* page-rules.css — geometry and named-page assignment together */
@page chapter-start {
  /* Footer suppression requires a .pagedjs_* override — see caveat below */
}

@page chapter-start:left {
  margin-right: var(--binding-margin, 0.75in);
  margin-left:  var(--page-margin);
}

@page chapter-start:right {
  margin-left:  var(--binding-margin, 0.75in);
  margin-right: var(--page-margin);
}

/* Named-page assignment — lives adjacent to its @page declaration */
.chapter-start { page: chapter-start; }
```

> **Paged.js caveat — `content: none` in named `@page` rules is silently dropped.**
> Paged.js's transformer discards `@bottom-X { content: none }` from named-page
> rules, leaving the default `:left`/`:right` footer content intact. The workaround
> is a direct `.pagedjs_*` override — the one sanctioned use of these selectors and
> `!important` in the entire codebase:
>
> ```css
> /* page-rules.css */
> .pagedjs_page.pagedjs_named_page.pagedjs_chapter-start_page
>   .pagedjs_margin-bottom-left > .pagedjs_margin-content::after,
> .pagedjs_page.pagedjs_named_page.pagedjs_chapter-start_page
>   .pagedjs_margin-bottom-right > .pagedjs_margin-content::after {
>   content: none !important;
> }
> ```
>
> Without this, chapter-start pages will show running footers.

Named pages in this codebase: `chapter-start`, `chapter-end`, `front-matter`, `full`,
`aug`, `citizen-file`, `clean` (reserved). `@page :blank` is applied by
Paged.js to blank pages inserted by `RectoChapterHandler` — use it to suppress footers
on programmatically inserted blank pages.

### Axis 2 — `.page.*` Content Templates (`content-templates.css`)

While `@page` controls the physical box, `.page.*` selectors control what happens
inside it: column count, column-fill strategy, break behavior. The `.page` class is
the structural hook; specialized classes extend it:

```css
/* content-templates.css */

/* Two-column rules pages — balanced fill */
.page.page-rules,
.page.da-devil {
  columns: 2;
  column-gap: var(--gutter);
  column-fill: balance;
}

/* Full-bleed art pages */
.full-page {
  width:  var(--page-width, 8.625in);
  height: var(--page-height, 11.25in);
  break-before: page;
  page-break-before: always;
}
```

The double-class pattern (`.page.chapter-start`, `.page.page-toc`) is intentional:
`.page` provides the base reset; the second class carries the page-type identity.
Specificity (0,2,0) beats single-class overrides from upstream CSS without
`!important`.

### Chapter Counter System

The chapter counter is managed in `page-rules.css` in two parallel layers:

```css
/* page-rules.css */
body { counter-reset: chapter; }

/* Layer 1 — hard-reset on every page that carries the chapter class.
   Both .page and .page-break are needed — Paged.js may render through either.
   counter-reset fires on EVERY page carrying this class, not just the first.
   Every page in a chapter must carry the correct chapter-NN class for the
   running footer to display the correct chapter number throughout. */
.page.chapter-01, .page-break.chapter-01 { counter-reset: chapter 1; }
.page.chapter-02, .page-break.chapter-02 { counter-reset: chapter 2; }

/* Layer 2 — reset both the chapter AND page counter at the chapter opener.
   This enables per-chapter page numbering (p.1, p.2 within each chapter). */
.chapter-start.chapter-01 { counter-reset: chapter 1 page 0; }
.chapter-start.chapter-02 { counter-reset: chapter 2; }
```

Both layers are required. Omitting the `.page.chapter-NN` resets produces a stuck
`c.0` footer on mid-chapter pages. Omitting the `.chapter-start` resets breaks
per-chapter page numbering.

**Critical**: use `counter-reset` only. `counter-set` is not implemented by the
Paged.js polyfill — it silently no-ops.

### TOC Page Numbers — `target-counter()`

Paged.js supports `target-counter()` for automatic cross-reference page numbers:

```css
/* content-templates.css */
.dc-toc ol > li > a::after {
  content: target-counter(attr(href), page);
}
```

`target-counter()` resolves the `href` anchor to find its target element and inserts
that element's page number at render time. This requires Paged.js to complete its
layout pass — it produces no output in a browser without the polyfill running.

---

## 5. Markdown-Friendly Selectors

Markdown generates clean HTML with minimal class names. A paragraph is a `<p>`. A
heading is an `<h3>`. Authors should not need `{.class}` on every element — CSS does
the targeting work by anchoring selectors to structural containers that markdown's own
output reliably provides.

### Strategy 1 — Child Combinator + Element Type

When content lives inside a container with a known class, the child combinator targets
elements without requiring authors to add classes:

```css
/* guide.css — first h1 in every @chapter wrapper triggers a page break */
div.chapter > h1:first-of-type {
  break-before: page;
  page-break-before: always;
}

/* The inverse — non-title h1s (specimens) do NOT page-break */
div.chapter > h1:not(:first-of-type) {
  break-before: auto;
  page-break-before: auto;
}
```

The structural anchor also lets you selectively opt elements out of a behavior without
touching the markdown.

### Strategy 2 — `:first-of-type`, `:only-child`, and Adjacent Sibling

These pseudo-classes target positional relationships that correspond to authoring
conventions. The gear entry tagline is always an italic paragraph immediately after
an h3:

```css
/* dc-brand.css */
.dc-gear-entry-tagline,
.dc-gear-entry > p:first-of-type em:only-child,
.dc-gear-entry > p.dc-flavor:first-of-type {
  font-style: italic;
  font-size: var(--fs-body-sm);
  color: var(--ink-smoke);
  display: block;
}
```

The author writes `*Melee. Cyberware implant. Pair.*`. Markdown renders
`<p><em>…</em></p>`. The selector targets the `<em>` that is the only child of the
first paragraph. If any text falls outside the asterisks, the structural selector
silently fails — add `{.dc-gear-entry-tagline}` to the paragraph as the escape hatch,
which the ruleset's first selector handles unconditionally.

The adjacent sibling prevents headings from stranding without content:

```css
/* guide.css */
div.chapter h2 + p, div.chapter h3 + p {
  break-before: avoid;
  page-break-before: avoid;
}
```

### Strategy 3 — Container Context Scoping

The `div.chapter` and `.page.*` parent selectors scope rules to their context.
A rule scoped to `section#ch-name` is guaranteed not to bleed into adjacent chapters:

```css
/* content-templates.css */
.page.page-credits.credits > h1,
.page.page-intro.intro > h1,
.page.page-chapter-start.chapter-start > h1 {
  color: var(--paper-cream);
  background: var(--rust);
  clip-path: var(--clip-banner);
}
```

The triple-class specificity ensures this wins without `!important`.

### Strategy 4 — The `:::` Container Wrapper Pattern

`::: wrapper {.dc-definition-block}` wraps content in
`<div class="dc-definition-block">`. Once you have the wrapper class, target children
by element type:

```css
/* dc-brand.css — children addressed by type, not by class */
.dc-definition-block {
  background: var(--surface-orange-tint);
  border-left: 4px solid var(--crimson);
  padding: 10px 14px;
  font-style: italic;
}

.dc-definition-block p     { margin: 0; }
.dc-definition-block p + p { margin-top: 6pt; }
```

The markdown author writes:

```markdown
::: wrapper {.dc-definition-block}
Augmercs are muscle for hire.
:::
```

No `.dc-definition-block-paragraph` class is needed. The `p + p` selector handles
multi-paragraph definitions automatically.

The `wrapper` keyword is the generic form. Named containers are first-class
alternatives: `:::two-column`, `:::sidebar`, `:::callout`, `:::pull-quote` — each
generates a `<div>` with the corresponding class without requiring `{.class}` syntax.
Prefer named containers over `:::wrapper {.class}` when a built-in type matches your
intent.

When two prose-box components genuinely share the same shell behavior, give them a
real base class and emit it in markup. In the dc-design-guide, `@definition` and
`@sidebar-box` can share a tiny `.dc-prose-panel` shell for common padding/margin/
break behavior, while `.dc-definition-block` and `.dc-sidebar-box` keep their own
surface, accent, heading, and text rules. Do not use that base for unrelated inset
layout components like `.dc-sidebar`.

**Anti-pattern:**

```css
/* Don't do this — forces authors to annotate every element */
.dc-definition-block-text  { font-style: italic; }
.dc-definition-block-intro { margin-top: 6pt; }
```

### Strategy 5 — The `@chapter` Macro as CSS Hook

`@chapter #ch-name .page-class` at the top of a markdown file generates:

```html
<div class="chapter ch-name page-class" id="ch-name">
```

Note: the id slug is also added to the class list. This gives two independent CSS
handles:

```css
/* By chapter ID — applies only to this chapter */
#ch-toc h1:first-of-type { break-before: auto; }

/* By page class — applies to pages of this type */
.page.fg-components > h2 { color: var(--blood); }
```

Use the ID form for chapter-specific exceptions. Use the class form for page-type
conventions that should apply consistently across the book.

### Strategy 6 — When You DO Need a Class

A class is necessary when the same element type serves multiple structural roles at
the same DOM depth inside the same container. If a component needs to distinguish
between a primary `h3` (item name) and a secondary `h3` (subsection), position alone
cannot separate them. That is the correct moment to add `{.classname}` to the
markdown element.

The escape hatch is `{.classname}` on the markdown element. Raw HTML is a last
resort, permitted only when markdown cannot produce the required semantic structure.
Document any raw HTML exception explicitly in the component's documentation.

The `:has()` relational pseudo-class is supported in Chromium (Paged.js's renderer)
and enables parent-aware targeting — for example, `li:has(> strong:first-child)`
styles list items whose first child is bold. Use it when structural selectors alone
cannot express the relationship, but test in the Paged.js preview — `:has()` depends
entirely on Chromium support and is not polyfilled by Paged.js itself.

---

## 6. CSS Nesting for Component Scoping

Paged.js renders in Chromium, which has full support for native CSS nesting. Component
rules can be written with explicit parent-child scope rather than long compound
selectors:

```css
/* Without nesting — relationships implied by shared prefix only */
.dc-sidebar-box { background: var(--paper-cream); padding: 14px 18px; … }
.dc-sidebar-box > h4:first-child { font-family: var(--font-display); … }
.dc-sidebar-box hr { border-top: 1px dashed var(--blood); … }
.dc-sidebar-box p { font-size: var(--fs-body-sm); … }

/* With nesting — scope is structurally enforced by the parser */
.dc-sidebar-box {
  background: var(--paper-cream);
  border: 1.5px solid var(--border-hairline);
  border-left: 4px solid var(--blood);
  padding: 14px 18px;
  margin: 0.15in 0;
  break-inside: avoid;
  page-break-inside: avoid;

  & > h3:first-child,
  & > h4:first-child {
    font-family: var(--font-display);
    font-size: var(--fs-h4);
    font-style: italic;
    color: var(--blood);
    text-transform: uppercase;
    margin: 0 0 10px;
  }

  & hr {
    border: none;
    border-top: 1px dashed var(--blood);
    margin: 7.5pt 0;
  }

  & p             { margin: 0; font-size: var(--fs-body-sm); line-height: var(--lh-normal); }
  & p + p         { margin-top: 6pt; }
}
```

The `&` operator refers to the parent selector. `& > h4:first-child` compiles to
`.dc-sidebar-box > h4:first-child`.

### When Not to Nest

Nest for direct parent-child and immediate-sibling relationships within one component
boundary. Do not nest to mirror DOM structure across multiple levels — every nesting
level increases compiled-selector specificity and makes future overrides harder.

The specialty density overrides stay flat deliberately:

```css
/* content-templates.css — flat, not nested chains */
.specialty .dc-learning-path       { page-break-before: always; }
.specialty .dc-learning-path h3    { padding-top: 0.06in; }
.specialty .dc-learning-path .dc-intro { font-size: 0.65rem; }
```

Nesting these would imply a DOM hierarchy between `h3` and `.dc-intro` that does not
exist.

---

## 7. Break and Pagination Control

Page breaks are the most common source of layout regressions in Paged.js. Its
JavaScript break handler does not always honor CSS break properties the same way
Chromium's native print renderer does.

### Always Pair Break Properties

Paged.js honors `page-break-inside: avoid` reliably. The spec-compliant
`break-inside: avoid` is required for forward compatibility and for Chromium's native
print mode during PDF export. Always write both:

```css
.dc-callout,
.dc-stat-block,
.dc-gear-entry {
  break-inside: avoid;
  page-break-inside: avoid;
}
```

The same pairing applies to `break-after`/`page-break-after` and
`break-before`/`page-break-before`.

### `break-before: page` vs `break-before: always`

These are not equivalent in multi-column layouts. `break-before: always` forces a
break out of any fragmentation context — including columns — which produces an
unexpected column break rather than a page break in two-column sections.
`break-before: page` is specific to page fragmentation and is the correct choice in
column contexts. Pair both for full compatibility:

```css
/* Correct — page break only, not column break */
.chapter-start {
  break-before: page;
  page-break-before: always;
}
```

### Keep Headings With Their Content

```css
/* guide.css */
div.chapter h2, div.chapter h3, div.chapter h4 {
  break-after: avoid;
  break-before: auto;
  break-inside: avoid;
  page-break-after: avoid;
  page-break-before: auto;
  page-break-inside: avoid;
}

div.chapter h2 + p, div.chapter h2 + ul,
div.chapter h3 + p, div.chapter h3 + ul,
div.chapter h4 + p, div.chapter h4 + ul {
  break-before: avoid;
  page-break-before: avoid;
}
```

### Orphans and Widows

```css
/* content-templates.css — baseline */
.page p {
  orphans: 4;
  widows: 4;
}
```

Four lines minimum at the bottom of a column (orphan) or top of the next column
(widow). This is the design guide setting; the CSS Paged Media spec default is 2.
Paged.js honors these properties.

### Tail-Row Guard Pattern

Prevent the second-to-last item in a list from being stranded without its final
sibling:

```css
/* content-templates.css */
.dc-skill-card .dc-card-body .dc-ability:nth-last-of-type(2):not(:only-of-type) {
  break-after: avoid;
  page-break-after: avoid;
}

.dc-skill-card .dc-card-body .dc-ability:last-of-type:not(:only-of-type) {
  break-before: avoid;
  page-break-before: avoid;
}
```

The two rules work together: the second-to-last item refuses to be last on a page;
the last item refuses to be first on a new page. `:not(:only-of-type)` prevents
activation when only one item exists.

### The `.pmd-no-break` Utility

For one-off elements that must not split across pages without having a component
class:

```css
/* guide.css */
.pmd-no-break {
  break-inside: avoid;
  page-break-inside: avoid;
}
```

Apply via `{.pmd-no-break}` on a markdown element or `::: wrapper {.pmd-no-break}`.

### Recto Chapter Starts

`break-before: right/left/recto` are silently treated as `break-before: page` by the
Paged.js polyfill. Use `RectoChapterHandler` in `index.ts`, which injects a blank page
into the DOM before a chapter that would otherwise start on verso. CSS alone cannot
reliably achieve recto placement.
