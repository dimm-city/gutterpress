# DC Design Guide — Redundancy & Dead Weight Audit
*Generated 2026-05-12 from 3-agent research pass*

## How to read this document

This document catalogues every redundant, dead, broken, or overlapping design element found across the DC design guide CSS, markdown source, and field guide content during a three-agent audit pass. Items are grouped into six categories:

- **REMOVE** — Zero usage confirmed OR confirmed functional bug that makes the item useless as-written. Safe to delete.
- **FIX** — Actively broken in the current implementation. Must be corrected before the item can be used.
- **CONSOLIDATE** — Two or more names that produce identical output. One should be declared canonical; the rest retired. Requires find-replace across field guide, design guide, AND plugin JS — not CSS only.
- **DROP FROM DESIGN GUIDE DOCS** — Documented in the spec but never used in the actual field guide book, and not planned for future adoption. These inflate the authoring reference without providing value to field guide authors.
- **PLANNED MIGRATION (4b)** — Currently undocumented or unused in the field guide, but the project is moving TOWARD these patterns. Keep in design guide docs; field guide adoption is planned.
- **MIGRATION TARGET (4c)** — Triple-colon `:::` container patterns that lack macro equivalents. The project is moving away from `:::wrapper {.class}` toward dedicated macros. Each needs a macro created.
- **CONSIDER RATIONALIZING** — Parallel systems that serve overlapping purposes through different mechanisms. Not urgent, but worth a deliberate decision.
- **TOKEN CLEANUP** — CSS custom property issues: duplicate values, near-identical tokens, documentation mismatches.

The **Summary Table** at the end provides a single flat list of every item with its category and priority.

---

## Category 1: REMOVE — Confirmed dead or broken

Items with zero usage anywhere in the field guide AND no CSS consumer, or confirmed functional bugs that make the item inoperative as written.

**`.dc-art-slot`** — Defined in CSS, never referenced in any markdown file or field guide chapter. Dead art-placeholder class.

**`.dc-art-slot-ghost`** — Same. Companion to `.dc-art-slot`, zero usage. Dead.

**`.dc-spread`** — Defined in CSS. Zero usage in field guide. The un-prefixed `.specialty-spread` (or its alias `.dc-specialty-spread`) is used instead where applicable.

**`.dc-class-hero`** — Dead CSS class. No field guide file uses it.

**`.dc-class-hero-row`** — Dead CSS class. No field guide file uses it.

**`.dc-class-hero-no`** — Dead CSS class. No field guide file uses it.

**`.dc-page`** — Defined in CSS, never used. Not to be confused with `@page` at-rules.

**`.dc-page-num`** — Dead CSS class. Page numbers are handled by `@page` counter rules, not this class.

**`.dc-chapter-num`** — Dead CSS class. Chapter numbering is done via the `@chapter-opener` macro or raw HTML `<span class="dc-chapter-opener-no">`, not this class.

**`.dc-path-block-wrap`** — Superseded by `.dc-path-shell`. Dead. The replacement is actively used; this is a leftover rename artifact.

**`.font-banner`** — CSS class referencing a removed token. The token no longer exists; any element using this class silently falls back to an undefined font. Dead and misleading.

**`.dc-p`** — Dead CSS class. No markdown or field guide usage found.

**`.dc-display-char`** — Dead CSS class. Zero field guide usage.

**`.dc-quote-label`** — Dead CSS class. Zero field guide usage.

**`.dc-art-credit`** — Dead CSS class. Zero field guide usage.

**`.dc-art-img`** — Dead CSS class. Zero field guide usage. Image float classes are used instead.

**`.dc-portrait-inner`** — Dead CSS class. Zero field guide usage.

**`.dc-2col`** — Dead CSS class. Zero field guide usage. The un-prefixed `.two-column` or the ability-specific grid variants are used instead.

**`.dc-2col.dc-2col-mt`** — Dead compound selector. Both the base class and this modifier are unused.

**`.two-col-list`** — Referenced in CSS but the *defined* name is `.two-column-list`. The CSS rule for `.two-col-list` is orphaned — nothing generates this class. (Note: this is a different issue from the alias pair documented in Category 3 — the alias itself exists in CSS but no markdown generates the un-suffixed form.)

**Empty/placeholder elements in source:**
- One completely empty `::: wrapper {.full-page}:::` block in the Streetwarden file. No content, no purpose. Should be removed from source.
- Multiple empty `.item` slots in chapter-05. Dead placeholder markup.

