# Toolchain Conflict Analysis: Paged.js × markdown-it-paged × print-md

**Generated:** 2026-05-17  
**Scope:** Full stack analysis — Paged.js v0.4.x internals, the inlined `markdown-it-paged` plugin (`src/lib/markdown/markdown-it-paged.js`), and the DC Design Guide CSS architecture.

---

## Executive Summary

The three tools operate on the same content at different times and with different assumptions, creating several categories of silent failure:

1. **Paged.js strips CSS properties** that authors write expecting them to work — `break-after: column` and `break-before: recto/verso` are silently discarded. (`break-after: avoid` was also silently discarded until vendored Paged.js PATCH-1 fixed it.)
2. **Cascade order is inverted** relative to author expectation — the `PAGED_CSS` inline `<style>` block comes *after* user `<link>` stylesheets and wins specificity ties, meaning authors cannot override print-md base styles with same-specificity rules.
3. **State shared across file renders** in the markdown renderer can corrupt multi-file output if a render fails mid-section.
4. **CSS architecture contract violations** exist in 8+ places, making maintenance correctness hard to reason about.

---

## Part 1: How Paged.js Processes the Document

### 1.1 The CSS Removal Pipeline

Paged.js (`previewer.js:removeStyles()`) physically removes from the DOM:
- Every `<link rel="stylesheet">` not tagged `data-pagedjs-ignore` and not `media="screen"`
- Every `<style>` block not tagged `data-pagedjs-inserted-styles`, `data-pagedjs-ignore`, or `media="screen"`

All extracted CSS is re-fetched/re-read and piped through `polisher.js`. The polisher rewrites the CSS AST via handler hooks, then re-injects the result as `<style data-pagedjs-inserted-styles>` elements. **Every author stylesheet is destroyed and reconstructed.** Original source order is preserved during reconstruction.

### 1.2 CSS Properties That Are Stripped and Never Re-emitted

The `Breaks` handler (`breaks.js`) intercepts and permanently removes from the CSS AST:

| Property stripped | What happens to its value |
|---|---|
| `break-before` | Written as `data-break-before` attribute on matched DOM elements |
| `break-after` | Written as `data-break-after` attribute on matched DOM elements |
| `page-break-before` | Normalized to `break-before`, then same as above |
| `page-break-after` | Normalized to `break-after`, then same as above |
| `page` | Written as `data-page` attribute on matched DOM elements |

These properties **never appear in re-injected CSS**. The browser never sees them. Layout is driven entirely from the `data-*` attributes.

`position: fixed` is separately handled: the element is removed from flow, moved out of DOM, then cloned `position: absolute` into every page's `.pagedjs_pagebox`. Any author use of `position: fixed` for purposes other than running headers will be cloned to every page.

All `@page` blocks are also stripped and converted to `.pagedjs_named_page.pagedjs_<name>_page { ... }` class rules.

### 1.3 `break-*` Values That Are Acted Upon vs. Silently Ignored

After writing `data-break-*` attributes, `addBreakAttributes()` in `breaks.js` reads them back to populate the chunker's break model:

| Value | Behavior |
|---|---|
| `always`, `page` | ✅ Forces page break |
| `left`, `right` | ✅ Forces page break (directional resolution NOT implemented — treated as unconditional) |
| `recto`, `verso` | ❌ Written to attribute but never acted upon — effectively a no-op |
| `column` | ❌ Written to `data-break-after="column"` but chunker never acts on `"column"` value |
| `avoid` | ❌ Explicitly filtered: `addBreakAttributes()` skips any value `=== "avoid"` |
| `auto` | ❌ Written to attribute, no action |

**Concrete failures in the current codebase:**

- `page-templates.css:67` — `.column-break { break-after: column }` → dead. No column break ever fires through this rule. The structural `.col` div approach in `index.ts` is the correct workaround.
- `page-templates.css:88–90` — `.page h2, .page h3 { break-after: avoid }` → **active** as of vendored Paged.js PATCH-1. The chunker's element-level path (checking `node.dataset.previousBreakAfter === "avoid"` at lines 1937–1938) always functioned. PATCH-1 additionally forwards `avoid` to the page model so custom `afterPageLayout` handlers also see it.
- Any `break-before: recto` or `break-before: verso` in author CSS → dead. Insert `@page-break` manually before a chapter if it lands on the wrong side after reviewing output.

