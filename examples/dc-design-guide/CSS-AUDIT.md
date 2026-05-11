# dc-design-guide CSS Audit

Generated: 2026-05-10. Full sweep by three specialist agents covering viewer coupling,
token hygiene, and layer architecture. Issues are grouped by type and sorted by impact.

---

## 1. Viewer / CLI Coupling

Issues where print-md's preview.js reads undocumented or improperly named CSS variables
from document CSS, creating invisible coupling between the viewer layer and document authors.

| ID | Variable | File | Line | Status | Issue |
|---|---|---|---|---|---|
| V1 | `--pmd-viewer-sheet-bg` | `preview.js` | 533 | ✅ Fixed | Formerly `--color-paper`; renamed. Not yet in official `docs/`. |
| V2 | `--preview-canvas-bg` | `preview.css` | 210 | ✅ Fixed | Undocumented, un-prefixed. Controls toolbar canvas bg. Should be `--pmd-viewer-canvas-bg`. |
| V3 | `--color-pageBox` | `preview.css` | 14, 46 | ✅ Fixed | Internal viewer variable, no `--pmd-` prefix. Rename or add "internal-only" comment. |
| V4 | `--color-marginBox` | `preview.css` | 17, 94 | ✅ Fixed | Same as V3. |
| V5 | `--pagedjs-crop-shadow` | `debug.css`→`preview.css` | 167–182 | ✅ Fixed | `var()` calls have no fallback; silently fail when `debug.css` not loaded. Add `, transparent`. |
| V6 | `--pagedjs-crop-stroke` | `debug.css` | 9 | ✅ Fixed | Declared, never consumed. Remove. |

---

## 2. Undefined Variables (Silent Fallbacks)

Variables used in `var()` calls with no `:root` definition. Fall back to `initial` or a hardcoded value.

| ID | Variable | File | Line | Status | Issue |
|---|---|---|---|---|---|
| U1 | `--accent-color3` | `content-templates.css` | 323 | ✅ Fixed | No definition, no fallback → `initial`. Breaks h4 color in chapter-02. Changed to `var(--ink-dust)`. |
| U2 | `--callout-border-width` | `content-templates.css` | 138 | ✅ Fixed | Only `--callout-border-width-small` (2px) exists. Zero/initial fallback. Changed to `var(--callout-border-width-small, 2px)`. |
| U3 | `--text-secondary` | `content-templates.css` | 191, 506 | ✅ Fixed | Token `--text-secondary: #a8b0bc` added to dc-brand.css `:root` (Task 3). |

---

## 3. Broken Token Usage

| ID | Token | File | Line | Issue |
|---|---|---|---|---|
| BT1 | `--hud-blue-border` | `dc-brand.css` | 2223, 2277, 2481, 2500 | ✅ Fixed — all 4 usages replaced with `var(--hud-blue)` directly. |

---

## 4. Token Proliferation — Alias Chains

Multiple token names resolving to the same literal value. All chains are in `dc-brand.css`
unless otherwise noted. Pick one canonical name; remove or redirect the rest.

