# Migration: Removing `:::` container syntax (2026-05-17)

## What changed

`:::name ... :::` block container syntax (provided by `markdown-it-container`) is **removed** from print-md. The DC plugin's `@marker` family is the canonical author surface.

This eliminates the duplicate-surface problem the 2026-05-17 alignment review flagged (see `docs/markdown-extension-alignment-review.md`): the same logical concept had two syntactic forms producing different HTML, with no documented distinction. Authors mixing `:::callout` and `@callout` got structurally different output from syntax that looked equivalent.

## Container → `@marker` mapping

| Removed container          | Replacement                                                    | Notes                                                                           |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `:::sidebar`               | `@sidebar` … `@end-sidebar` (DC plugin)                        | Emits `<div class="dc-sidebar">`                                                |
| `:::dc-specialty`          | `@specialty` … `@end-specialty` (DC plugin)                    | Emits `<section class="dc-specialty">`                                          |
| `:::learning-path`         | `@learning-path` … `@end-learning-path` (DC plugin)            | Emits `<section class="dc-learning-path dc-path-block">`                        |
| `:::two-column`            | `@section .two-column` … `@end-section` (markdown-it-paged)    | Native paged-media flow; col-split via `.col-split` on the same section         |
| `:::three-column`          | `@section .three-column` … `@end-section` (markdown-it-paged)  | Same as above                                                                   |
| `:::callout`               | `> [!NOTE]` (alerts) OR `@callout` … `@end-callout` (DC)       | Both emit `<div class="dc-alert dc-note">`. `>` form is single-paragraph only.  |
| `:::callout-note`          | `> [!NOTE]` (alerts)                                           | Same                                                                            |
| `:::callout-warning`       | `> [!WARNING]` (alerts)                                        | Same                                                                            |
| `:::callout-caution`       | `> [!CAUTION]` (alerts)                                        | Same                                                                            |
| `:::callout-tip`           | `> [!TIP]` (alerts)                                            | Same                                                                            |
| `:::procedure`             | `@procedure` … `@end-procedure` (DC plugin)                    | Transforms following `<ol>` into a step-list `<ol class="dc-steps">`            |

## Gaps (removed without replacement)

These containers had no DC `@marker` equivalent. Audit confirmed they had **no active CSS rules** and **no active markdown content** referencing them — they were dead surface area.

| Removed container | Why no replacement was added                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `:::container`    | Generic wrapper with `{.class}`. Authors needing a wrapper can use `@section .class` (`<div class="section class">`). One layer less.       |
| `:::pull-quote`   | Zero CSS rules using `.pull-quote`; zero active markdown using it. If pull-quotes are needed later, add `@pull-quote` as a DC macro.        |
| `:::item`         | Zero CSS rules using `.item`; zero active markdown using it. Was likely an unfinished card-item style. Card content uses `@skill` / `@dc-card`. |

**No author content used these three.** Searches in `examples/dc-design-guide/` returned only documentation tables describing the old syntax — never an active block.

## Files changed

### Source code

| File                                     | Change                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/lib/markdown/index.ts`              | Removed `markdown-it-container` import, removed all 14 `md.use(markdownItContainer,…)` registrations, removed containers.ts imports. |
| `src/lib/markdown/containers.ts`         | **Deleted.** Used only by the removed container registrations.                          |
| `src/checks/source/callout-validation.ts`| **Deleted.** Its sole purpose was warning on unknown `:::` container types; with `:::` gone the check is moot. |
| `src/checks/source/index.ts`             | Removed import of the deleted check.                                                    |
| `src/checks/checks.test.ts`              | Updated; removed the obsolete container-acceptance test and any `sourceIds.toContain("source.callout-validation")` expectations. |
| `src/lib/presets.ts`                     | `allowedCallouts` default emptied (was `["sidebar", "ability", "dc-specialty", "container", "aug"]`). |
| `src/schema/manifest.types.ts`           | `allowedCallouts` field kept as a no-op for backward-compatible manifests; comment marks it deprecated. |
| `package.json`                           | Removed `markdown-it-container` and `@types/markdown-it-container` from dependencies.   |
| `bun.lock`                               | Regenerated.                                                                            |

### Content

| File                                              | Change                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `examples/dc-design-guide/05-page-templates.md`   | Rewrote the `\`\`\`markdown` documentation block to show `@marker` syntax instead of `:::wrapper`. Removed the `:::wrapper equivalents` table; replaced with `@page-template-owned` description. |
| `examples/dc-design-guide/06-layout.md`           | Rewrote the layout reference table to show `@section .two-column` / `@section .three-column` / `@column-break`. |
| `examples/dc-design-guide/07-markdown-reference.md` | Removed the "Triple-colon fences" section entirely.                                          |

### Documentation

| File                                       | Change                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `docs/plugins.md`                          | Removed `markdown-it-container` row from the built-in plugins table.                    |
| `docs/user-guide.md`                       | Replaced all `:::` examples (statblock, ability, warning, info, page, etc.) with `@marker` equivalents or removed where the marker no longer exists. |
| `docs/toolchain-conflict-analysis.md`      | Historical analysis doc — added a header note marking the `:::` discussion as superseded by this migration. Content preserved for archaeology. |
| `docs/PLUGIN_SYSTEM_PLAN.md`               | Already out-of-date; added superseded note pointing to `docs/plugins.md`.               |
| `docs/markdown-extension-alignment-review.md` | Source review document that drove this migration. No edit needed.                    |
| `CLAUDE.md`                                | Updated Rule 5 to reflect that plugins are the only container-style block surface; `markdown-it-container` no longer in the built-in pipeline. |

## Verification

- `bun test` — full suite passes (4 pre-existing unrelated `gh` CLI failures expected)
- `tsc --noEmit` — clean
- DC design guide HTML build — 36 pages render through Paged.js, all expected component counts unchanged
- `paged-smoke.mjs` against DC design guide — passes
- Preview path loads the DC plugin cleanly

## Author migration cheat-sheet

```markdown
# OLD:                              # NEW:
:::sidebar                          @sidebar
content                             content
:::                                 @end-sidebar

:::callout                          @callout
content                             content
:::                                 @end-callout
                                    
                                    # OR (single paragraph):
                                    > [!NOTE]
                                    > content

:::two-column                       @section .two-column
content                             content
:::                                 @end-section

:::dc-specialty .augmerc            @specialty .augmerc
content                             content
:::                                 @end-specialty

:::procedure                        @procedure
1. step                             1. step
2. step                             2. step
:::                                 @end-procedure
```

The `@end-X` form is the unambiguous close. `@end-section` is the canonical close marker (the alias `@break` was removed in a follow-up cleanup on the same date).

## What we deliberately did NOT change

- `markdown-it-attrs` brace syntax (`{.class #id}`) remains supported for inline attribute attachment on headings, paragraphs, etc. That's a different ecosystem standard — it does NOT create container blocks.
- The `allowedCallouts` manifest field is kept (as no-op) so existing manifests don't fail to parse. Will be removed in a future major version.
- The `> [!NOTE]` GFM-style alerts plugin is untouched — that's the standard ecosystem syntax and remains the recommended way to do single-paragraph callouts.

## Rollback

This change is a **single commit**. If `:::` syntax needs to be restored for any reason:

```sh
git revert <commit-sha>
```

…will restore all container registrations, `containers.ts`, the validation check, the test, and the `markdown-it-container` dependency. Author content rewrites in `examples/` and `docs/` are also reverted in the same operation.
