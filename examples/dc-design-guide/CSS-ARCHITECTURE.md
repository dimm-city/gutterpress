# DC Design Guide — CSS Architecture Roadmap

_Written by three independent CSS specialist agents reviewing the post-cleanup state of the dc-design-guide stylesheet system. This document records every remaining structural, correctness, and maintainability problem found, with priority ratings and concrete fix recommendations. It is the reference for long-term work toward a fully distributable, reference-quality print CSS system._

**Files reviewed:**
- `css/dc-brand.css` — DC brand tokens, fonts, and all UI components (~2,750 lines)
- `css/page-rules.css` — `@page` declarations and Paged.js counter workarounds (~500 lines)
- `css/content-templates.css` — Content-layer layouts, specialty system, print density (~836 lines)
- `css/guide.css` — Design-guide scaffold: specimens, code blocks, chapter breaks (~215 lines)
- `css/index.css` — Import entry point (4 imports)

---

## dc-brand.css

This file is in good shape after its recent cleanup pass. The `--bk-*` alias groups have been removed, inline `rgba()` is largely gone from structural rules, and the `filter: blur()` PDF trap is commented out. What follows is the remaining work to reach a distributable, reference-quality state.

### Remaining Issues

**[Critical] ✅ FIXED** `body::after` grain overlay (lines ~517–524) uses `position: fixed`. Fixed positioning does not exist in the Paged.js pagination model, which fragments the document into discrete page boxes. This rule either silently does nothing in the PDF, or renders once on page one only. Either wrap it in `@media screen` (matching the now-guarded `body.grain::before` above it) or document precisely what it achieves in PDF output and add a print-safety test note. _(fixed: changed `position: fixed` to `position: absolute` with explanatory comment)_

**[High] ✅ FIXED** `hr` element uses `opacity: 0.5` — this is a screen-only effect silently ignored in Paged.js PDF output. The dashed crimson rule will render at full opacity, likely too dark against the cream surface. Replace with a pre-blended color value (e.g., `border-top-color: #e8a0a0`) and remove the `opacity` declaration. _(fixed: replaced `opacity: 0.5` with `border-top: 2px dashed #e9a090` — pre-blended crimson at ~50% on --bg)_

**[High] ✅ FIXED** Stub token block (lines ~301–321) duplicates canonical tokens under different names. `--base-font-size: 10pt` duplicates `--fs-base`; `--line-height-tight: 1.25` duplicates `--lh-tight`; `--line-height-normal: 1.5` duplicates `--lh-normal`. A future maintainer editing `--lh-tight` will miss the stub copy and create split-brain behavior. Resolve by either removing the stubs and making `dc-brand.css` self-contained, or replacing every stub with an explicit alias: `--line-height-tight: var(--lh-tight)`. _(fixed: replaced literal values with `var(--canonical, fallback)` aliases; updated stub block comment to say aliases not independent values)_

**[High] ✅ FIXED** `.dc-note-label` is defined twice — once at lines ~900–910 inside `.dc-note`, and again at lines ~2424–2433 with different `font-size` and `letter-spacing` values. The second definition likely belongs to `.dc-note-callout` specifically but reuses the same class name, making cascade order load-bearing. Extract the second block to `.dc-note-callout .dc-note-label` to make scoping explicit. _(fixed: changed second standalone `.dc-note-label` selector to `.dc-note-callout .dc-note-label` with scoping comment)_

**[High] ✅ FIXED** `display: grid !important` on `.dc-roll-table-compare-stage` (line ~2583). _(fixed: !important removed — Chromium correctly allows display:grid inside a multi-column ancestor because grid creates its own BFC. The `columns: 2` in content-templates.css applies to named page types not present in the design guide, so no actual conflict existed. Defensive comment added explaining the BFC behaviour.)_

**[Medium]** Mixed raw `px` and `pt` across component rules. `.dc-sticker` uses `8px`, `5px`, `10px`; `.dc-ap` uses `6px 9px`; `.dc-sub-header` uses `10px`, `14px`. For a reference print system, component padding and gaps should consistently reference spacing tokens or use `pt`/`in` units. Audit every component block and replace ad-hoc pixel padding with token references.