| ID | Canonical | Aliases | Status | Notes |
|---|---|---|---|---|
| A1 | `--ink` | `--fg1`, `--border-strong`, `--border-card`, `--shadow-dark`, `--on-light`, `--outcome-fail` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A2 | `--ink-smoke` | `--fg3`, `--border-rule`, `--shadow-strong` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A3 | `--ink-dust` | `--fg4`, `--border-medium`, `--shadow-medium` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A4 | `--ink-dark` | `--fg2` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A5 | `--crimson` | `--link`, `--outcome-hit`, `--card-header-bg`, `--secondary-color` removed | ✅ Fixed — all aliases removed; 8 consumers updated to `var(--crimson)` | `--secondary-color` had 7 consumers in `dc-brand.css` + 1 in `content-templates.css`; all updated 2026-05-10 |
| A6 | `--orange` | `--highlight`, `--outcome-miss`, `--accent-color2` removed | ✅ Fixed — all aliases removed; 2 consumers updated to `var(--orange)` | `--accent-color2` had 1 direct consumer in `dc-brand.css` + `--proxy-accent` indirection; both updated 2026-05-10. `--proxy-accent` now points directly to `var(--orange)`. |
| A7 | `--hud-blue` | `--border-blue` removed; `--accent-color1` removed | ✅ Fixed — all aliases removed; 3 consumers updated to `var(--hud-blue)` | `--accent-color1` had 2 direct consumers (`dc-brand.css`, `guide.css`) + `--augmerc-accent` indirection; all updated 2026-05-10. `--augmerc-accent` now points directly to `var(--hud-blue)`. |
| A8 | `--amber` | `--warn-border`, `--outcome-mixed` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A9 | `--blood` | `--outcome-crit` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A10 | `--deep-rust` | `--warn-text` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A11 | `--paper-cream` | `--on-accent`, `--card-bg`, `--card-header-color` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A12 | `--paper-aged` | `--border-soft` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | |
| A13 | `--paper-stain` | `--border-hairline` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | Different semantic roles, coincidental value match |
| A14 | `--hud-orange-dim` | `--surface-orange-mid` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | Created independently in different namespaces |
| A15 | `--font-display` | `--font-banner`, `--header-font-family` | ✅ Fixed — alias removed; consumers updated to use canonical | `--font-banner`: 2 consumers (`.font-banner` class, `.dc-spray`) updated. `--header-font-family`: 3 consumers (`.specialty-intro h2`, `.specialty-intro h3`, `.sidebar-title`) updated. Both alias definitions removed from `:root`. |
| A16 | `--fs-base` | `--fs-body` | 🔶 Active alias retained — both tokens intentionally retained | `--fs-base` is the base measure (1 consumer: `body`); `--fs-body` is the semantic name for body copy. Coincidental value match (`12pt`) is not a bug. |
| A17 | `--fs-body-sm` | `--quote-font-size` removed; `--small-font-size` removed | ✅ Fixed — all aliases removed; 1 consumer updated | `--quote-font-size` had 1 consumer updated earlier. `--small-font-size` had 1 consumer at `.dc-gear-callout`: `max(var(--small-font-size), 11pt)` replaced with `var(--fs-body-sm)` 2026-05-10 (max() was a no-op since alias resolved to 11pt = floor). |
| A18 | `--space-2xl` | `--gutter` | 🔶 Active alias retained — `--gutter` | 2 consumers in `content-templates.css`; cross-file replacement deferred. See retained-tokens note below. |
| A19 | `--space-lg` | `--callout-pad` | ✅ Resolved — aliases removed in dead token sweep; only canonical name remains | `--callout-pad` was dead |
| A20 | `--space-sm` | `--small-gap` removed | ✅ Fixed — alias removed; 1 consumer updated to `var(--space-sm)` | `.terms .item p { padding-block }` updated 2026-05-10 |
| A21 | `--lh-normal` | `--lh-body`, `--line-height-normal` removed | ✅ Fixed — both aliases removed; consumers updated to `var(--lh-normal)` | `--lh-body`: 1 consumer (`.dc-options-table`) updated. `--line-height-normal`: 1 consumer in `content-templates.css` updated. Definitions removed from `:root` 2026-05-10. |
| A22 | `--lh-tight` | `--line-height-tight` removed | ✅ Fixed — alias removed; 2 consumers updated to `var(--lh-tight)` | `dc-brand.css` (`.specialty-card`) and `content-templates.css` (`.specialty table td/th`) updated 2026-05-10. Definition removed from `:root`. |
| A23 | `--bw-medium` | `--card-border-width` removed; `--callout-border-width-small` retained | 🔶 Active alias retained — `--callout-border-width-small` | 2 consumers (`dc-brand.css` and `content-templates.css`). Semantically distinct from `--bw-medium` (overrides default callout width); retention intentional. See retained-tokens note below. |
| A24 | `--bw-thick` | `--ls-cap-sm` | 🔶 Active alias retained — `--ls-cap-sm` | 5 consumers in `dc-brand.css`. Coincidental value match (`3px`) between a border-width token and a letter-spacing token — semantically distinct, should not be consolidated. See retained-tokens note below. |
| A25 | `--page-margin` | *(hardcoded `0.5in` in page-rules.css, 20 occurrences)* | ✅ Fixed — `page-rules.css` updated to use `var(--page-margin)` | H3 in Section 5 covers this |

