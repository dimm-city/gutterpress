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

**[Critical]** `body::after` grain overlay (lines ~517–524) uses `position: fixed`. Fixed positioning does not exist in the Paged.js pagination model, which fragments the document into discrete page boxes. This rule either silently does nothing in the PDF, or renders once on page one only. Either wrap it in `@media screen` (matching the now-guarded `body.grain::before` above it) or document precisely what it achieves in PDF output and add a print-safety test note.

**[High]** `hr` element uses `opacity: 0.5` — this is a screen-only effect silently ignored in Paged.js PDF output. The dashed crimson rule will render at full opacity, likely too dark against the cream surface. Replace with a pre-blended color value (e.g., `border-top-color: #e8a0a0`) and remove the `opacity` declaration.

**[High]** Stub token block (lines ~301–321) duplicates canonical tokens under different names. `--base-font-size: 10pt` duplicates `--fs-base`; `--line-height-tight: 1.25` duplicates `--lh-tight`; `--line-height-normal: 1.5` duplicates `--lh-normal`. A future maintainer editing `--lh-tight` will miss the stub copy and create split-brain behavior. Resolve by either removing the stubs and making `dc-brand.css` self-contained, or replacing every stub with an explicit alias: `--line-height-tight: var(--lh-tight)`.

**[High]** `.dc-note-label` is defined twice — once at lines ~900–910 inside `.dc-note`, and again at lines ~2424–2433 with different `font-size` and `letter-spacing` values. The second definition likely belongs to `.dc-note-callout` specifically but reuses the same class name, making cascade order load-bearing. Extract the second block to `.dc-note-callout .dc-note-label` to make scoping explicit.

**[High]** `display: grid !important` on `.dc-roll-table-compare-stage` (line ~2583). This `!important` is a symptom of an unresolved specificity conflict. Identify the overriding rule and fix specificity directly rather than escalating.

**[Medium]** Mixed raw `px` and `pt` across component rules. `.dc-sticker` uses `8px`, `5px`, `10px`; `.dc-ap` uses `6px 9px`; `.dc-sub-header` uses `10px`, `14px`. For a reference print system, component padding and gaps should consistently reference spacing tokens or use `pt`/`in` units. Audit every component block and replace ad-hoc pixel padding with token references.

**[Medium]** `a:hover` and other hover rules are meaningless in print output. Move to a `@media screen` block or a dedicated screen-override section at the bottom of the file.

**[Medium]** `@media screen and (max-width: 1100px)` (line ~2588) and `@media screen and (max-width: 900px)` (line ~2639) — responsive breakpoints buried in a print-first file with no other responsive rules. These are design-guide preview-only concerns. Move them to `guide.css` or group them into a clearly marked "SCREEN PREVIEW" section at the file tail.

**[Medium]** `--dc-roll-table-roll--crit/hit/mixed/miss/fail` modifier classes (lines ~2558–2562) all resolve to `color: var(--orange)`. The comment says "reserved for future differentiation" but shipping identical no-op classes invites confusion. Either implement the differentiation or remove the modifier classes.

**[Low]** `#root` rule — a bare ID selector in a component stylesheet. Replace with a class or remove if unused.

**[Low]** `NEW:` comment prefix on a dozen components (lines ~982, 1024, 1106, 1143, 1213, etc.) are stale editorial markers. Strip the `NEW:` prefix and align all section headers to the established `/* ───────── COMPONENT NAME ───────── */` pattern.

**[Low]** `mix-blend-mode: multiply` on `.dc-art-img` (line ~1674) — blend modes may not composite correctly in all PDF renderers and will produce incorrect results with CMYK assets. Add a comment flagging this as a screen-preview approximation requiring print proof verification.

**[Low]** `user-select: none` on `.dc-arrow` and `.dc-art-slot-ghost` — harmless in print but meaningless. Remove from print-facing rules.

**[Low]** `text-wrap: pretty` and `text-wrap: balance` — CSS4 properties silently ignored by Paged.js. Fine as progressive enhancement but should carry a comment noting they are screen-only and do not affect PDF output.

**[Low]** `repeating-linear-gradient` in `.dc-tape::before/after` — print-safe in Chromium but dashed gradient patterns at low opacity can disappear at 300 DPI halftone screening. Add a QA note in the component comment.