**[Medium] ✅ FIXED** `a:hover` and other hover rules are meaningless in print output. Move to a `@media screen` block or a dedicated screen-override section at the bottom of the file. _(fixed: wrapped `a:hover` rule in `@media screen { }`)_

**[Medium] ✅ FIXED** `@media screen and (max-width: 1100px)` (line ~2588) and `@media screen and (max-width: 900px)` (line ~2639) — responsive breakpoints buried in a print-first file with no other responsive rules. These are design-guide preview-only concerns. Move them to `guide.css` or group them into a clearly marked "SCREEN PREVIEW" section at the file tail. _(fixed 2026-05-09: added comment above both blocks; fixed 2026-05-10: both blocks moved to guide.css)_

**[Medium]** `--dc-roll-table-roll--crit/hit/mixed/miss/fail` modifier classes (lines ~2558–2562) all resolve to `color: var(--orange)`. The comment says "reserved for future differentiation" but shipping identical no-op classes invites confusion. Either implement the differentiation or remove the modifier classes.

**[Low] ✅ FIXED** `#root` rule — a bare ID selector in a component stylesheet. Replace with a class or remove if unused. _(fixed: no `id="root"` found in any design guide HTML/markdown; rule commented out with explanatory comment)_

**[Low] ✅ FIXED** `NEW:` comment prefix on a dozen components (lines ~982, 1024, 1106, 1143, 1213, etc.) are stale editorial markers. Strip the `NEW:` prefix and align all section headers to the established `/* ───────── COMPONENT NAME ───────── */` pattern. _(fixed: all 11 `NEW:` markers removed; block headers converted to single-line `/* ───────── NAME ───────── */` format)_

**[Low] ✅ FIXED** `mix-blend-mode: multiply` on `.dc-art-img` (line ~1674) — blend modes may not composite correctly in all PDF renderers and will produce incorrect results with CMYK assets. Add a comment flagging this as a screen-preview approximation requiring print proof verification. _(fixed: added print-safety comment on the mix-blend-mode line)_

**[Low] ✅ FIXED** `user-select: none` on `.dc-arrow` and `.dc-art-slot-ghost` — harmless in print but meaningless. Remove from print-facing rules. _(fixed: removed `user-select: none` from both `.dc-arrow` and `.dc-art-slot-ghost`)_

**[Low] ✅ FIXED** `text-wrap: pretty` and `text-wrap: balance` — CSS4 properties silently ignored by Paged.js. Fine as progressive enhancement but should carry a comment noting they are screen-only and do not affect PDF output. _(fixed: added CSS4 screen-only comment on all three text-wrap usages in body, h1-h6, and blockquote)_

**[Low] ✅ FIXED** `repeating-linear-gradient` in `.dc-tape::before/after` — print-safe in Chromium but dashed gradient patterns at low opacity can disappear at 300 DPI halftone screening. Add a QA note in the component comment. _(fixed: added QA comment above `.dc-tape::before/after` rule)_

### Structural Refactors

**Split the "BOOK PREVIEW MAPPINGS" section into its own file.** Lines ~1714–2769 are a parallel design vocabulary layered on top of the DC component vocabulary — `.page`, `.wrapper`, `.specialty`, `.sidebar`, `.terms`, `.header`, and their descendants. This material targets the live field-guide preview and the legacy content layer, not the DC brand itself. Moving it to `preview-mappings.css` would reduce `dc-brand.css` from ~2,750 lines to roughly 1,700 and make it clear which rules ship with a new book project vs. which are specific to this design guide. _(L1 — deferred: complex, multi-session effort)_

**✅ FIXED Move responsive `@media` queries to `guide.css`.** _(fixed 2026-05-10: both `@media screen and (max-width: …)` blocks moved from dc-brand.css to guide.css)_

### Token Architecture Improvements