### 1.4 `break-before` on First Child is Silently Dropped

`processBreaks()` in `breaks.js:96–103` checks for a preceding sibling (`nodeBefore`). If none exists (element is the first child of its parent), `data-break-before` is **never written**. A `break-before: page` on the first `.page` in `<body>` produces no forced break.

### 1.5 Named Page Mechanics

The named page transition is the primary page break mechanism — not `break-before: page`. When the chunker encounters adjacent elements where `data-page` changes value, it forces a page break at that boundary.

Key behaviors:
- **`page: X` on any element** inside `display: grid` or `columns: N` triggers a forced break for every such element, destroying grid/column layouts. Fix: `page: auto` on child elements at higher specificity.
- **`page: auto`** cancels named page context and returns elements to default flow.
- **Named page `:left`/`:right` inheritance**: Paged.js auto-generates `@page <name>:left` and `@page <name>:right` specializations. These inherit default `:left`/`:right` margin box content unless explicitly overridden with `content: none`. The `!important` in `page-rules.css:165–168` is the only reliable suppression path — without it, inherited footer content re-appears on named pages.

### 1.6 Cascade Order After Paged.js Reconstruction

Paged.js preserves original document order when re-injecting stylesheets. The final cascade order for equal-specificity rules:

1. User `<link>` stylesheets (index.css → dc-tokens → dc-core → dc-components → page-templates → page-rules → dg-overrides → fg-overrides)
2. `PAGED_CSS` inline `<style>` (injected by `index.ts` **after** the `<link>` tags)
3. Plugin CSS inline `<style>` (if any)
4. Paged.js base styles and generated class rules (last; highest priority)

**`PAGED_CSS` wins over user linked CSS at equal specificity.** Authors cannot override `.page { break-before: page }` or `.section { break-inside: avoid }` with same-specificity rules in their linked CSS files.

### 1.7 Other Confirmed Footguns

| ID | Footgun | Impact |
|----|---------|--------|
| FG-1 | `:is()` with sibling combinators (e.g., `:is(h2, h3) + p`) crashes Paged.js during `querySelectorAll` on `DocumentFragment` → zero pages rendered | CRITICAL |
| FG-2 | `counter-set` is a no-op — Paged.js only honors `counter-reset` and `counter-increment` | MEDIUM |
| FG-3 | `content: none` in `@page <name>` margin boxes does not suppress inherited borders from parent `@page` | MEDIUM |
| FG-4 | `position: fixed` elements are cloned to every page — cannot be used for screen-only positioning | LOW |
| FG-5 | `@page :blank` requires BOTH `:blank` definition AND `.pagedjs_blank_page` override to suppress inherited `:left/:right` margins on injected blank pages | MEDIUM |

---

## Part 2: The markdown-it-paged Plugin Integration

### 2.1 Token Pipeline

For a typical `@section .two-column .col-split` block, the pipeline flows:

1. **Block rule** (`markerBlock`) — converts each `@marker` line into a flat `layout_marker` token with `meta.kind` and `meta.attrs`. Sets `state.env.__layoutMarkersUsed = true` as an opt-in gate.
2. **Core rule** (`layout_transform`) — replaces `layout_marker` tokens with structural open/close tokens: `layout_page_open`, `layout_section_open`, `layout_column_break`, `layout_section_close`, `layout_page_close`.
3. **Renderer overrides** in `index.ts` — intercept `layout_section_open` to detect `.col-split` class and wrap content in explicit `<div class="col">` divs when a `@column-break` exists inside the section.

The resulting HTML for `@section .two-column .col-split` with one `@column-break`:

```html
<div class="section two-column col-split"><div class="col">
  <!-- left column content -->
</div><div class="col">
  <!-- right column content -->
</div></div>
```

CSS in `page-templates.css:169–176` applies `display: flex` to `.section.col-split` and `flex: 1` to `.section.col-split .col`.

### 2.2 `colSplitDepth` — Confirmed State Leak Bug

**Location:** `index.ts:67`