### Structural Refactors

**Split the "BOOK PREVIEW MAPPINGS" section into its own file.** Lines ~1714–2769 are a parallel design vocabulary layered on top of the DC component vocabulary — `.page`, `.wrapper`, `.specialty`, `.sidebar`, `.terms`, `.header`, and their descendants. This material targets the live field-guide preview and the legacy content layer, not the DC brand itself. Moving it to `preview-mappings.css` would reduce `dc-brand.css` from ~2,750 lines to roughly 1,700 and make it clear which rules ship with a new book project vs. which are specific to this design guide.

**Move responsive `@media` queries to `guide.css`.** The two `@media screen and (max-width: …)` blocks at the file tail have no business being in a print-first brand file.

### Token Architecture Improvements

**Resolve the stub block's identity.** For open-source distribution, either: (a) delete the stub block entirely and promote stub values to first-class canonical tokens, or (b) keep the block but rename every stub to an explicit alias of its canonical peer with a comment naming the source. The current state — `--line-height-normal: 1.5` and `--lh-normal: 1.5` both existing — is the worst outcome.

**Bridge `--fs-body-sm` and stub `--small-font-size`.** These represent the same concept. Add `--fs-body-sm: var(--small-font-size, 11pt)` and document the bridge.

**Remove or promote `--fg5: #a8a097`** — only `--fg*` token without a named `--ink-*` peer. Either delete it or add a companion `--ink-fog: #a8a097` to the ink scale.

**Rename `--border-soft` and `--border-card`** — ambiguous names. Rename to `--border-paper-edge` and `--border-card-outline` and audit all usages.

**Remove six stub tokens that have no callers:** `--hud-border-soft`, `--card-header-bg`, `--card-border-width`, `--card-font-size`, `--card-body-height` — declared in the stub block, never consumed in any rule. Either use them in component rules or document them as extension points in a separate configuration block, not mixed into the working `:root`.

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

**Misplaced rules in page-rules.css.** Lines ~483–496 of `page-rules.css` contain `.pagedjs_sheet`, `.page`/`.page-break` base resets, and `.column-break`. These are content-layer element rules, not `@page` declarations. `.pagedjs_sheet { background-color }` belongs in `content-templates.css` alongside the other `.page` resets (currently at lines ~407–411 of `content-templates.css`). `.column-break` is a layout utility and belongs there too.

**Conceptual model ambiguity.** The current doc comment says page-rules.css owns "paged-media chrome (.pagedjs_*)". That is partially untrue: lines ~332–336 contain `.pagedjs_page.pagedjs_named_page.pagedjs_chapter-start_page …` selectors that override rendered margin-box content. The rationale is defensible (they directly relate to `@page chapter-start`) but should be documented explicitly — otherwise developers will assume all `.pagedjs_*` selectors belong in page-rules.css and scatter rendered-DOM overrides there.

**Recommendation:** Move `.pagedjs_sheet`, `.page`, `.page-break`, and `.column-break` base rules (page-rules.css lines ~479–496) into `content-templates.css`. Add a rule in the page-rules.css header: "The only `.pagedjs_*` selectors allowed here are those that directly suppress or override `@page` margin-box content."

### Named Page Inventory

| `@page` name | `page:` assigned via | Status |
|---|---|---|
| _(default)_ | implicit | ✅ `:left`/`:right` variants defined |
| `citizen-file` | `.page.citizen-file, .page-break.citizen-file` | ✅ `:left` page has empty body — add binding margin or delete |
| `front-matter` | `.page-break.toc, .page-break.intro, .page.toc, .page.intro, …` | ⚠️ `.page.toc`/`.page-break.toc` appear in BOTH `front-matter` AND `full` — stale entry in `front-matter` block should be removed |
| `full` | `.page.toc, .page.page-full-bleed, .page.cover, .page.back-cover, .page.credits` | ✅ |
| `colophon` | `.page-break.colophon, .page.colophon, …` | ✅ |
| `chapter-start` | `.chapter-start` | ✅ Footer suppression requires `.pagedjs_*` DOM hack — document why |
| `chapter-end` | _(none found)_ | 🔴 **Gap** — declared with full `:left`/`:right` variants, but no selector assigns `page: chapter-end`. Wire it up or delete |
| `clean` | _(none)_ | ⚠️ Reserved with comment. Add `.page.clean { page: clean; }` or delete the block |
| `aug` | `.aug, .page-aug` | ✅ `:left`/`:right` variants defined |