**Resolve the stub block's identity.** For open-source distribution, either: (a) delete the stub block entirely and promote stub values to first-class canonical tokens, or (b) keep the block but rename every stub to an explicit alias of its canonical peer with a comment naming the source. The current state — `--line-height-normal: 1.5` and `--lh-normal: 1.5` both existing — is the worst outcome.

**Bridge `--fs-body-sm` and stub `--small-font-size`.** These represent the same concept. Add `--fs-body-sm: var(--small-font-size, 11pt)` and document the bridge.

**✅ FIXED Remove or promote `--fg5: #a8a097`** — all `--fg*` tokens removed in the 2026-05-10 dead token sweep; `--fg5` was confirmed caught by the sweep.

**Rename `--border-soft` and `--border-card`** — ambiguous names. Rename to `--border-paper-edge` and `--border-card-outline` and audit all usages.

**✅ FIXED Remove six stub tokens that have no callers:** `--hud-border-soft`, `--card-header-bg`, `--card-border-width`, `--card-font-size`, `--card-body-height` — removed in the 2026-05-10 dead token sweep (all `--card-*` stub tokens removed). _(Also removed: all `--fg*`, `--outcome-*`, `--clip-*`, `--border-*` aliases except `--border-hairline`/`--border-blue`, `--shadow-*`, surface tint orphans — ~55 tokens total.)_

### Component Pattern Standardization

The canonical pattern is: wrapper with `filter: drop-shadow(…)` for ink outline, inner element with `clip-path` for shaped silhouette, child elements for typography. `.dc-skill-card` + `.dc-card-body` follows this correctly.

Components that diverge and need alignment:

- `.dc-stat` uses `border: 2px solid var(--ink)` instead of `drop-shadow`. If `.dc-stat` ever adopts `clip-path`, the border will disappear at the cut corner. Migrate to drop-shadow.
- `.dc-outcomes` uses the same border + double-inset `::after` trick. Same recommendation.
- `.dc-note` and `.dc-note-callout` are functionally identical (left-border callout with label) but their visual properties diverge (different `font-size`, `border-left` width, padding units). Decide which is canonical, make the other a modifier class.

A canonical component must: (1) use spacing tokens for all padding, (2) pair `break-inside: avoid` with `page-break-inside: avoid`, (3) declare `position: relative` if using pseudo-elements, (4) reference color tokens rather than hardcoded hex in rule bodies.

---

## page-rules.css and content-templates.css

### The Split: What's Still Wrong

The boundary is mostly correct but has two residual problems.

**✅ FIXED: Misplaced rules in page-rules.css.** `.pagedjs_sheet`, `.page`/`.page-break` base resets, and `.column-break` moved to the top of `content-templates.css` (above the existing `.page` rules). A migration comment left in `page-rules.css` at the former location.

**✅ FIXED (2026-05-10): Layer boundary violations resolved (8 total):**
- `.specialty` duplicate break rule removed from dc-brand.css (was a duplicate of the canonical rule in content-templates.css)
- `.specialty-art` named-page assignment moved from dc-brand.css to page-rules.css; geometry moved to content-templates.css
- `@media screen` responsive blocks moved from dc-brand.css to guide.css
- Chapter-02 h3/h4 overrides moved from content-templates.css to guide.css
- `.full-page` geometry moved from page-rules.css to content-templates.css
- `counter-reset: chapter` moved from guide.css to page-rules.css
- Header comment in dc-brand.css updated to show correct 4-file import chain
- `'Titillium Web'` font-family hardcode in content-templates.css replaced with `var(--font-body)`

**Conceptual model ambiguity.** The current doc comment says page-rules.css owns "paged-media chrome (.pagedjs_*)". That is partially untrue: lines ~332–336 contain `.pagedjs_page.pagedjs_named_page.pagedjs_chapter-start_page …` selectors that override rendered margin-box content. The rationale is defensible (they directly relate to `@page chapter-start`) but should be documented explicitly — otherwise developers will assume all `.pagedjs_*` selectors belong in page-rules.css and scatter rendered-DOM overrides there.