---

## Category 2: FIX — Functional bugs that need correction

Items that are actively broken in the current implementation and will not render correctly until fixed.

**`.note-callout` vs `.dc-note-callout` — plugin/CSS naming mismatch (CRITICAL)** ✅ FIXED 2026-05-12
The markdown-it plugin that handles `!!! Label` admonition syntax emits `class="note-callout"` (no prefix). The CSS file defines `.dc-note-callout` (with `dc-` prefix). The class `note-callout` has no CSS rule. Result: every `!!!` admonition in the field guide renders completely unstyled. **Fixed:** plugin updated to emit `dc-note-callout` (`dimm-city-plugin.js` line 394).

**`@chapter-opener` macro — inconsistent usage and bypass** ✅ FIXED 2026-05-12
Only 2 of the 10+ chapters use the `@chapter-opener` macro (`C.01` and `C.11`). Chapter-02 bypasses the macro entirely with raw HTML `<span class="dc-chapter-opener-no">C.02</span>`. The 8 specialty files use no opener at all. **Fixed:** `chapter-02 0.md` updated to use `@chapter-opener C.02`. The `dc-note` div block and `dc-sidebar` div block in chapter-02 have also been converted to `> [!NOTE]` alert syntax and `:::wrapper {.dc-sidebar}` container syntax respectively.

**Malformed container syntax in field guide**
Several containers use quoted class names (`{".specialty-spread"}`, `{".human-callout"}`) and mixed `class=` / `.class` attribute syntax. Depending on the markdown-it-container parser version, these may silently fail to apply the intended class, resulting in unstyled containers. Each case should be audited and normalized to unquoted dot-notation (e.g., `{.specialty-spread}`).

**`--bg` token value mismatch**
`02-palette.md` documents `--bg` as `#d4d4d4`. The actual definition in `dc-brand.css` is `#d3cec6`. Any author who reads the design guide and hard-codes `#d4d4d4` expecting it to match `--bg` will get a visible colour mismatch. Fix: update `02-palette.md` to show the true hex value, or update `dc-brand.css` to match the documented value.

---

## Category 3: CONSOLIDATE — Alias pairs and duplicates

Items where two or more names produce identical CSS output. One name should be declared canonical; all aliases should be deprecated and eventually removed. Where the field guide already has a clear preference, that is noted.

**IMPORTANT: Any consolidation (retiring an alias) requires a full find-replace across ALL of: field guide markdown files, design guide markdown files, AND the Dimm City plugin JS. Renaming a class in CSS only is not sufficient — the plugin may be emitting the old class name, and field guide/design guide markdown may contain the old class name as explicit attributes. Before retiring any alias, run: `grep -r "old-class" field-guide/ design-guide/ plugins/` and update every occurrence.**

**Float image classes — three names, one behaviour:**
Keep **`.img-float-right`**, retire **`.pmd-float-right`** and **`.dc-art-float-right`** — all three float images right with identical rules. The un-prefixed form is most readable in markdown. Similarly for left-float if a `.dc-art-float-left` counterpart exists. Before retiring: `grep -r "pmd-float-right\|dc-art-float-right" field-guide/ design-guide/ plugins/`

**`.roll-lucid` / `.dc-roll-lucid`:**
Keep **`.dc-roll-lucid`** (consistent with DC namespace), retire **`.roll-lucid`** — identical CSS. Before retiring: `grep -r "roll-lucid" field-guide/ design-guide/ plugins/`

**`.roll-surreal` / `.dc-roll-surreal`:**
Keep **`.dc-roll-surreal`**, retire **`.roll-surreal`** — identical CSS. Before retiring: `grep -r "roll-surreal" field-guide/ design-guide/ plugins/`

**`.tag` / `.dc-tag`:**
Keep **`.dc-tag`**, retire **`.tag`** — identical CSS, DC namespace is the project convention. Before retiring: `grep -r '"tag"\|\.tag' field-guide/ design-guide/ plugins/`

**`.break-before` / `.pmd-break-before`:**
Keep **`.pmd-break-before`** (vendor-scoped), retire **`.break-before`** — identical CSS. Prefixed form avoids collision with any browser or Paged.js internal. Before retiring: `grep -r "break-before" field-guide/ design-guide/ plugins/`