`colSplitDepth` is a closure variable inside `createMarkdownRenderer()`. The same `md` instance is reused across all files in the `for (const file of files)` loop (`index.ts:204–215`). Each `md.render(content)` call is stateful with respect to `colSplitDepth`.

If all files render correctly (every col-split open is matched by a close), `colSplitDepth` resets to `0` between files and the bug is latent. If any render throws or a col-split is unclosed, subsequent files inherit a non-zero `colSplitDepth`, causing every `layout_section_close` to emit `</div></div>` instead of `</div>`, producing corrupted HTML nesting.

**Fix:** Reset `colSplitDepth = 0` before each `md.render(content)` call, or expose a reset method.

### 2.3 `@section .col-split` Without `@column-break` — Silent No-op

When the lookahead in `index.ts:77–82` finds no `layout_column_break` before the matching `layout_section_close`, `hasBreak` stays false. The section renders as a plain `<div class="section two-column col-split">` with no `.col` wrappers and no warning. The author's intent is silently lost.

**Fix:** Emit a layout warning when `.col-split` has no `@column-break` in scope.

### 2.4 Nested `@section` Destroys Col-Split — By Design

`layout_transform` calls `closeSection()` before every `openSection()` (line 326). Nested `@section` macros are impossible: the outer section terminates when the inner section opens. An author attempting `@section .col-split` containing another `@section` will have the col-split terminated prematurely with no warning.

This is architectural — `@section` in `markdown-it-paged` is intentionally flat-scoped. The fix for content requiring layered structure is to use `:::named-container` (the `markdownItContainer` system), which uses fenced block syntax and supports nesting via colon depth.

### 2.5 `implicitPage: false` — Correctly Aligned

The inlined plugin defaults `implicitPage: false` (`markdown-it-paged.js:176`). The `md.use()` call in `index.ts:60` passes no options. This is correct — no workaround options needed.

When `implicitPage` was `true` (the old npm package default), any `@section` outside an explicit `@page` triggered insertion of `layout_page_open` with `class="page"` and `data-page="auto"`, creating an invisible page boundary around every floating section and pulling it onto its own Paged.js page.

### 2.6 Legacy HR Plugin — Safe to Remove

`page-marker-hr.ts` and `page-marker-plugin.ts` implement the deprecated `--- {page .foo}` syntax. They are registered at `index.ts:144–145` with a comment marking them deprecated. They produce `<section class="page ...">` elements (not `<div class="page">`), which still match the `.page { break-before: page }` PAGED_CSS rule.

These can be removed once no source files use `--- {page}` syntax. A grep for `{page` or `--- {page}` in all `.md` files in any project would confirm safety.

### 2.7 `:::two-column` vs `@section .two-column` — Undocumented Divergence

`:::two-column` (registered via `markdownItContainer`) produces `<div class="two-column">` — no `section` prefix class.  
`@section .two-column` produces `<div class="section two-column">`.

Both match `.two-column { columns: 2 }` in `page-templates.css:157–162` and render identically for most purposes. However:
- `@section .two-column` also matches `.section { break-inside: avoid }` from PAGED_CSS → gets column break protection
- `:::two-column` does not → no protection

This difference is not documented anywhere. Authors migrating from `:::two-column` to `@section .two-column` get subtly different paging behavior.

### 2.8 PAGED_CSS `.section { break-inside: avoid }` — Cascade Trap

This rule lives in the inline `<style>` block that comes after all `<link>` stylesheets. Any user attempt to override `break-inside` on `.section` elements with a same-specificity rule in linked CSS will silently lose. The only override paths are higher specificity (e.g., `.section.col-split { break-inside: auto }`) or `data-pagedjs-ignore` on the inline style.

**Additionally:** `.section.col-split { display: flex }` in `page-templates.css` (specificity 0,2,0) does not declare `break-inside`. The lower-specificity PAGED_CSS `.section { break-inside: avoid }` rule still applies to `.section.col-split` elements via the cascade. If Paged.js respects `break-inside: avoid` on a flex container, col-split sections may refuse to break across pages even when overflow demands it.

---

## Part 3: CSS Architecture Violations and Maintenance Hazards