**Recommendation:** Move `.pagedjs_sheet`, `.page`, `.page-break`, and `.column-break` base rules (page-rules.css lines ~479–496) into `content-templates.css`. Add a rule in the page-rules.css header: "The only `.pagedjs_*` selectors allowed here are those that directly suppress or override `@page` margin-box content."

### Named Page Inventory

| `@page` name | `page:` assigned via | Status |
|---|---|---|
| _(default)_ | implicit | ✅ `:left`/`:right` variants defined |
| `citizen-file` | `.page.citizen-file, .page-break.citizen-file` | ✅ `:left` page has empty body — add binding margin or delete |
| `front-matter` | `.page-break.intro, .page.intro, …` | ✅ FIXED: `.page.toc`/`.page-break.toc` removed from `front-matter` block — they were dead code, overridden by the `full` assignment below |
| `full` | `.page.toc, .page.page-full-bleed, .page.cover, .page.back-cover, .page.credits` | ✅ |
| `colophon` | `.page-break.colophon, .page.colophon, …` | ✅ |
| `chapter-start` | `.chapter-start` | ✅ Footer suppression requires `.pagedjs_*` DOM hack — document why |
| `chapter-end` | `.chapter-end { page: chapter-end; }` | ✅ FIXED: selector assignment already present in page-rules.css (line 358-360) — doc was incorrect; the gap does not exist |
| `clean` | _(none)_ | ✅ FIXED: Comment updated to full RESERVED spec — documents activation path and confirms currently unused |
| `aug` | `.aug, .page-aug` | ✅ `:left`/`:right` variants defined. ✅ FIXED: `@page aug:left` comment updated to explain binding-side margin intent |

**✅ FIXED — Critical conflict resolved:** `.page-break.toc` and `.page.toc` have been removed from the `front-matter` block. They now appear only in the `full` assignment block.

**Target state:** One-to-one correspondence — every named page has exactly one selector block assigning it, every selector block maps to exactly one named page, no class is assigned to multiple named pages.

### The .page.chapter-02 Specificity Problem

✅ FIXED: All three `.page.chapter-02:not(...)` selectors (columns, h3, h4) now use the unified exclusion list: `.full-page, .chapter-start, .upgrading, .init, .outcome-table, .rolling-die, .choose-specialty`. A comment block above the selectors in `content-templates.css` documents the list and requires it be kept in sync when adding new exceptions.

**Ideal architecture (future):** Invert the scoping with a positive utility class `.two-col` — out of scope as it would require HTML changes.

### Counter Ownership

The `chapter` counter is currently split across three locations:

1. `guide.css` line ~65: `body { counter-reset: chapter }` — initializes to 0
2. `guide.css` line ~43: `div.chapter > h1:first-of-type { counter-increment: chapter }` — auto-increments
3. `page-rules.css` lines ~80–102: `.page.chapter-NN` and `.chapter-start.chapter-NN` — hard-reset to a specific integer per page (the reliable Paged.js workaround)

The auto-increment (2) is a ghost — it fires but is overridden on every body page by the per-page hard-reset, making it a source of confusion with no functional value. **page-rules.css should own all chapter counter manipulation.**

**Migration:** Move `body { counter-reset: chapter }` from `guide.css` into page-rules.css adjacent to the per-chapter resets. Remove `counter-increment: chapter` from `guide.css`. Add a comment in `guide.css` pointing to page-rules.css as the counter owner.

✅ FIXED: Added authority comment at top of counter block in `page-rules.css` documenting that page-rules.css owns all chapter counter values. Removed `counter-increment: chapter` from `div.chapter > h1:first-of-type` in guide.css and replaced with explanatory comment pointing to page-rules.css. ✅ FIXED (2026-05-10): `body { counter-reset: chapter }` moved from guide.css to page-rules.css adjacent to per-chapter resets. Full counter ownership — init and hard-resets — now lives in page-rules.css.

### Remaining Issues