**`.no-break` / `.pmd-no-break`:**
Keep **`.pmd-no-break`**, retire **`.no-break`** — identical CSS. Before retiring: `grep -r '"no-break"\|\.no-break' field-guide/ design-guide/ plugins/`

**`.sidebar` / `.dc-sidebar`:**
Keep **`.dc-sidebar`**, retire **`.sidebar`** — identical CSS. Before retiring: `grep -r '"sidebar"\|\.sidebar' field-guide/ design-guide/ plugins/`

**`.two-column-list` / `.two-col-list`:**
Keep **`.two-column-list`** (the form that actually has a CSS definition), retire **`.two-col-list`** — identical intent. Note: `.two-col-list` as a markdown-generated class appears to be the dead reference documented in Category 1; the CSS alias in this pair refers to a separate rule that does exist. Before retiring: `grep -r "two-col-list" field-guide/ design-guide/ plugins/`

**`.section-header` / `.header`:**
Keep **`.section-header`** (descriptive), retire **`.header`** — identical CSS. Before retiring: `grep -r '"header"\|\.header' field-guide/ design-guide/ plugins/`

**`.specialty-intro` / `.dc-specialty-intro`:**
Keep **`.specialty-intro`** (the un-prefixed form is used in field guide), retire **`.dc-specialty-intro`** — identical CSS. Alternatively, adopt the `dc-` prefix consistently and update all field guide usage. Before retiring: `grep -r "dc-specialty-intro" field-guide/ design-guide/ plugins/`

**`.specialty-spread` / `.dc-specialty-spread`:**
Keep **`.specialty-spread`** (used in field guide), retire **`.dc-specialty-spread`** — identical CSS. Before retiring: `grep -r "dc-specialty-spread" field-guide/ design-guide/ plugins/`

**`.specialty-card` / `.dc-specialty-card`:**
Keep **`.specialty-card`** (used in field guide), retire **`.dc-specialty-card`** — identical CSS. Before retiring: `grep -r "dc-specialty-card" field-guide/ design-guide/ plugins/`

**`.specialty-art` / `.dc-specialty-art`:**
Keep **`.specialty-art`** (used in field guide), retire **`.dc-specialty-art`** — identical CSS. Before retiring: `grep -r "dc-specialty-art" field-guide/ design-guide/ plugins/`

**`.columns` / `.dense`:**
Keep **`.columns`** as the base; `.dense` as a modifier is fine if it changes density. If both produce *identical* output, retire **`.dense`**. Audit whether they are truly identical or if `.dense` changes column-gap/font-size. Before retiring: `grep -r '"dense"\|\.dense' field-guide/ design-guide/ plugins/`

**Terms list — four names, one pattern:**
`.dc-terms`, `.dc-terms-list`, `.terms`, `.terms-list` — all produce the same terms/glossary list. Keep **`.dc-terms`** as canonical, retire the other three. Before retiring: `grep -r "dc-terms-list\|\"terms\"\|terms-list" field-guide/ design-guide/ plugins/`

**`.pmd-specimen-inline` duplicates `.pmd-no-break`:**
Both are `break-inside: avoid` with no other rules. Keep **`.pmd-no-break`** (semantic name for the behaviour), retire **`.pmd-specimen-inline`** or repurpose it with additional rules that justify a distinct name. Before retiring: `grep -r "pmd-specimen-inline" field-guide/ design-guide/ plugins/`

**`.lede` / `.dc-intro` — two authoring paths for one element:**
`:::lede` container and `:::wrapper {.dc-intro}` both produce `.dc-intro`. Keep **`:::lede`** as the canonical authoring form (it is the macro-style shorthand the rest of the system uses), retire the `:::wrapper {.dc-intro}` pattern. Document `:::lede` as the single source of truth. Before retiring: `grep -r "dc-intro" field-guide/ design-guide/ plugins/`

---

## Category 4: DROP FROM DESIGN GUIDE DOCUMENTATION — Documented but not used in the book

Items fully documented in the design guide spec but absent from every field guide source file. These inflate the authoring reference and create a false impression of what authors need to learn. They should be removed from the spec docs (or moved to an appendix of "available but unused" features) until the field guide actually adopts them.

**NOTE on one-off `@page .class` names:** One-off `@page .class` classes are intentional and correct — they are the mechanism for per-page styling in this system. Do not remove them from the design guide. Even if a class appears only once in the book, documenting it teaches authors how `@page` naming works for custom page styling. The entries below are exclusively for items that are genuinely undocumented patterns, broken aliases, or systems with zero usage — not for named pages.