**Retained tokens — intentionally kept with reasons (2026-05-10):**

| Token | Canonical | Reason for retention |
|---|---|---|
| `--ls-cap-sm` | coincidental `3px` match with `--bw-medium`/`--bw-thick` | Semantically a letter-spacing token, not a border-width token. Value coincidence only — consolidating would create a misleading name for 5 active consumers in `dc-brand.css`. |
| `--fs-base` | coincidental `12pt` match with `--fs-body` | `--fs-base` is the typographic base measure (1 consumer: `body font-size`); `--fs-body` is the semantic name for body copy. The shared value is intentional, but they serve distinct roles. |
| `--gutter` | `--space-2xl` | 2 consumers in `content-templates.css` (`.toc margin` and `.toc > div margin-bottom`). Token encodes the concept of a page gutter margin, not just a spacing scale step. Retained pending a broader `--gutter` → `--space-2xl` audit. |

---

## 5. Hardcoded Values That Should Use Tokens

| ID | Value | File(s) | Count | Missing Token | Notes |
|---|---|---|---|---|---|
| H1 | `20pt` | `dc-brand.css` | 5 | ✅ Fixed — 20pt values swapped to var(--fs-chevron) | `--fs-chevron: 20pt` added to `:root`. All 5 hardcoded `20pt` values replaced with `var(--fs-chevron)`. |
| H2 | `0.75in` | `page-rules.css` | 16 | ✅ Fixed | Binding-side margin hardcoded in all `@page :left/:right`. Replaced with `var(--binding-margin, 0.75in)`. |
| H3 | `0.5in` | `page-rules.css` | 20 | ✅ Fixed | Token exists in dc-brand.css; page-rules.css ignored it. Replaced with `var(--page-margin)`. |
| H4 | `11pt` | `dc-brand.css`, `content-templates.css` | 9+ | ✅ Fixed — 11pt values swapped to var(--fs-body-sm) | All 7 standalone `font-size: 11pt` declarations replaced with `var(--fs-body-sm)`. |
| H5 | `12pt` | `dc-brand.css` | 6+ | ✅ Fixed — 12pt values swapped to var(--fs-body) | All 9 standalone `font-size: 12pt` declarations replaced with `var(--fs-body)`. |
| H6 | `11.5pt` | `dc-brand.css` | 4 | ✅ Fixed — 11.5pt values swapped to var(--fs-body-xs) | `--fs-body-xs: 11.5pt` added to `:root`. All 4 hardcoded `11.5pt` values replaced with `var(--fs-body-xs)`. |
| H7 | `22px` clip corner | `dc-brand.css` | 17+ | ✅ Fixed — `--clip-banner` token restored; all 5 banner polygon repetitions replaced with `var(--clip-banner)` | `--clip-banner` token re-added to `:root` SHAPES section; 5 inline `polygon(0 0, 100% 0, calc(100% - 22px) 100%, 0 100%)` replaced |
| H8 | `rgba(232,93,36,…)` | `dc-brand.css` | 3 | ✅ Fixed — old `#e85d24` gradient stops updated to current `--orange` value (`rgba(242, 77, 0, …)`) with token comment | 3 occurrences: 0.18 (art-slot), 0.14 (cover-bg), 0.25 (portrait-inner) |
| H9 | `rgba(201,214,226,0.35)` | `dc-brand.css` | 1 | ✅ Fixed — rgba documented with `/* --hud-blue-dim at 35% opacity */` comment | Value unchanged; token link added for maintainers |
| H10 | `rgba(245,240,230,0.85)` | `dc-brand.css` | 1 | ✅ Fixed — rgba documented with `/* --paper-cream at 85% opacity */` comment | Value unchanged; token link added for maintainers |
| H11 | `rgba(72,164,224,0.16)` | `dc-brand.css` | 1 | ✅ Fixed — rgba documented with `/* --hud-blue-bright at 16% opacity */` comment | Value unchanged; token link added for maintainers |
| H12 | `rgba(242,77,0,0.08)` | `guide.css` | 1 | ✅ Fixed — rgba documented with `/* --orange at 8% opacity */` comment | Value unchanged; token link added for maintainers |
| H13 | `#3f7aa9` fallback | `content-templates.css` | 2 | ✅ Fixed | Normalized all three `var(--hud-blue,…)` fallbacks to `#2a6a8a`. |
| H14 | `'Titillium Web', sans-serif` | `content-templates.css` | 1 | ✅ Fixed | `.dc-toc ol > li > a` font-family replaced with `var(--font-body)`. |
| H15 | `9.5pt` footer | `page-rules.css` | 4 | ✅ Fixed | All four `@bottom-*` margin boxes now use `var(--fs-footer, 9.5pt)`. |
| H16 | `8.625in / 11.25in` | `page-rules.css`, `dc-brand.css` | 3 | ✅ Fixed | `.full-page` and `.specialty-art` geometry now uses `var(--page-width, 8.625in)` / `var(--page-height, 11.25in)`. |
| H17 | `#4a7c3a`, `#8a3aa9` | `dc-brand.css` | 1 ea | ✅ Fixed | Tokens `--classtag-gutterdruid`/`--classtag-technosorc` added to `:root`; `.dc-classtag` rules updated to `var()`. |