**Critical conflict:** `.page-break.toc` and `.page.toc` appear in both the `front-matter` and `full` assignment blocks. The `full` block wins (later in source). The `front-matter` block's inclusion is either stale or wrong — remove `.page.toc`/`.page-break.toc` from the `front-matter` block.

**Target state:** One-to-one correspondence — every named page has exactly one selector block assigning it, every selector block maps to exactly one named page, no class is assigned to multiple named pages.

### The .page.chapter-02 Specificity Problem

Lines ~256–289 of `content-templates.css` carry selectors of the form:

```css
.page.chapter-02:not(.full-page):not(.chapter-start):not(.init):not(.outcome-table):not(.rolling-die)
```

The two `:not()` exclusion chains are inconsistent: `.rolling-die` is excluded from the column rule but not from h3/h4 typography rules; `.upgrading` and `.choose-specialty` are excluded from h3/h4 rules but not from columns. This is a latent rendering bug — a `.page.chapter-02.rolling-die` page gets heading demotes but not the column layout suppression.

**Ideal architecture:** Invert the scoping with a positive utility class:

```css
.page.chapter-02.two-col { columns: 2; … }
.page.chapter-02.two-col h3 { … }
.page.chapter-02.two-col h4 { … }
```

Pages that are exceptions opt out by not carrying `.two-col`. If inverting the HTML class contract is out of scope, at minimum ensure both the column rule and the typography rules use an identical exclusion list, and define the list in a comment at the top of the chapter-02 block.

### Counter Ownership

The `chapter` counter is currently split across three locations:

1. `guide.css` line ~65: `body { counter-reset: chapter }` — initializes to 0
2. `guide.css` line ~43: `div.chapter > h1:first-of-type { counter-increment: chapter }` — auto-increments
3. `page-rules.css` lines ~80–102: `.page.chapter-NN` and `.chapter-start.chapter-NN` — hard-reset to a specific integer per page (the reliable Paged.js workaround)

The auto-increment (2) is a ghost — it fires but is overridden on every body page by the per-page hard-reset, making it a source of confusion with no functional value. **page-rules.css should own all chapter counter manipulation.**

**Migration:** Move `body { counter-reset: chapter }` from `guide.css` into page-rules.css adjacent to the per-chapter resets. Remove `counter-increment: chapter` from `guide.css`. Add a comment in `guide.css` pointing to page-rules.css as the counter owner.

### Remaining Issues

**[Medium]** `@page aug` uses `@bottom-left-corner` and `@bottom-right-corner` margin boxes (page-rules.css lines ~444–455). These are not part of CSS Paged Media L3 and Paged.js does not implement them — the footer content silently produces no output. Use `@bottom-left` and `@bottom-right` instead, consistent with every other named page in the file.

**[Medium]** `.full-page` geometry has `width: 8.625in; height: 11.25in` hardcoded, duplicating the `@page` size values. These silently break if page size is changed. Derive from CSS custom properties (`var(--page-width)`, `var(--page-height)`) defined once in dc-brand.css.

**[Medium]** CSS nesting in `.toc ol, .toc ul` (content-templates.css lines ~101–107) — nested `ul { border: none }` and a flat fallback `.toc ul ul { border: none }` at line ~133 are contradictory. Pick one form; flat selectors are safer and clearer.

**[Low]** Duplicate `padding-bottom` in `.toc` — two consecutive declarations (`0.6in` then `0.9in`) in the same `.toc` rule. The first is dead. Remove it.

---

## guide.css and index.css

### Remaining Issues

**[High]** Bare-element selectors (`pre`, `pre code`, `:not(pre) > code`, `table`, `th`, `td`, `h2`, `h3`, `h4`) are globally unscoped (lines ~73–161). These match any element anywhere in the rendered document, not just design-guide specimens. This is the primary reason guide.css cannot be lifted and reused in another project without a full audit. `table`/`th`/`td` styling especially belongs in dc-brand.css scoped to a `.dc-table` class — only the `break-inside: avoid` and margin overrides are genuinely guide-specific.