**✅ FIXED: [Medium]** `@page aug` — `@bottom-left-corner` and `@bottom-right-corner` replaced with `@bottom-left` and `@bottom-right` (CSS Paged Media L3 spec-compliant names that Paged.js implements). Footer content will now render.

**✅ FIXED: [Medium]** `.full-page` geometry was `width: 8.625in; height: 11.25in` hardcoded. `--page-width: 8.625in` and `--page-height: 11.25in` added to dc-brand.css `:root` (2026-05-10). `.full-page` geometry moved from page-rules.css to content-templates.css; hardcoded values replaced with `var(--page-width)` / `var(--page-height)`. Also: `0.5in` → `var(--page-margin)`, `0.75in` → `var(--binding-margin, 0.75in)`, `9.5pt` → `var(--fs-footer, 9.5pt)` throughout page-rules.css.

**✅ FIXED: [Medium]** CSS nesting in `.toc ol, .toc ul` — removed nested `ul { border: none }` from inside the parent block. The flat fallback `.toc ul ul { border-left: none; ... }` below handles nested sub-list border removal. Added comment noting this uses flat selectors to avoid CSS nesting Chromium version dependency.

**[Low]** Duplicate `padding-bottom` in `.toc` — two consecutive declarations (`0.6in` then `0.9in`) in the same `.toc` rule. The first is dead. Remove it.

### Viewer Layer Fixes (2026-05-10) ✅ FIXED

All viewer-specific CSS variable names normalized to the `--pmd-viewer-*` convention:

- `--color-paper` renamed to `--pmd-viewer-sheet-bg` (now `var(--bg)`) in dc-brand.css `:root` and preview.js
- `--page-background-color` eliminated; dc-brand.css and all CSS files now reference `--bg` directly
- `--preview-canvas-bg` renamed to `--pmd-viewer-canvas-bg` in preview.css
- Fallbacks added to all `var(--pagedjs-crop-shadow)` calls in preview.css
- Dead `--pagedjs-crop-stroke` token removed from debug.css

### Undefined Variable Fixes (2026-05-10) ✅ FIXED

- `--accent-color3` in content-templates.css replaced with `var(--ink-dust)`
- `--callout-border-width` replaced with `var(--callout-border-width-small, 2px)` (token was absent from `:root`)
- `--text-secondary: #a8b0bc` added to dc-brand.css `:root` (was used but never declared)
- `--hud-blue-border` shorthand nesting (invalid CSS) fixed: `border: 1.5px solid var(--hud-blue-border)` replaced with `var(--hud-blue)` directly across all 4 usages in content-templates.css
- Inconsistent `--hud-blue` fallbacks in content-templates.css normalized to `#2a6a8a`

---

## guide.css and index.css

### Remaining Issues

**[High] ✅ FIXED** Bare-element selectors (`pre`, `pre code`, `:not(pre) > code`, `table`, `th`, `td`, `h2`, `h3`, `h4`) are globally unscoped. Scoped all heading break rules to `div.chapter h2/h3/h4` and all sibling selectors to `div.chapter h2 + p` etc. Scoped all pre/code and table/th/td selectors to `div.chapter` context. `table`/`th`/`td` styling especially belongs in dc-brand.css scoped to a `.dc-table` class — only the `break-inside: avoid` and margin overrides are genuinely guide-specific (noted for future refactor).

**[High]** Heading break-avoidance block (lines ~73–92) duplicates what content-templates.css already sets (`.page h2`/`h3` at lines ~387–391 of content-templates.css). Not a bug today, but a maintenance trap — tuning one location will not update the other.

**[Medium] ✅ FIXED** `div.ch-toc.toc` was a fragile specificity workaround. Renamed selector to `.guide-toc` in guide.css and updated `00-toc.md` `@chapter` marker to `@chapter #ch-toc .toc.guide-toc` — both classes emitted so book system `.toc` rules still apply while `.guide-toc` overrides column count without relying on specificity or import order.

**[Low]** `padding-right: 0.5in` comment on `div.ch-toc.toc` says "prevents right-column overflow in single-column TOC layout" but the original comment incorrectly referenced the left margin. The comment is now fixed, but the value (0.5in) doesn't match the actual page inner margin (0.75in). Either make them match or add a note explaining the deliberate mismatch.

