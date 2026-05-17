# Markdown Extension Alignment Review (2026-05-17)

Three independent agents reviewed print-md's three markdown rendering layers (core extensions in `src/lib/markdown/`, `markdown-it-paged.js`, and the DC plugin) through different lenses: author-facing syntax, emitted-output naming, and architectural concerns.

This is the synthesis of their findings + the running status of remediation work.

## Status snapshot (2026-05-17, after commit 3b0f01d)

| # | Finding | Status | Notes |
|---|---|---|---|
| 1 | 🔴 Duplicate surface (`:::` vs `@`) | ✅ Resolved | `:::` syntax removed; `@marker` is canonical. See `docs/migrations/2026-05-removing-container-syntax.md`. |
| 2 | 🔴 Alert variant registry duplicated | 🟡 Open — **direction corrected** | `DC_ALERT_TYPES` lives in `src/lib/markdown/alerts.ts` (core), but the entire file is DC-branded (`dc-*` classes, "Dream Master Note" / "Vibe" labels). Core leaks DC identifiers — same architectural smell as #3. Fix: move the **whole** alerts plugin into the DC plugin, don't consolidate the DC plugin against core. |
| 3 | 🔴 `:::dc-specialty` / `:::learning-path` in core | ✅ Resolved | Container registrations all removed. |
| 4 | 🟡 Class prefix inconsistency | 🟡 Open | `.section` / `.page` / `.spread` (paged) still bare; `.lede`, `.two-column` (DC) still bare. |
| 5 | 🟡 Attribute grammar split | 🟡 Partial | `:::` braces are gone with the container removal; `{}` braces remain *only* for `markdown-it-attrs` inline-attribute use, which is a separate concern. |
| 6 | 🟡 `containers.ts` emits bare attrs | ✅ N/A | `containers.ts` deleted. DC plugin's `buildAttrs` has the same shape and is now the only remaining occurrence (see #6b below). |
| 7 | 🔴 `@procedure` silent mode leakage | 🟡 Open | Still silently swallows every following `<ol>` until `closeAll()`. |
| 8 | 🟡 `@break` ≡ `@end-section` redundancy | 🟡 Open | Both still functionally identical. |
| 9 | 🟢 `@continue` missing from header | 🟡 Open | DC plugin's MARKERS comment block still incomplete. |
| 10 | 🟡 Chapter wrapper duplication | 🟡 Open | `<section class="chapter">` + `<div class="chapter">` still nest when `@chapter` is used. |
| 11 | 🟢 `@lede` mixed-prefix class | 🟡 Open | Still emits `<div class="dc-intro lede">`. |
| 12 | 🟢 `<section>` vs `<div>` for `@specialty`/`@learning-path` | 🟡 Open | Decision not yet made. |
| 13 | 🟡 `images.ts` regex-on-final-HTML | 🟡 Open | Should be a markdown-it image renderer rule. |
| 14 | 🟢 DC plugin `makeToken` reimplementation | 🟡 Open | Low priority; inline-copy pattern is accepted. |
| 15 | 🟢 PAGED_CSS bypasses plugin CSS pipeline | 🟡 Open | Works correctly today; cleanup opportunity. |
| 16 | 🟡 DC plugin layout-only macros | 🟡 **Now urgent** | `@two-column` / `@three-column` / `@no-break` (DC) now duplicate `@section .two-column` semantics that the migration doc recommends. Different HTML output. |

## Newly surfaced (post-`:::`-removal)

These items either appeared or escalated in priority after commit 3b0f01d.

- **6b (new). DC plugin `buildAttrs` arbitrary `key=val` emits bare HTML attributes.** The same risk that `parseContainerMeta` had (no `data-` prefix on unknown keys) lives in `dimm-city-plugin.js` `buildAttrs`. Now the only remaining occurrence after `containers.ts` deletion.
- **16 escalated.** The migration doc tells authors `@section .two-column` is the replacement for `:::two-column`. But the DC plugin still ships `@two-column` (different HTML — `<div class="two-column">` vs `<div class="section two-column">`). We've recreated the duplicate-surface problem within the `@marker` family. Resolving this is now the highest-impact alignment item.
- **17 (new). `allowedCallouts` manifest field is dead surface.** Kept as no-op for backward parsing, but it's no longer wired to anything. Should be explicitly deprecated in the schema, removed in the next major version.

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

