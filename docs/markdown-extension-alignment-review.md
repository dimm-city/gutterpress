# Markdown Extension Alignment Review (2026-05-17)

Three independent agents reviewed print-md's three markdown rendering layers (core extensions in `src/lib/markdown/`, `markdown-it-paged.js`, and the DC plugin) through different lenses: author-facing syntax, emitted-output naming, and architectural concerns.

This document holds the synthesis of their findings, the remediation history, and the final resolution status.

## Final status

All 16 numbered findings + 3 newly-surfaced items addressed. The implementation landed across four commits:

| Commit | Scope |
|---|---|
| `3b0f01d` | Remove `:::` container syntax entirely (the Tier 1 / driver change) |
| `c98b78d` | Tier A–C: remove DC `@two-column`/`@three-column`/`@no-break`, move alerts to DC plugin, fix `@procedure` leakage, `buildAttrs` data- prefix, chapter wrapper rename, `@lede` prefix, images renderer rule, PAGED_CSS pipeline, deprecate `allowedCallouts` |
| `44b2295` | Tier D: drop file wrapper entirely, remove `@break`, all DC macros emit `<div>`, expand DC MARKERS header comment, doc sweep |
| `83ac853` | (Predecessor) plugin loader refactor + DC parser grammar alignment |

## Resolution table