---

## 6. Dead Tokens (~55 defined, never consumed)

✅ Fixed — dead tokens removed from `dc-brand.css` `:root`. Three tokens were initially kept for active consumers but subsequently resolved on 2026-05-10:
- `--small-font-size` — consumer at `.dc-gear-callout` updated to `var(--fs-body-sm)`; alias definition removed
- `--lh-body` — consumer at `.dc-options-table` updated to `var(--lh-normal)`; alias definition removed
- `--small-gap` — consumer at `.terms .item p` updated to `var(--space-sm)`; alias definition removed

**Removed — aliases whose canonical was used directly:**
`--base-font-size`, `--border-card`, `--border-heavy`, `--border-light`, `--border-medium`, `--border-rule`, `--border-soft`, `--border-strong`, `--bw-medium`, `--bw-thick`, `--callout-pad`, `--card-bg`, `--card-body-height`, `--card-border-color` (global), `--card-border-width`, `--card-font-size`, `--card-header-bg`, `--card-header-color`, `--highlight`, `--link`, `--on-accent`, `--on-light`, `--shadow-dark`, `--shadow-medium`, `--shadow-strong`, `--warn-border`, `--warn-text`

**Removed — outcome tokens:**
`--outcome-crit`, `--outcome-hit`, `--outcome-miss`, `--outcome-mixed`, `--outcome-fail`

**Removed — clip-path tokens:**
`--clip-chevron`, `--clip-tab`, `--clip-tl`, `--clip-tr`
(`--clip-banner` was removed in the dead-token sweep but restored in H7 fix — it now has 5 active consumers)