**GFM alert preference:** For callout-style components (boxed notes, DM instructions, flavor text, pull quotes), `> [!TYPE]` GFM alert syntax is preferred over `:::container` syntax when both exist for the same component. `> [!PULLQUOTE]` is preferred over `:::pull-quote`. Layout primitives (sidebar, two-column, procedure) still use `:::` until their macro equivalents are built.

**All `> [!TYPE]` callout variants — entire callout alert system:** *(Status: KEEP + PROMOTE — GFM alert syntax is now the preferred authoring path for callout components)*
`> [!NOTE]`, `> [!DM]`, `> [!VIBE]`, `> [!ORIGIN]`, `> [!GEAR]`, `> [!VISIT]`, `> [!FLAVOR]`, `> [!WARNING]`, `> [!PULLQUOTE]` — previously zero occurrences in the field guide, but GFM alert syntax is now the preferred authoring path for callout-style components. The `> [!TYPE]` form is preferred over `:::container` equivalents. These must remain in the design guide docs as the primary callout authoring reference.

**`> [!PULLQUOTE]` variant specifically** — also covered under Category 5 (two pull-quote authoring paths): `> [!PULLQUOTE]` is now the preferred form over `:::pull-quote`. Update the pull-quote section in design guide docs to reflect this preference.

**`@chapter-opener` numbering** — the macro is documented as the canonical way to inject a chapter number, but 8 of the 10 chapters don't use it (specialty files use none; chapter-02 uses raw HTML). Until usage becomes consistent, the design guide should note the macro's actual adoption rate rather than presenting it as a universal pattern.

**`@specialty`, `@learning-path`, `@skill` macros in specialty chapters** — these *are* used (all 8 specialty files), so they stay in the docs. Listed here for completeness: they are the primary layout mechanism for specialty chapters and require zero `@page` directives, which is worth noting explicitly in the design guide.

---

## Category 4b: PLANNED MIGRATION — Field guide to adopt these macros

These items are currently undocumented or underused in the field guide, but the project is moving TOWARD more macro usage, not away from it. The field guide will be updated to use these as macro adoption expands. Do NOT remove them from the design guide; instead, mark them as "coming to field guide" and ensure they are well-documented.

**`@section` macro** — documented in `07-markdown-reference.md`, zero usage in the field guide currently. Intended for adoption in the field guide as a structural section delimiter macro. Keep in design guide docs; add a note that field guide migration is planned.

**`@spread` macro** — documented in `07-markdown-reference.md`, zero usage in the field guide currently. Intended for adoption in the field guide for two-page spread layouts. Keep in design guide docs; add a note that field guide migration is planned.

**`@break` macro** — the field guide uses `---` HR syntax exclusively for page breaks today. `@break` is the macro-based equivalent and is intended to replace raw HR usage as macro adoption expands. Keep in design guide docs; add a note that field guide migration from `---` to `@break` is planned.

---

## Category 4c: MIGRATION TARGET — Triple-colon containers needing macro equivalents

The project is moving away from the `:::wrapper {.class}` and `:::container {.class}` authoring patterns toward either dedicated macros (verb-first, no class syntax) or standardized Dimm City plugin extension syntax. Each item below currently lacks a macro equivalent and needs one created.

Macros that already exist (`@skill`, `@learning-path`, `@specialty`, `@outcome`, `@chapter-opener`, `@chapter`, `@page`, `@section`, `@spread`, `@break`) are NOT listed here — they are covered or planned elsewhere.

- **`:::sidebar` / `:::wrapper {.dc-sidebar}`** → needs `@sidebar` macro
- **`:::lede` / `:::wrapper {.dc-intro}`** → needs `@lede` macro (or `@intro`); `:::lede` is the current canonical form but should eventually become `@lede`
- **`:::pull-quote` / `:::wrapper {.dc-pullquote}`** → needs `@pullquote` macro
- **`:::procedure`** → needs `@procedure` macro
- **`:::item`** → needs scoping decision (currently used inside `@learning-path`, `:::two-column`, etc.); may become context-aware or require a namespaced form
- **`:::two-column` / `:::: two-column`** → needs `@two-column` macro or a page template equivalent
- **`:::three-column`** → needs `@three-column` macro
- **`:::wrapper {.dc-definition-block}`** → needs `@definition` macro
- **`:::wrapper {.dc-sidebar-box}`** → needs `@sidebar-box` macro
- **`:::wrapper {.dc-toc}`** → the TOC is auto-generated; this wrapper may stay as a structural container or be absorbed into the chapter template; decision deferred
- **Generic `:::wrapper {.arbitrary-class}`** → should become `@wrap .class` or a dedicated macro per class; the open-ended wrapper pattern is an escape hatch, not an authoring primitive