### 3.1 CSS Load Order

Complete cascade from first to last (later wins at equal specificity):

| # | File | Mechanism |
|---|------|-----------|
| 1 | `dc-tokens.css` | via `@import` in `index.css` |
| 2 | `dc-core.css` | via `@import` in `index.css` |
| 3 | `dc-components.css` | via `@import` in `index.css` |
| 4 | `page-templates.css` | via `@import` in `index.css` |
| 5 | `page-rules.css` | via `@import` in `index.css` |
| 6 | `dg-overrides.css` | via `@import` in `index.css` |
| 7 | `fg-overrides.css` | via `@import` in `index.css` |
| 8 | `PAGED_CSS` | inline `<style>` **after** `<link>` — wins over 1–7 at equal specificity |
| 9 | Plugin CSS | inline `<style>` after PAGED_CSS |
| 10 | Paged.js generated rules | last; highest priority |

### 3.2 Architectural Contract Violations

| Severity | File | Line | Violation |
|----------|------|------|-----------|
| HIGH | `fg-overrides.css` | 349 | `@page citizen-file:right { ... }` — `@page` declaration outside `page-rules.css` |
| HIGH | `dg-overrides.css` | 523, 533 | `@page :left` and `@page :right` re-declared — `@page` ownership split across two files |
| MEDIUM | `dc-components.css` | 2265, 2273 | `column-count: 2` — `columns:N` outside `page-templates.css` (sole owner per contract) |
| MEDIUM | `dg-overrides.css` | 218, 312 | `columns: 2` and `columns: 1` — same contract violation |
| LOW | `dc-components.css` | 38–41 | `.chapter { display: block }` — chapter scaffold rule belongs in `dg-overrides.css` |
| LOW | `dc-tokens.css` | 221–236 | Utility classes (`.fg1`, `.accent-*`, `.font-*`) — component-level abstractions in the tokens file |
| LOW | `dc-tokens.css` | 241–246 | `@media print { h1 { ... } }` — element override in the tokens file; belongs in `dc-core.css` |
| LOW | `dc-core.css` | — | No `ARCHITECTURAL CONTRACT` header; not listed in CLAUDE.md CSS layer table |

### 3.3 Named Page Inventory and Break Risks

| Selector | Named page | Risk |
|----------|-----------|------|
| `.page.full-bleed`, `.full-page` | `full` | Two selectors wire the same page — redundant but harmless |
| `.chapter-start` | `chapter-start` | Correct. `!important` on margin suppression is required and justified. |
| `.chapter-end` | `chapter-end` | No `:left/:right` variants — Paged.js `:left/:right` specialization re-injects default binding margins |
| `.pmd-suppress-footer` | `clean` | Same as above — no `:left/:right` variants |
| `.page.citizen-file` | `citizen-file` | Only `:right` variant defined — left-hand pages show no running header (asymmetric) |
| `.dc-specialty-art` | `full` | `break-before: page` + `page: full` inside a multi-column container → forces each art element to its own page, disrupts column reflow |

### 3.4 Critical Bugs Found

**`var(--border-default)` is undefined.**  
`fg-overrides.css:415` — `.page.citizen-file td:first-child { border: 1pt solid var(--border-default) }`. The token `--border-default` is not defined in any CSS file. The browser silently falls back to `currentColor` → black 1pt border on all citizen-file table cells instead of a hairline.

**`@page citizen-file` missing `:left` variant.**  
Only `@page citizen-file:right` is defined. Left-hand citizen-file pages have no running header (`@top-right` content). The asymmetry is unintentional.

**Paged.js CDN version is uncontrolled.**  
`src/lib/markdown/index.ts:229` — `https://unpkg.com/pagedjs/dist/paged.polyfill.js`. Unversioned CDN reference. A breaking Paged.js publish would affect all users without any code change. Builds fail when offline.

### 3.5 Token System Leaks (Hardcoded Values)

Specialty variant colors are defined as tokens in `dc-tokens.css` (`--cybersurgeon-dark`, `--wirephreak-dark`, `--streetwarden-dark`, `--technosorcerer-dark`, `--gutterdruid-dark`, `--etherlock-dark`) but are **not referenced** in `dc-components.css`. Instead, hardcoded hex literals duplicate the token values:

- `dc-components.css:224` — `#707070` (should be `var(--cybersurgeon-mid)`)
- `dc-components.css:229` — `#606060` (should be `var(--cybersurgeon-dark)`)
- `dc-components.css:291` — `#7a3a7a` (should be `var(--wirephreak-dark)`)
- `dc-components.css:325` — `#2a5a1a` (should be `var(--streetwarden-dark)`)
- `dc-components.css:359` — `#2a3a6a` (should be `var(--technosorcerer-dark)`)
- (similar for `--gutterdruid-dark`, `--etherlock-dark`)

When tokens change, component colors do not update.

### 3.6 `rem` Units in Print Context

`dc-tokens.css:156–162` defines all heading font size tokens in `rem` units (`--fs-h1: 1.5rem`, etc.). In Paged.js, `1rem` resolves against the browser-default `html { font-size: 16px }` — not the design's 12pt body floor. This means `1.5rem = 24px ≈ 18pt` rather than the intended `1.5 × 12pt = 18pt`. The math happens to produce the same output only if 16px = 12pt, which is not true at standard screen DPI (96dpi). At print DPI (72pt/in) the mismatch is measurable.

`dc-tokens.css:241–246` explicitly patches `h1 { font-size: 26pt }` to escape this. h2–h6 have no such patch and drift from design intent.

---

## Part 4: Recommendations

### R-1 (HIGH) — Fix `colSplitDepth` Reset Between File Renders

**Location:** `src/lib/markdown/index.ts:67`  
**Action:** Before each `md.render(content)` call in the file loop, reset the counter:

```typescript
colSplitDepth = 0;
const html = md.render(content);
```

Or better: move `colSplitDepth` inside `createMarkdownRenderer` and expose a `render()` wrapper that resets it.

### R-2 (HIGH) — Fix `var(--border-default)` Undefined Token

**Location:** `fg-overrides.css:415`  
**Action:** Replace with `var(--border-hairline)` which is defined in `dc-tokens.css`.

### R-3 (HIGH) — Pin Paged.js to a Specific Version

**Location:** `src/lib/markdown/index.ts:229`  
**Action:** Pin the CDN URL to a specific version:

```html
<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>
```

Better long-term: add `pagedjs` as a dev dependency and embed via `with { type: "file" }` so it works offline and in the compiled binary.

### R-4 (HIGH) — Move `@page citizen-file` to `page-rules.css` and Add `:left` Variant

**Action:** Move the `@page citizen-file:right { ... }` block from `fg-overrides.css:349` to `page-rules.css`. Add a matching `@page citizen-file:left { ... }` variant to produce a symmetric running header.

### R-5 (MEDIUM) — Consolidate All `@page` Declarations into `page-rules.css`

**Locations:** `dg-overrides.css:523,533`, `fg-overrides.css:349`  
**Action:** Move all `@page` blocks into `page-rules.css`. Override files may reference named pages via `page: <name>` on selectors, but `@page <name> { ... }` blocks must live in `page-rules.css`.

### R-6 (MEDIUM) — Move `columns:N` Violations to `page-templates.css`

**Locations:** `dc-components.css:2265,2273`, `dg-overrides.css:218,312`  
**Action:** Move all `column-count`/`columns` declarations to `page-templates.css` under appropriately named selectors.

### R-7 (MEDIUM) — Add `.section.col-split { break-inside: auto }` to PAGED_CSS

**Location:** `src/lib/markdown/index.ts:29`  
**Action:** Add a counteracting rule so col-split sections can paginate freely:

```typescript
const PAGED_CSS = `
.md-page-break { break-before: page; }
.page { break-before: page; }
.spread { break-before: page; }
.section { break-inside: avoid; }
.section.col-split { break-inside: auto; }
.md-column-break { break-after: column; height: 0; font-size: 0; line-height: 0; visibility: hidden; }
`;
```

### R-8 (MEDIUM) — Replace Specialty Hardcoded Hex with Token References

**Locations:** `dc-components.css:224,229,291,296,325,359,394,428`  
**Action:** Replace each hardcoded `#RRGGBB` with `var(--<specialty>-dark)` or `var(--<specialty>-mid)` from `dc-tokens.css`.