**Removed — surface and HUD tints:**
`--bg-deep`, `--ember`, `--hud-blue-tint`, `--hud-border-soft`, `--hud-crimson-dim`, `--hud-magenta-border`, `--hud-magenta-dim`, `--hud-orange-dim`, `--inlay-blue-tint`, `--surface-orange-mid`, `--surface-orange-strong`, `--surface-purple-tint`, `--surface-red-tint`, `--surface-tint-1`, `--surface-tint-2`, `--text-darkred`

**Removed — other dead tokens:**
`--fg1`–`--fg5`, `--fs-display`, `--fw-normal`, `--lh-loose`, `--ls-tag`, `--radius-card`, `--radius-tab`, `--space-xs`, `--space-xxs`

---

## 7. Layer Boundary Violations

The four-layer contract: `dc-brand.css` (tokens + components) → `page-rules.css` (@page rules) → `content-templates.css` (Paged.js structural wrappers) → `guide.css` (specimen overrides).

| ID | File | Line(s) | Issue | Should Move To |
|---|---|---|---|---|
| L1 | `dc-brand.css` | 1877–1998 | "Book Preview Mappings" block: `.page`, `.page.*` structural overrides | `content-templates.css` | ✅ Fixed — BOOK PREVIEW MAPPINGS removed from dc-brand.css; structural rules moved to content-templates.css by partner agent |
| L2 | `dc-brand.css` | 2017–2020 | `.specialty { break-before: auto }` — duplicate of `content-templates.css:566`, page-break control | ✅ Fixed — removed from dc-brand.css (duplicate of content-templates.css:566) |
| L3 | `dc-brand.css` | 2091 | `.specialty+.page-break { break-before: auto }` — page-break control | ✅ Fixed — removed from dc-brand.css; belongs in content-templates.css |
| L4 | `dc-brand.css` | 2097–2139 | `.specialty-art` named-page assignment (`page: full`) + full-page geometry | ✅ Fixed — removed from dc-brand.css; partner agent adds to content-templates.css / page-rules.css |
| L5 | `dc-brand.css` | 2739–2743, 2791–2794 | `@media screen` responsive rules, self-annotated for migration | ✅ Fixed — removed from dc-brand.css and deleted from guide.css entirely (2026-05-10); this is a print-only project, no @media screen rules permitted anywhere |
| L6 | `content-templates.css` | 297–325 | Chapter-02 scoped `h3`/`h4` typography — "Quarantined" block | ✅ Fixed — Moved to guide.css; placeholder comment left in content-templates.css |
| L7 | `page-rules.css` | 369–379 | `.full-page` layout geometry (`width`, `height`, `break-before`) | ✅ Fixed — Geometry moved to content-templates.css; `page: full` kept in page-rules.css |
| L8 | `guide.css` | 65 | `body { counter-reset: chapter }` — counter init | ✅ Fixed — Moved to page-rules.css; comment updated in guide.css |
| L9 | `dc-brand.css` | 8–11 | Header comment lists 3-file import chain; omits `content-templates.css` | ✅ Fixed — Updated to 4-layer import order listing all files |

**Cascade violation — root cause was L1 (now resolved):**
Both rules now live in `content-templates.css`. `.page.page-toc li` (0,2,1) would still override `.dc-toc ol > li` (0,1,2), so the escalated selector `.page.page-toc .dc-toc ol > li` (0,3,2) is intentionally retained — the specificity fight is now intra-file and documented with a comment. The cross-layer violation is resolved.

**Cascade violation — duplicate rule (resolved):**
`dc-brand.css:2018` duplicate `.specialty { break-before: auto; page-break-before: auto }` removed (L2 fixed). `content-templates.css:566` is the canonical location.

---

## Status Legend

- ✅ Fixed — resolved in this session
- ❌ — open issue
- 🔶 — partial / needs verification

---

## Notes

- All `@media screen` rules deleted from dc-brand.css — this is a print-only project. Three blocks removed: grain overlay (`.grain::before`/`body.grain::before` with `position:fixed`), hover state (`a:hover`), and page background (`.page { background: var(--paper-cream) }`).