---

## Category 5: CONSIDER RATIONALIZING — Overlapping systems

Parallel systems that serve similar purposes through different mechanisms. Not urgent, but each represents a decision that has been deferred and is accumulating authoring confusion.

**Two-column layout — six mechanisms:**
1. `.two-column` — generic two-column prose
2. `.dc-2col` — dead alias (Category 1)
3. `.dc-ability-2col` — ability-specific two-column
4. `.dc-ability-grid` — ability grid layout
5. `.columns` / `.dense` — column modifier pair
6. `.dc-procedure-grid` — procedure-specific grid

Recommendation: audit which of these produce meaningfully different column widths, gaps, or breakpoints. Consolidate any that are visually identical into a single class with optional modifiers.

**Three stat-grid patterns:**
1. `.dc-stat` + `.dc-stat-grid` + `.dc-stat-cell` — general NPC/creature stat block
2. `.citizen-at-a-glance` + `.citizen-stat` + `.citizen-stat-key` / `.citizen-stat-val` — citizen-file specific
3. `.at-a-glance-cards` + `.at-a-glance-card` — generic summary cards

Systems 1 and 3 are structurally similar (grid of labelled value cells). If the visual treatment is close enough, they could share a base class with a variant modifier. System 2 is citizen-file-specific and may intentionally differ.

**Two outcome table systems (complete, parallel, overlapping):** ✅ DONE 2026-05-12
1. `@outcome` macro → `.dc-outcomes` / `.dc-outcome-row` + modifiers — the macro-based authoring path (**canonical**)
2. Raw HTML `.dc-roll-table` / `.dc-roll-table-row` + parallel modifier classes — the hand-rolled HTML path (**deprecated**)

The HTML `<table class="dc-roll-table">` in `05-page-templates.md` was replaced with a full five-rung `@outcome` macro example. The `.dc-roll-table` CSS block in `dc-brand.css` was annotated with a deprecation comment. No visual properties from `.dc-roll-table` required porting — the color-coded name labels only function on a light background and do not translate to `.dc-outcomes` (dark key panel). The CSS block is retained until the dc-op-manual field guide CSS layer is confirmed clear of direct HTML usage.

**Two numbered procedure systems:**
1. `:::procedure` container → `.dc-steps` — macro/container authoring path
2. Legacy `.procedure > ol` CSS target — targets a `.procedure` class wrapping an `<ol>`, implying a different authoring pattern

The CSS for `.procedure > ol` suggests an older pattern. If no field guide file uses the `.procedure` class to wrap an `<ol>` directly (the `:::procedure` container is the current form), the legacy selector can be removed from CSS.

**Two pull-quote authoring paths:**
1. `:::pull-quote` container — the container/macro path
2. `> [!PULLQUOTE]` alert — the alert/callout path (now PREFERRED — see GFM alert preference note in Category 4)

`> [!PULLQUOTE]` is now the preferred authoring form. `:::pull-quote` remains valid but `> [!PULLQUOTE]` should be promoted as the primary path. Update design guide docs to reflect this preference.

**`.dc-note-callout` (DM Note) vs `.dc-note` (player Note):**
Nearly identical names, opposite intended audiences. A field guide author who confuses them will apply DM-facing styling to player-facing content or vice versa. Recommendation: rename one to increase visual distance — e.g., `.dc-dm-note` for the DM-facing variant, `.dc-player-note` for the player-facing variant.

**`.dc-gear-callout` vs `.gear-callout` naming confusion:**
`shared.css` defines a `.gear-callout` (no prefix) with `min-height: 3.5in` applied unconditionally. `.dc-gear-callout` does not have this `min-height`. Two nearly identical class names with subtly different box sizing. The un-prefixed `.gear-callout` may produce a very tall box when there is little content. Audit whether both are intentional or whether `.gear-callout` is a stale variant of `.dc-gear-callout`.