**[High]** Heading break-avoidance block (lines ~73–92) duplicates what content-templates.css already sets (`.page h2`/`h3` at lines ~387–391 of content-templates.css). Not a bug today, but a maintenance trap — tuning one location will not update the other.

**[Medium]** `div.ch-toc.toc` (line ~199) is a fragile specificity workaround that only beats `content-templates.css` by coincidence of import order. If `content-templates.css` ever loads after `guide.css`, it breaks silently. The correct fix: give the design guide TOC a dedicated class (`.guide-toc`) that doesn't collide with the book system's `.toc` at all.

**[Low]** `padding-right: 0.5in` comment on `div.ch-toc.toc` says "prevents right-column overflow in single-column TOC layout" but the original comment incorrectly referenced the left margin. The comment is now fixed, but the value (0.5in) doesn't match the actual page inner margin (0.75in). Either make them match or add a note explaining the deliberate mismatch.

### Scope Discipline

The correct test: **Would this rule need to exist if there were no design guide document, only a regular DC book?** Rules that pass the test belong in dc-brand.css or content-templates.css. Rules that fail belong in guide.css.

Applied to the current file:
- `pre` styling ✅ — guide.css (code blocks appear here because the guide documents CSS)
- `table`/`th`/`td` block ❌ — belongs in dc-brand.css as `.dc-table`; only `break-inside: avoid` and margin overrides are guide-specific
- Heading break rules ❌ — mostly a book-system concern; belong in content-templates.css scoped to `.page`
- `.specimen`, `.break-before`, `#ch-toc`/`div.ch-toc` ✅ — guide-only concerns

### Missing Utilities

- **`.pmd-no-break` / `.pmd-keep-together`** — no complementary utility for forcing a run of elements to stay on the same page without anchoring to a break-before. Authors currently reach for `.specimen` (which implies a visual border) when they need a page-break containment wrapper with no chrome.
- **`.pmd-col-span`** — no utility for forcing an element to span both columns on a two-column page.
- **`.pmd-specimen-inline`** — a companion to `.specimen` without the border/padding chrome, for prose specimens that should sit flush in a column without the inset box treatment.
- **`.pmd-suppress-footer`** — no utility to suppress the running footer on an arbitrary page. The `clean` named page is reserved in page-rules.css for exactly this; wiring it to a class would expose the feature without requiring CSS edits.

### index.css as a Configuration Surface

The current 10-line `index.css` is a transparent assembly manifest. That is clean, but adaptation requires forking all four downstream files. A more useful pattern would add:

1. A `@import url("./project-overrides.css")` hook at the end (CSS allows silent failure if the file is absent in some loading contexts, or it can be an empty stub committed to the repo).
2. A `:root` block immediately after the dc-brand.css import enumerating the token surface an adapter is expected to override: `--page-background-color`, `--font-body`, `--font-display`, `--font-mono`, `--ink`, `--accent-color1`, `--gutter`, `--page-margin`, etc.

Enumerating those custom properties in one place — even as a comment block — turns index.css from a loading manifest into a legible configuration surface. Right now that contract is implicit and scattered across dc-brand.css.

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

| Priority | Count | Key items |
|---|---|---|
| Critical | 2 | `body::after` with `position:fixed` in print context; named page `chapter-end` declared but never assigned |
| High | 7 | `hr opacity`, stub token duplication, `.dc-note-label` doubled, `!important` on roll table, `.toc` named-page conflict, chapter-02 `:not()` inconsistency, counter split ownership |
| Medium | 12 | Mixed `px`/`pt` units, hover rules in print context, responsive breakpoints in dc-brand.css, `@page aug` wrong margin-box names, `.full-page` hardcoded dimensions, unscoped bare-element selectors in guide.css, CSS nesting ambiguity, and others listed per section |
| Low | 8 | `NEW:` comment markers, `--fg5` orphan, `text-wrap` CSS4 no-ops, `.dc-arrow user-select`, etc. |
| Structural (multi-session) | 4 | Split dc-brand.css into tokens + components; add index.css configuration surface; scope guide.css to `div.chapter`; author `ADAPTING.md` and `css/README.md` |