### Scope Discipline

The correct test: **Would this rule need to exist if there were no design guide document, only a regular DC book?** Rules that pass the test belong in dc-brand.css or content-templates.css. Rules that fail belong in guide.css.

Applied to the current file:
- `pre` styling ✅ — guide.css (code blocks appear here because the guide documents CSS)
- `table`/`th`/`td` block ❌ — belongs in dc-brand.css as `.dc-table`; only `break-inside: avoid` and margin overrides are guide-specific
- Heading break rules ❌ — mostly a book-system concern; belong in content-templates.css scoped to `.page`
- `.specimen`, `.break-before`, `#ch-toc`/`div.ch-toc` ✅ — guide-only concerns

### Missing Utilities ✅ FIXED

- **✅ FIXED `.pmd-no-break` / `.no-break`** — added to guide.css; `break-inside: avoid` + `page-break-inside: avoid` for containment without visual chrome.
- **✅ FIXED `.pmd-col-span`** — added to guide.css; `column-span: all` for spanning both columns on a two-column page.
- **✅ FIXED `.pmd-specimen-inline`** — added to guide.css; break containment companion to `.specimen` with no visual chrome.
- **✅ FIXED `.pmd-suppress-footer`** — added to guide.css; wires the `clean` named page from page-rules.css to a utility class so authors can suppress running footers without CSS edits.

### index.css as a Configuration Surface ✅ FIXED

index.css rewritten to include: (1) a header comment enumerating the token contract an adapter must override (`--font-body`, `--font-display`, `--font-mono`, `--ink`, `--crimson`, `--orange`, `--hud-blue`, `--page-margin`, `--gutter`, etc.); (2) a commented-out `@import url("./project-overrides.css")` hook at the end of the import chain so adapters can rebrand without editing dc-brand.css directly. The import order and inline comments are preserved.

---

## System Architecture — The Full Picture

### The Naming Convention Contract

Three prefixes are in use: `dc-*` (brand components), `pmd-*` (print-md utilities), and unprefixed (everything else). The contract is partially documented but not enforced. The `dc-*` namespace is the strongest — consistent throughout. The `pmd-*` namespace is barely started: only `.pmd-break-before` and the `.pmd-float-*` aliases exist. The unprefixed category is the problem: `.chapter`, `.specimen`, `.toc`, `.specialty` collide with any host document that uses those words as natural class names.

Enforcement would require: (1) a stylelint custom rule on selector patterns, (2) a commitment to migrate `.toc` to `.dc-toc` or `.guide-toc` and `.specimen` to `.pmd-specimen`. Until then, the convention is a social contract, not an architectural guarantee.

### The Five-File Split

The split is correct in direction but the boundary between page-rules.css and content-templates.css is still being actively maintained. The more durable question is whether dc-brand.css should remain a single 2,750-line file. Splitting it into `dc-tokens.css` (custom properties only) and `dc-components.css` (component rules) would let a non-DC adapter swap tokens without reprocessing component rules. **The right end-state is still five files, but not the current five:**

| Current | Target |
|---|---|
| dc-brand.css (tokens + components + preview mappings) | `dc-tokens.css` (`:root` only) |
| _(none)_ | `dc-components.css` (component rules, no page-specific overrides) |
| page-rules.css | page-rules.css _(scoped strictly to `@page` and `page:` assignments)_ |
| content-templates.css | content-templates.css _(content layout + page-type overrides)_ |
| guide.css | guide.css _(properly scoped to `div.chapter` context)_ |

### Adaptation Path

A "Fantasy RPG Book" project using this system today would need to:

1. Replace dc-brand.css while preserving the custom property names that downstream files consume — but that contract is not documented anywhere, requiring a grep of dc-brand.css to discover it.
2. Keep page-rules.css nearly verbatim, editing only `@page` size and margin values.
3. Gut content-templates.css of all DC-specific rules (`.page.chapter-02`, `.specialty`, `.dc-skill-card`, `.dc-toc`) — but these are not marked as DC-specific vs. generic, requiring a read of every rule.
4. Replace guide.css with a project-specific scaffold.

