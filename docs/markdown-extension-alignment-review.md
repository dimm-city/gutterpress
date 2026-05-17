# Markdown Extension Alignment Review (2026-05-17)

Three independent agents reviewed print-md's three markdown rendering layers (core extensions in `src/lib/markdown/`, `markdown-it-paged.js`, and the DC plugin) through different lenses: author-facing syntax, emitted-output naming, and architectural concerns.

This is the synthesis of their findings. The companion document `docs/migrations/2026-05-removing-container-syntax.md` tracks the implementation that resulted from these findings.

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