| # | Finding | Status | How it was resolved |
|---|---|---|---|
| 1 | 🔴 Duplicate surface (`:::` vs `@`) | ✅ Resolved (`3b0f01d`) | `:::` syntax removed; `@marker` is the only canonical author surface. See `docs/migrations/2026-05-removing-container-syntax.md`. |
| 2 | 🔴 Alert variant registry duplicated | ✅ Resolved (`c98b78d`) | `src/lib/markdown/alerts.ts` deleted; entire alerts block ruler moved into the DC plugin where the alert variants are defined. Core no longer leaks DC brand identifiers. |
| 3 | 🔴 `:::dc-specialty` / `:::learning-path` in core | ✅ Resolved (`3b0f01d`) | Container registrations removed; the `dc-specialty` / `dc-learning-path` names exist only in the DC plugin. |
| 4 | 🟡 Class prefix inconsistency | ✅ Resolved | `.lede` removed (only `.dc-intro` remains); `@two-column` etc. removed from DC plugin. Bare `.section` / `.page` / `.spread` from `markdown-it-paged` are intentional (the plugin's stable public contract — documented in the migration mapping). |
| 5 | 🟡 Attribute grammar split | ✅ Resolved (`3b0f01d`) | `:::` braces are gone with the container removal; `{}` braces remain *only* for `markdown-it-attrs` inline-attribute use, which is a separate concern with broad ecosystem precedent. |
| 6 | 🟡 `containers.ts` emits bare attrs | ✅ Resolved (`3b0f01d`) | `containers.ts` deleted. |
| 6b | 🟡 DC plugin `buildAttrs` bare attrs | ✅ Resolved (`c98b78d`) | Unknown `key=val` now emits `data-key="val"`. Known passthrough attrs (`class`, `id`, `lang`, `dir`, `role`, `tabindex`, `aria-*`, `data-*`) stay verbatim. |
| 7 | 🔴 `@procedure` silent mode leakage | ✅ Resolved (`c98b78d`) | `@procedure` auto-closes prior open scopes (matching every other DC marker); EOF push to `env.layoutWarnings` if unclosed at end-of-render. |
| 8 | 🟡 `@break` ≡ `@end-section` redundancy | ✅ Resolved (`44b2295`) | `@break` removed; `@end-section` is canonical. |
| 9 | 🟢 `@continue` missing from header | ✅ Resolved (`44b2295`) | DC plugin's MARKERS comment now lists all 30+ markers including `@continue` and the GFM-alerts handler. |
| 10 | 🟡 Chapter wrapper duplication | ✅ Resolved (`44b2295`) | File-level wrapper deleted entirely. `@chapter` is the single canonical chapter mechanism. |
| 11 | 🟢 `@lede` mixed-prefix class | ✅ Resolved (`c98b78d`) | Emits `<div class="dc-intro">` only; bare `lede` (zero CSS rules used it) removed. |
| 12 | 🟢 `<section>` vs `<div>` for `@specialty`/`@learning-path` | ✅ Resolved (`44b2295`) | All DC macros emit `<div>` uniformly. Zero CSS used `section.dc-*` selectors. |
| 13 | 🟡 `images.ts` regex-on-final-HTML | ✅ Resolved (`c98b78d`) | Replaced by `md.renderer.rules.image` override. `normalizeImageSrc()` exported for plugins that want the same behavior. |
| 14 | 🟢 DC plugin `makeToken` reimplementation | ⏭ Accepted | Inline-copy pattern is the documented approach for plugins loaded via manifest (binary users cannot resolve cross-package imports). Cost is one ~30-line helper; benefit of sharing it across packages is negative. |
| 15 | 🟢 PAGED_CSS bypasses plugin CSS pipeline | ✅ Resolved (`c98b78d`) | `PAGED_CSS` and user-plugin CSS now emit as a single `<style>` block. Predictable cascade. |
| 16 | 🟡 DC plugin layout-only macros | ✅ Resolved (`c98b78d`) | `@two-column` / `@three-column` / `@no-break` removed from DC plugin; authors use `@section .two-column` etc. (markdown-it-paged native). |
| 17 | 🟢 `allowedCallouts` manifest field dead | ✅ Resolved (`c98b78d`) | `@deprecated` JSDoc + runtime warning when set. Slated for removal in the next major version. |

## What changed in code (cumulative across the four commits)

| Layer | Change |
|---|---|
| `src/lib/markdown/index.ts` | Removed `markdown-it-container` and 14 container registrations; removed `dcAlertsPlugin` import; removed file-level wrapper; image rule moved from post-process to renderer override; unified style-block emission. |
| `src/lib/markdown/containers.ts` | **Deleted.** |
| `src/lib/markdown/alerts.ts` + `alerts.test.ts` | **Deleted.** (Moved into DC plugin.) |
| `src/lib/markdown/images.ts` | Rewritten: exports `registerImageRule(md)` and `normalizeImageSrc(src)`. |
| `src/lib/markdown/markdown-it-paged.js` | `PAGED_CSS` named export; col-split renderer; env-based depth state; `@break` removed; `implicitPage: false` default. |
| `src/lib/markdown/plugins.ts` | Fail-fast on load errors; auto-install removed; public type exports. |
| `src/checks/source/callout-validation.ts` | **Deleted.** |
| `src/lib/presets.ts` | `allowedCallouts` default `[]`. |
| `src/schema/manifest.types.ts` | `allowedCallouts` marked `@deprecated`. |
| `src/lib/manifest.ts` | Runtime warning for `allowedCallouts`. |
| `src/index.ts` | Type-only public API (`PrintMdPlugin`, etc.). |
| `examples/dc-design-guide/plugins/dimm-city-plugin.js` | Inlined alerts plugin; parser grammar aligned with `parseMarkerLine`; `@two-column`/`@three-column`/`@no-break` removed; `buildAttrs` data- prefix; `@procedure` auto-close + EOF warning; all `<section>` → `<div>`; `@lede` emits `dc-intro` only; MARKERS header expanded. |

## How the original synthesis broke down

Kept here as the historical record of what the three reviewers found.

### Where the three reviewers converged

These appeared in 2+ reports and represent high-confidence findings.

### 🔴 1. Duplicate surface for the same concepts (3/3 reviewers)

The largest theme. `:::sidebar` ↔ `@sidebar`, `:::callout` ↔ `@callout` ↔ `> [!NOTE]`, `:::procedure` ↔ `@procedure`, `:::two-column` ↔ `@two-column`, `:::three-column` ↔ `@three-column`. Authors get **different HTML** from syntax that looks equivalent:

- `:::callout` → `<div class="callout">` (bare, undocumented)
- `@callout` → `<div class="dc-alert dc-note">` (DC-styled)
- `> [!NOTE]` → `<div class="dc-alert dc-note">` (DC-styled)

CSS authors must write rules for every variant; the same logical class doesn't style the same logical element.

### 🔴 2. Alert variant registry duplicated (architecture + output)

## Where the three reviewers converged

These appeared in 2+ reports and represent high-confidence findings.

### 🔴 1. Duplicate surface for the same concepts (3/3 reviewers)

The largest theme. `:::sidebar` ↔ `@sidebar`, `:::callout` ↔ `@callout` ↔ `> [!NOTE]`, `:::procedure` ↔ `@procedure`, `:::two-column` ↔ `@two-column`, `:::three-column` ↔ `@three-column`. Authors get **different HTML** from syntax that looks equivalent:

- `:::callout` → `<div class="callout">` (bare, undocumented)
- `@callout` → `<div class="dc-alert dc-note">` (DC-styled)
- `> [!NOTE]` → `<div class="dc-alert dc-note">` (DC-styled)

CSS authors must write rules for every variant; the same logical class doesn't style the same logical element.

### 🔴 2. Alert variant registry duplicated (architecture + output)

`DC_ALERT_TYPES` in `alerts.ts:21` and `CALLOUT_VARIANTS` in DC plugin `:1145` are parallel maps with the same variant names. Adding a new type means editing both files in lock-step.

### 🔴 3. `:::dc-specialty` and `:::learning-path` registered in core (architecture + output)

`index.ts:55–60` registers two `dc-*`-named containers as built-ins. Core leaks DC brand identifiers. Output reviewer also flagged that `@learning-path` (DC) emits `<section class="dc-learning-path dc-path-block">` while `:::learning-path` (core) emits `<div class="learning-path">` — same name, different element, different classes.

### 🟡 4. Class prefix inconsistency (3/3 reviewers)

- markdown-it-paged → bare names (`.section`, `.page`, `.spread`, `.chapter`)
- core containers → mostly bare (`.sidebar`, `.callout`) but `.dc-specialty` is an outlier
- DC plugin → mostly `dc-*` but `.lede` (in `@lede`) and `.two-column` (in `@two-column`) are bare

`.section`, `.page`, `.spread` are very collision-prone generic names and `PAGED_CSS` wins the cascade against user CSS at equal specificity.

### 🟡 5. Attribute grammar split (author + architecture)

After commit 83ac853, `@page`, `@section`, and DC `@markers` share the same `.class #id key=val` grammar. But `:::containers` still use `{.class #id}` braces. Two grammars for the same concept; only the bracketed form is documented in `markdown-it-attrs`.

### 🟡 6. `containers.ts` emits arbitrary attrs as bare HTML attributes (output)

`parseContainerMeta` writes `key="value"` straight to the DOM with no `data-` prefix (containers.ts:54–102). markdown-it-paged correctly prefixes everything as `data-*`. Bare keys like `title=`, `style=`, `name=` would collide with real HTML semantics.

## Unique-to-one-reviewer findings worth noting

| # | Finding | Reviewer | Severity |
|---|---|---|---|
| 7 | `@procedure` has no enforced close → silent mode leakage; every following `<ol>` becomes step-list until `closeAll()` fires | author | 🔴 |
| 8 | `@break` and `@end-section` are functionally identical | author | 🟡 |
| 9 | `@continue` missing from DC plugin's marker header comment | author | 🟢 |
| 10 | Chapter wrapper duplication: `index.ts` wraps every file in `<section class="chapter">`, then `@chapter` adds `<div class="chapter">` inside | output | 🟡 |
| 11 | `@lede` mixes prefixed + bare classes (`dc-intro lede`) | output | 🟢 |
| 12 | `<section>` vs `<div>` inconsistency for `@specialty`, `@learning-path` | output | 🟢 |
| 13 | `images.ts` does regex-on-final-HTML — wrong layer, should be a markdown-it image renderer rule | architecture | 🟡 |
| 14 | DC plugin's `makeToken` reimplementation duplicates markdown-it's Token contract | architecture | 🟢 |
| 15 | `PAGED_CSS` bypasses the standard plugin CSS injection pipeline | architecture | 🟢 |
| 16 | DC plugin contains layout-only macros (`@two-column`, `@no-break`) that belong in core or in paged | architecture | 🟡 |

## Recommended action order (historical)

This was the original tiered remediation plan. It is preserved for the archaeology; every item below has since been implemented — see the **Final status** and **Resolution table** at the top of this document for the actual landed work.

**Tier 1** Pick a canonical surface for `:::` vs `@` duplicates · Move `:::dc-specialty` / `:::learning-path` out of core · Move alerts.ts into DC plugin
**Tier 2** `parseContainerMeta` / `buildAttrs` `data-` prefix · Chapter wrapper · Class-prefix audit · `@procedure` tightening
**Tier 3** Layout macros into paged · Images renderer rule · PAGED_CSS pipeline · Marker tokenizer sharing (deferred — inline-copy accepted)
**Tier 4** `@continue` in MARKERS · `@break` ≡ `@end-section` (removed) · `<section>` vs `<div>` (all `<div>`)

## Decision (2026-05-17)

The chosen path was **full removal of `:::` container syntax** as legacy, followed by an end-to-end alignment pass that closed every remaining finding. The DC `@marker` family is the canonical author surface going forward. See `docs/migrations/2026-05-removing-container-syntax.md` for the migration mapping.