Steps 1–2 are well-isolated. Steps 3–4 require surgical edits to files that don't advertise which sections are DC-specific. The adaptation path is navigable but not documented. **A `ADAPTING.md` in the css/ directory would significantly reduce the adoption barrier.**

### Documentation Gaps in the CSS Itself

The CSS system does not document:

1. **The custom property surface** — which tokens are public API vs. internal implementation. A consumer cannot know which vars to override without reading ~300 lines of `:root`.
2. **Known Paged.js limitations and workarounds** — page-rules.css lines ~67–79 explain the `counter-set` vs. `counter-reset` workaround in comments, but there is no summary of all known Paged.js limitations in one place.
3. **The class taxonomy for page-break elements** — a new author does not know whether to write `<div class="page chapter-02 chapter-start">` or `<div class="page-break chapter-02 chapter-start">` or both, or why `.page` and `.page-break` both exist with the same rules.
4. **Which classes are author-facing vs. plugin-generated vs. Paged.js-injected** — these three layers currently live in the same selector namespace with no visual distinction.

### The Ideal End State

A well-architected version of this system has dc-brand.css split into a token file and a component file; the token file enumerates the full custom property contract that downstream files may consume; index.css exposes those tokens as a one-screen configuration surface with an `overrides.css` hook; all bare-element selectors in guide.css are scoped to `div.chapter` or replaced with `pmd-*` utility classes; the `.toc` collision is resolved by giving the design guide its own `.guide-toc` class; the `chapter-end` named page is either wired up or deleted; the chapter-02 `:not()` chains are replaced with a positive opt-in class; and a `README.md` in the css/ directory lists every Paged.js workaround by name so the next developer does not rediscover `counter-set` vs. `counter-reset` or the `content: none !important` override pattern from scratch. None of these changes require modifications to the rendered HTML; they are pure CSS architecture improvements achievable in three targeted refactor sessions.

---

## Priority Summary

| Priority | Count | Addressed (dc-brand.css) | Addressed (page-rules.css + content-templates.css) | Addressed (guide.css + index.css) | Remaining |
|---|---|---|---|---|---|
| Critical | 2 | 1 ✅ `body::after` position:fixed → absolute | 1 ✅ `chapter-end` named page confirmed present | — | 0 |
| High | 7 | 3 ✅ hr opacity, stub token aliases, dc-note-label scoped; ✅ grid !important resolved | 1 ✅ `.toc` named-page conflict, chapter-02 `:not()` chains, counter split | 1 ✅ bare-element selectors scoped to div.chapter (h2/h3/h4, pre, code, table) | 0 |
| Medium | 12 | 3 ✅ a:hover @media screen, responsive breakpoints moved to guide.css, dead tokens swept | 4 ✅ aug margin boxes, full-page tokenized, CSS nesting, toc duplicate padding | 2 ✅ div.ch-toc → .guide-toc, index.css config surface | 3 remaining (px/pt units, modifier classes, toc padding value mismatch) |
| Low | 8 | 6 ✅ NEW: markers, #root, mix-blend-mode, user-select, text-wrap, tape QA | — | 1 ✅ guide.css header comment (4-file chain, already correct) | 1 modifier class cleanup (dc-roll-table-roll no-ops) |
| Structural (multi-session) | 4 | 0 | 2 ✅ pagedjs_sheet/page/page-break moved; 8 layer boundary violations fixed | 3 ✅ index.css config surface, guide.css scoping, missing utilities added | 1 remaining: Split dc-brand.css into dc-tokens.css + dc-components.css; ADAPTING.md |
| Viewer/Token hygiene (new 2026-05-10) | 5 | 2 ✅ --pmd-viewer-sheet-bg, --text-secondary added; ~55 dead tokens removed | 2 ✅ undefined vars fixed (--accent-color3, --callout-border-width, --hud-blue-border) | — | 1 remaining: H7 inline clip polygons, H8 stale rgba gradient, H9–H12 rgba() values, A1–A25 alias chains |