## Recommended action order

**Tier 1 — fix the alignment debt that authors hit first**

1. **Pick a canonical surface for the duplicated concepts** (#1). Recommend keeping `@callout` (DC) + `> [!NOTE]` (alerts) and **removing `:::callout`, `:::sidebar`, `:::procedure`, `:::two-column`, `:::three-column`** from core. The DC plugin already covers all of them with better HTML. Document the removal in `docs/plugins.md` and `CLAUDE.md`.
2. **Move `:::dc-specialty` and `:::learning-path` registrations out of core** (#3) into the DC plugin where they belong. Core stops leaking DC names.
3. **Share one alert variant registry** (#2). Export `DC_ALERT_TYPES` from `alerts.ts`, have DC plugin import it (or inline-copy it with a comment pointing to the source of truth — per the inline-copy pattern we documented).

**Tier 2 — output hygiene**

4. **Fix `parseContainerMeta` to `data-`-prefix arbitrary attrs** (#6). One-line risk reduction.
5. **Resolve the chapter wrapper duplication** (#10). Either let `@chapter` own the wrapper entirely or rename the file-level wrapper to `.chapter-file` to disambiguate.
6. **Audit class prefix policy** (#4). Either commit to `dc-*` for everything DC-shipped (including `@lede`, `@two-column`), or drop the prefix entirely. The current state guarantees collisions.
7. **Tighten `@procedure`** (#7). Either auto-close on the next blank line, or warn loudly at parse time when followed by markers other than `@end-procedure`.

**Tier 3 — architectural cleanup**

8. **Move generic layout macros (`@two-column`, `@three-column`, `@no-break`) into `markdown-it-paged`** (#16). They're paged-media concerns, not DC content.
9. **Move `images.ts` rewriting into a markdown-it `image` renderer rule** (#13).
10. **Promote `PAGED_CSS` into the standard plugin CSS pipeline** (#15).
11. **Consider sharing the marker tokenizer via parameter flag** between markdown-it-paged and the DC plugin (#14, architecture, nice-to-have) — but only if we accept the inline-copy alternative is fine. We documented the inline-copy pattern as the supported approach for cross-plugin sharing.

**Tier 4 — docs polish**

12. Add `@continue` to DC plugin's MARKERS header (#9).
13. Document `@break` ≡ `@end-section` or remove one (#8).
14. Resolve `<section>` vs `<div>` semantic decision (#12).

## Decision (2026-05-17)

After review, the chosen path is **full removal of `:::` container syntax** as legacy. The DC `@marker` family is the canonical author surface going forward. See `docs/migrations/2026-05-removing-container-syntax.md` for implementation tracking and any gaps.

---

## Next batch (proposed 2026-05-17, post-`:::`-removal)

These are the items I recommend addressing in the next session, grouped by tier. Together they total ~6 commits and resolve the highest-impact alignment debt that's still live.

### Tier A — high impact, low risk

**A1. Remove DC plugin's `@two-column` / `@three-column` / `@no-break` macros** (#16, escalated)
The migration doc tells authors to use `@section .two-column` / `.three-column`, which is what `markdown-it-paged` already emits. The DC duplicates emit different HTML (`<div class="two-column">` vs `<div class="section two-column">`), recreating the duplicate-surface problem inside the `@marker` family. Verify zero active usage in `examples/dc-design-guide/`, remove the macros, document in the migration doc. (~50 lines deleted from DC plugin.)

**A2. Move `alerts.ts` from core into the DC plugin** (#2, direction corrected)
The whole file at `src/lib/markdown/alerts.ts` is DC-branded — every emitted class is `dc-*`, every label is DC-themed ("Dream Master Note", "Vibe", "Origin", etc.). Core has no business knowing those names. Same architectural smell as `:::dc-specialty` being a core container (resolved in #3).

Migration:
1. Inline-copy the alerts plugin into `examples/dc-design-guide/plugins/dimm-city-plugin.js` (or a sibling file the plugin imports).
2. Delete `src/lib/markdown/alerts.ts` and `src/lib/markdown/alerts.test.ts`.
3. Remove the `dcAlertsPlugin` registration from `src/lib/markdown/index.ts`.
4. Delete the comment about "DC alert plugin must run before markdownItAttrs" — it's no longer in core's pipeline.
5. The DC plugin's existing `@callout` / `@dm-note` markers and the new GFM-alert handling will both live in one place and naturally share `DC_ALERT_TYPES`.

Consequences:
- Users without the DC plugin who write `> [!NOTE]` get a literal GFM blockquote with `[!NOTE]` text — correct, since they have no `dc-*` CSS to style it with anyway.
- One alert registry, one home, one cascade story.

**A3. Fix `@procedure` silent mode leakage** (#7)
Either auto-close when the next `@` marker is encountered (cheap, predictable), or emit a warning via `env.layoutWarnings` when a non-`@end-procedure` marker fires while `inProcedure` is true. Auto-close is the better author UX.

### Tier B — output hygiene

**B1. DC plugin `buildAttrs` data- prefix fix** (#6b, new)
Same one-line risk reduction as the old `parseContainerMeta` issue. Any unknown `key=value` in a `@marker` becomes a bare HTML attribute today; should be `data-key`. Localize the change to `buildAttrs` in `dimm-city-plugin.js`.

**B2. Resolve chapter wrapper duplication** (#10)
`renderChapters()` in `src/lib/markdown/index.ts` wraps each file in `<section class="chapter" id="..." data-source-file="...">`. When the file also uses `@chapter`, the result is a `<div class="chapter">` inside `<section class="chapter">` — two nested chapter wrappers, different element types. Recommend: rename the file-level wrapper to `class="chapter-file"` (semantically distinct: "this is the import boundary for one source file") and let `@chapter` keep `class="chapter"`. Authors can then style chapter intros by `.chapter` and per-file scoping by `.chapter-file`.

**B3. `@lede` class prefix fix** (#11)
Single-character change: `dc-intro lede` → `dc-lede` (or `dc-intro dc-lede` if both classes are load-bearing — check CSS). Trivial.

### Tier C — architectural cleanup (lower priority)

**C1. Move `images.ts` rewriting to a markdown-it image renderer rule** (#13)
Register `md.renderer.rules.image` to normalize `src` at token time. Drop `fixImagePaths` post-processing. Removes a string-regex-on-HTML hazard.

**C2. `PAGED_CSS` via standard plugin CSS pipeline** (#15)
Add a `css` named export to `markdown-it-paged.js`. Make `renderChapters()` collect plugin CSS uniformly — built-ins and user plugins both flow through `collectPluginCss`. Removes the special case.

**C3. Deprecate `allowedCallouts` schema field** (#17, new)
Mark in `src/schema/manifest.types.ts` with a deprecation comment + JSDoc `@deprecated`. Add a warning when manifests still set it. Slate full removal for the next major version.

### Tier D — trivial doc cleanup (~15 min total)

- **D1.** Add `@continue` to DC plugin MARKERS header (#9)
- **D2.** Pick one of `@break` / `@end-section` and remove the other (or document equivalence) (#8)
- **D3.** Decide and document `<section>` vs `<div>` policy for landmark blocks (#12)

### Suggested grouping for next session

If we batch the work into commits:

1. **Commit 1 (A1):** remove `@two-column` etc., update migration doc, verify DC design guide build still passes. Highest impact.
2. **Commit 2 (A2):** move `alerts.ts` into DC plugin. Self-contained; deletes ~163 lines from core.
3. **Commit 3 (B1):** DC plugin `buildAttrs` data- prefix fix. One-liner risk reduction.
4. **Commit 4 (A3):** `@procedure` auto-close. Small, surgical.
5. **Commit 5 (B2 + B3):** chapter wrapper rename + `@lede` class fix. Output-hygiene.
6. **Commit 6 (C1):** images renderer rule. Architectural.
7. **Commit 7 (D1 + D2 + D3 + C3):** docs + schema deprecation. Bundle the trivia.

C2 (PAGED_CSS pipeline) can wait — it's pure cleanup with no user-facing benefit.