*Investigation needed:* Check `shared.css` in the DC design system for the `.gear-callout` (no prefix) rule with `min-height: 3.5in`. If this is a stale override, remove it. If intentional, document the distinction in the design guide.

**Atmospheric callout cluster — three near-identical classes:**
`.dc-vibe-callout`, `.dc-origin-callout`, `.dc-visit-callout` share identical structure and differ only by border colour and `::before` label text. They could be consolidated into a single `.dc-flavor-callout` class with a `data-label` attribute and a CSS custom property for accent colour — or remain as separate classes if the authoring ergonomics of named classes is preferred. Either is valid; what matters is the decision is explicit.

**Banner heading repetition — `.dc-chevron` vs five hard-coded selectors:**
`.dc-chevron` in CSS produces `background: var(--rust)` + `clip-path: var(--clip-banner)` + `color: var(--paper-cream)` + `font-family: var(--font-display)`. Five additional selectors in `content-templates.css` hard-code the same four declarations independently. Those five selectors could instead extend or compose `.dc-chevron`, eliminating the duplication and ensuring that changing the banner treatment only requires editing one rule.

---

## Category 6: TOKEN CLEANUP — CSS custom property issues

Duplicate values, documentation mismatches, and near-identical tokens that create confusion when authors try to use the token system.

**`--paper-stain: #d0c8b5` and `--border-hairline: #d0c8b5` — exact same hex value.**
These are semantically different concepts (a texture colour vs. a rule colour) but they happen to share the same value today. If the design evolves and one changes, the other should not follow automatically. The coincidence is not a problem unless authors start using one where the other is semantically correct. Document the coincidence explicitly, or give one a distinct value.

**`--fs-base: 12pt` and `--fs-body: 12pt` — exact same value.**
Two tokens for the same size. Determine which is the canonical body-text font size token and retire the other. All CSS that references the retired token must be updated to use the canonical one.

**`--space-2xl: 0.25in` and `--gutter: 0.25in` — exact same value.**
`--gutter` is a layout concept (column gutter); `--space-2xl` is a spacing-scale step. They happen to be the same today. Same risk as above: if gutter changes, spacing scale should not, and vice versa. Fine to keep both tokens if their semantics are truly distinct, but document the relationship explicitly.

**`--space-xs: 0.0833in` and `--space-sm: 0.08in` — within 0.32pt of each other.**
Effectively identical on a printed page. Authors choosing between `--space-xs` and `--space-sm` will produce visually indistinguishable results. Either merge them into one token or give them meaningfully different values (e.g., a proper 1.25× or 1.5× ratio step).

**`--fs-pullquote: 17pt` and `--fs-h2: 1.44rem (~17.3pt)` — within 0.3pt.**
At 12pt base, `1.44rem` = 17.28pt. A pullquote and an H2 are the same visual weight. If this is intentional (pullquotes should read like section headings), document it. If not, one value needs to change.

**`--fs-h1: 1.728rem (~20.7pt)` and `--fs-chevron: 20pt` — within 0.7pt.**
Same issue: H1 and banner heading tokens are nearly identical. If the banner heading should match H1 weight, use `--fs-h1` directly rather than a separate `--fs-chevron` token.

✅ FIXED 2026-05-12
**`--bg` documentation mismatch:**
`02-palette.md` documents `--bg` as `#d4d4d4`. The actual definition in `dc-brand.css` is `#d3cec6`. These are visually different (the CSS value is warmer/more beige). Fix: update `02-palette.md` to reflect the actual CSS value. Until fixed, any author who copies the hex from the palette doc will get a mismatch.

**Three undocumented font tokens:**
`--font-tab`, `--font-sans`, `--font-quote` appear in CSS but are not mentioned in `01-typography.md`. Authors cannot know these tokens exist, cannot use them intentionally, and cannot predict what will happen if they need to change the font assignment for tab labels, sans-serif prose, or quotes. Add all three to the typography spec, or if they are internal implementation details, prefix them with `--_` to signal they are private.

---

## Summary Table