### R-9 (MEDIUM) — Add `:left/:right` Variants for `chapter-end` and `clean` Named Pages

**Locations:** `page-rules.css:170–182, 238–246`  
**Action:** Add `@page chapter-end:left`, `@page chapter-end:right`, `@page clean:left`, `@page clean:right` blocks that explicitly declare margin boxes to prevent bleed-through from `@page :left/:right`.

### R-10 (LOW) — Remove Legacy HR Plugin

**Locations:** `src/lib/markdown/page-marker-hr.ts`, `src/lib/markdown/page-marker-plugin.ts`, `index.ts:144–145`  
**Pre-condition:** Confirm no source files use `--- {page}` syntax.  
**Action:** Remove both files and their `md.use()` registrations.

### R-11 (LOW) — Document `dc-core.css` in CLAUDE.md and Add Its ARCHITECTURAL CONTRACT

**Action:** Add `dc-core.css` to the CSS layer table in CLAUDE.md with its ownership (`html/body baseline, element resets, h1–h6 default styles`). Add an ARCHITECTURAL CONTRACT header to its first 50 lines.

### R-12 (LOW) — Fix `rem` Unit on Heading Font Size Tokens

**Location:** `dc-tokens.css:156–162`  
**Action:** Convert `--fs-h*` tokens from `rem` to `pt`. Remove the `@media print { h1 { font-size: 26pt } }` patch in `dc-tokens.css:241–246` once tokens are corrected.

---

## Part 5: The Col-Split Solution — Why It Works and Its Limits

**Root cause:** Paged.js strips `break-after: column` from CSS and writes `data-break-after="column"` as a DOM attribute. The chunker does not act on value `"column"`. CSS column breaks are therefore impossible.

**Col-split solution:** Authors add `.col-split` to `@section .two-column`. The `layout_section_open` renderer in `index.ts` detects this class and performs a lookahead for `layout_column_break` within the same scope. If found, it wraps content in explicit `<div class="col">` divs. CSS `display: flex` on `.section.col-split` renders them side by side.

**Why this is sound:**
- The structural split happens at HTML generation time, before Paged.js touches the document
- Flex layout is not processed by Paged.js's break machinery — it is native browser layout inside each page content area
- Column widths are equal (`flex: 1`) — no manual width management required

**Limits:**
- Exactly one `@column-break` per col-split section
- Nesting col-split sections is impossible (`@section` is flat-scoped by design)
- Very tall col-split sections overflow the page rather than reflow — they must fit on one page

**Decision guide:**
- `@section .two-column` — body text that should auto-balance across columns; can paginate across pages
- `@section .two-column .col-split` — deliberate two-column placement where you control exactly what goes left vs. right; must fit on one page

---

## Appendix: File Reference Index

| File | Role | Key issues |
|------|------|-----------|
| `src/lib/markdown/markdown-it-paged.js` | Inlined layout marker plugin | `colSplitDepth` not reset between renders |
| `src/lib/markdown/index.ts` | Rendering pipeline | PAGED_CSS cascade order; CDN version uncontrolled |
| `src/lib/markdown/page-marker-hr.ts` | Legacy HR plugin | Deprecated; safe to remove |
| `src/lib/markdown/page-marker-plugin.ts` | Legacy HR core rule | Deprecated; safe to remove |
| `css/dc-tokens.css` | Token definitions | `rem` units; utility classes belong in dc-components.css |
| `css/dc-core.css` | Base element styles | No ARCHITECTURAL CONTRACT header |
| `css/dc-components.css` | Component styles | `column-count` violations; hardcoded hex instead of tokens |
| `css/page-templates.css` | Column and page layout | `break-after: column` on `.column-break` is still dead CSS (PATCH-4 deferred) |
| `css/page-rules.css` | `@page` declarations | `chapter-end`, `clean` missing `:left/:right` variants |
| `css/dg-overrides.css` | Design guide chrome | `@page :left/:right` split across files; `columns:N` violations |
| `css/fg-overrides.css` | Field guide overrides | `@page citizen-file` in wrong file; `var(--border-default)` undefined |