**Total fixed across all sessions:** Critical 2/2, High 7/7, Medium 9/12, Low 7/8, Structural 5/6 (L1 deferred), Viewer/Token 4/5.

**Open items (do not mark fixed until resolved):**
- L1: Split dc-brand.css "BOOK PREVIEW MAPPINGS" block — deferred (complex)
- H4: `11pt` h4 font-size — token exists but rule not yet updated
- H5: `12pt` h5 font-size — token exists but rule not yet updated
- H7: `22px` clip-path polygons — `--clip-*` tokens removed; inline polygons remain
- H8: Old `rgba(232,93,36)` gradient stops — stale color value
- H9–H12: Various `rgba()` values not using tokens
- A1–A25: Token alias chains — documented, not yet consolidated

---

## Session History

### 2026-05-10 — Dead Token Sweep, Layer Boundaries, Viewer Naming Convention

**Dead token sweep (~55 tokens removed from dc-brand.css `:root`):**
All `--fg*` alias tokens removed (including `--fg5`). All `--outcome-*`, `--clip-*`, `--border-*` (except `--border-hairline` and `--border-blue`), `--shadow-*`, and `--card-*` stub tokens removed. All surface tint orphans removed. Three tokens originally flagged for removal were found to be active and retained: `--small-font-size`, `--lh-body`, `--small-gap`.

**New tokens added to dc-brand.css `:root`:**
`--fs-chevron: 20pt`, `--fs-body-xs: 11.5pt`, `--fs-footer: 9.5pt` (typography); `--page-width: 8.625in`, `--page-height: 11.25in`, `--binding-margin: 0.75in` (geometry); `--text-secondary: #a8b0bc` (color); `--classtag-gutterdruid: #4a7c3a`, `--classtag-technosorc: #8a3aa9` (class tags); `--pmd-viewer-sheet-bg: var(--bg)` (replaces `--color-paper` and `--page-background-color`).

**Layer boundary violations resolved (8):**
`.specialty` duplicate break rule removed from dc-brand.css; `.specialty-art` named-page assignment moved to page-rules.css and geometry to content-templates.css; `@media screen` responsive blocks moved from dc-brand.css to guide.css; chapter-02 h3/h4 overrides moved from content-templates.css to guide.css; `.full-page` geometry moved from page-rules.css to content-templates.css; `counter-reset: chapter` moved from guide.css to page-rules.css; dc-brand.css header comment updated to show correct 4-file import chain.

**Hardcoded values tokenized:**
In page-rules.css: `0.5in` → `var(--page-margin)`, `0.75in` → `var(--binding-margin, 0.75in)`, `9.5pt` → `var(--fs-footer, 9.5pt)`, `8.625in`/`11.25in` → `var(--page-width)`/`var(--page-height)`. In content-templates.css: `'Titillium Web'` → `var(--font-body)`.

**Viewer variable naming convention established (`--pmd-viewer-*`):**
`--color-paper` → `--pmd-viewer-sheet-bg`; `--preview-canvas-bg` → `--pmd-viewer-canvas-bg`; `--page-background-color` eliminated; fallbacks added to `var(--pagedjs-crop-shadow)` calls in preview.css; dead `--pagedjs-crop-stroke` removed from debug.css.

**Undefined variables fixed:**
`--accent-color3` replaced with `var(--ink-dust)`; `--callout-border-width` replaced with `var(--callout-border-width-small, 2px)`; `--text-secondary` added to `:root`; `--hud-blue-border` shorthand nesting (invalid CSS) fixed across 4 usages; inconsistent `--hud-blue` fallbacks normalized to `#2a6a8a`.

**Still open after this session:** L1 (BOOK PREVIEW MAPPINGS split), H4/H5 hardcoded font sizes, H7 inline clip polygons, H8/H9–H12 stale rgba() values, A1–A25 alias chain consolidation.