| Item | Category | Priority | Notes |
|---|---|---|---|
| `.note-callout` / `.dc-note-callout` plugin mismatch | 2 — FIX | CRITICAL | ✅ FIXED 2026-05-12 — plugin updated to emit `dc-note-callout` |
| `--bg` hex mismatch in docs vs CSS | 2 — FIX | HIGH | ✅ FIXED 2026-05-12 — palette doc corrected to #d3cec6 |
| `@chapter-opener` bypass in chapter-02 | 2 — FIX | MEDIUM | ✅ FIXED 2026-05-12 — macro used; HTML fragments converted to markdown |
| Malformed container syntax (quoted class names) | 2 — FIX | MEDIUM | ✅ FIXED 2026-05-12 — 14 occurrences normalized in chapter-01, 03, 05 |
| `.dc-art-slot` | 1 — REMOVE | HIGH | Zero usage, no CSS consumer (agent completing) |
| `.dc-art-slot-ghost` | 1 — REMOVE | HIGH | Zero usage, no CSS consumer (agent completing) |
| `.dc-spread` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-class-hero` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-class-hero-row` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-class-hero-no` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-page` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-page-num` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-chapter-num` | 1 — REMOVE | HIGH | Zero usage (agent completing) |
| `.dc-path-block-wrap` | 1 — REMOVE | HIGH | Superseded by `.dc-path-shell` (agent completing) |
| `.font-banner` | 1 — REMOVE | HIGH | References removed token, silent fallback (agent completing) |
| `.dc-p` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-display-char` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-quote-label` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-art-credit` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-art-img` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-portrait-inner` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-2col` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.dc-2col.dc-2col-mt` | 1 — REMOVE | MEDIUM | Zero usage (agent completing) |
| `.two-col-list` (orphan CSS rule) | 1 — REMOVE | MEDIUM | Defined class is `.two-column-list`; this rule is unreachable (agent completing) |
| Empty `:::wrapper {.full-page}:::` in Streetwarden | 1 — REMOVE | LOW | Placeholder with no content (agent completing) |
| Empty `.item` slots in chapter-05 | 1 — REMOVE | LOW | Dead placeholder markup (agent completing) |
| `.img-float-right` / `.pmd-float-right` / `.dc-art-float-right` | 3 — CONSOLIDATE | HIGH | Three names, one float behaviour (agent completing) |
| `.roll-lucid` / `.dc-roll-lucid` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.roll-surreal` / `.dc-roll-surreal` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.tag` / `.dc-tag` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.break-before` / `.pmd-break-before` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.no-break` / `.pmd-no-break` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.sidebar` / `.dc-sidebar` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.two-column-list` / `.two-col-list` (alias) | 3 — CONSOLIDATE | MEDIUM | Alias pair (agent completing) |
| `.section-header` / `.header` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.specialty-intro` / `.dc-specialty-intro` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.specialty-spread` / `.dc-specialty-spread` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.specialty-card` / `.dc-specialty-card` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.specialty-art` / `.dc-specialty-art` | 3 — CONSOLIDATE | MEDIUM | Exact alias pair (agent completing) |
| `.columns` / `.dense` | 3 — CONSOLIDATE | LOW | Possibly identical output — verify first (agent completing) |
| `.dc-terms` / `.dc-terms-list` / `.terms` / `.terms-list` | 3 — CONSOLIDATE | MEDIUM | Four names, one pattern (agent completing) |
| `.pmd-specimen-inline` duplicates `.pmd-no-break` | 3 — CONSOLIDATE | LOW | Both are `break-inside: avoid` only (agent completing) |
| `:::lede` / `:::wrapper {.dc-intro}` | 3 — CONSOLIDATE | MEDIUM | Two authoring paths for `.dc-intro` (agent completing) |
| All `> [!TYPE]` callout variants (9 types) | 4 — KEEP + PROMOTE | HIGH | GFM alert syntax is now PREFERRED over ::: container equivalents. These should stay in docs as the primary callout authoring path. |
| `@section` macro | 4b — PLANNED MIGRATION | HIGH | Currently unused in field guide; field guide to adopt as macro usage expands |
| `@spread` macro | 4b — PLANNED MIGRATION | HIGH | Currently unused in field guide; field guide to adopt as macro usage expands |
| `@break` macro | 4b — PLANNED MIGRATION | MEDIUM | Field guide uses `---` today; `@break` is the intended replacement |
| `:::sidebar` / `:::wrapper {.dc-sidebar}` | 4c — MIGRATION TARGET | MEDIUM | Needs `@sidebar` macro |
| `:::lede` / `:::wrapper {.dc-intro}` | 4c — MIGRATION TARGET | MEDIUM | Needs `@lede` or `@intro` macro |
| `:::pull-quote` / `:::wrapper {.dc-pullquote}` | 4c — MIGRATION TARGET | MEDIUM | Needs `@pullquote` macro |
| `:::procedure` | 4c — MIGRATION TARGET | MEDIUM | Needs `@procedure` macro |
| `:::item` | 4c — MIGRATION TARGET | LOW | Needs scoping decision; used inside multiple parent containers |
| `:::two-column` / `:::: two-column` | 4c — MIGRATION TARGET | MEDIUM | Needs `@two-column` macro or page template |
| `:::three-column` | 4c — MIGRATION TARGET | LOW | Needs `@three-column` macro |
| `:::wrapper {.dc-definition-block}` | 4c — MIGRATION TARGET | MEDIUM | Needs `@definition` macro |
| `:::wrapper {.dc-sidebar-box}` | 4c — MIGRATION TARGET | LOW | Needs `@sidebar-box` macro |
| `:::wrapper {.dc-toc}` | 4c — MIGRATION TARGET | LOW | TOC is auto-generated; wrapper fate TBD |
| Generic `:::wrapper {.arbitrary-class}` | 4c — MIGRATION TARGET | LOW | Should become `@wrap .class` or dedicated macro per class |
| Six two-column layout mechanisms | 5 — RATIONALIZE | MEDIUM | Audit for true visual differences |
| Three stat-grid patterns | 5 — RATIONALIZE | MEDIUM | Systems 1 and 3 structurally similar |
| Two outcome table systems | 5 — RATIONALIZE | ~~HIGH~~ **DONE 2026-05-12** | `@outcome` macro is now canonical; HTML replaced in `05-page-templates.md`; `.dc-roll-table` CSS deprecated |
| Two numbered procedure systems | 5 — RATIONALIZE | MEDIUM | Container vs legacy `.procedure > ol` |
| Two pull-quote authoring paths | 5 — RATIONALIZE | LOW | `> [!PULLQUOTE]` now PREFERRED; `:::pull-quote` still valid but secondary |
| `.dc-note-callout` vs `.dc-note` naming | 5 — RATIONALIZE | ~~HIGH~~ **RENAMED 2026-05-12** | Renamed to `dc-dm-note` to increase visual distance from player-facing `.dc-note` |
| `.dc-gear-callout` vs `.gear-callout` | 5 — RATIONALIZE | HIGH | Near-identical names, different `min-height` behaviour — investigation needed (see Category 5 note) |
| Atmospheric callout cluster | 5 — RATIONALIZE | LOW | `.dc-vibe-callout`, `.dc-origin-callout`, `.dc-visit-callout` |
| Banner heading repetition | 5 — RATIONALIZE | MEDIUM | 5 hard-coded selector blocks duplicate `.dc-chevron` |
| `--paper-stain` / `--border-hairline` same hex | 6 — TOKEN CLEANUP | LOW | Coincidental value match; document relationship |
| `--fs-base` / `--fs-body` same value | 6 — TOKEN CLEANUP | HIGH | Retire one; update all references |
| `--space-2xl` / `--gutter` same value | 6 — TOKEN CLEANUP | MEDIUM | Semantically distinct; document or differentiate |
| `--space-xs` / `--space-sm` near-identical | 6 — TOKEN CLEANUP | MEDIUM | 0.32pt difference; merge or separate meaningfully |
| `--fs-pullquote` / `--fs-h2` near-identical | 6 — TOKEN CLEANUP | MEDIUM | 0.3pt difference; intentional or accident? |
| `--fs-h1` / `--fs-chevron` near-identical | 6 — TOKEN CLEANUP | MEDIUM | 0.7pt difference; use `--fs-h1` directly if intentional |
| `--font-tab` undocumented | 6 — TOKEN CLEANUP | MEDIUM | Not in `01-typography.md` |
| `--font-sans` undocumented | 6 — TOKEN CLEANUP | MEDIUM | Not in `01-typography.md` |
| `--font-quote` undocumented | 6 — TOKEN CLEANUP | MEDIUM | Not in `01-typography.md` |
| `@page colophon` / `@page front-matter` duplicate | 6 — TOKEN CLEANUP | LOW | Functionally identical; kept for chunker reliability per comment |
| `@page chapter-end` restates default footer | 6 — TOKEN CLEANUP | LOW | May be dead; verify if it adds anything over `:left/:right` |
| `@page front-matter`, `colophon`, `chapter-start`, `clean` same visual output | 6 — TOKEN CLEANUP | LOW | Four declarations, one visual behaviour |
