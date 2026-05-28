# Paged.js Debug Notes — 2026-05-28

## Findings

1. Initial render stopped at 72 pages with:
   - `Unable to layout item: [node HTMLDivElement]`
   - `Layout repeated at: [node HTMLParagraphElement]`

2. A real plugin regression existed in `examples/dc-design-guide/plugins/dimm-city-plugin.js`:
   - `@skill {.example}` in `dc-op-manual/field-guide/chapter-02 0.md` was followed directly by `@page`.
   - The plugin did not auto-close the open skill card before the next layout token.
   - Generated HTML nested the next `.page` and the start of `.dc-specialty augmerc` inside the example skill card.

3. After patching the plugin to auto-close `@skill` on `layout_*` tokens, the generated HTML boundary became balanced:
   - Before: example skill flowed directly into `<div class="page">...`
   - After: example skill closes before the new page opens.

4. This fix removed one blocker but did not complete rendering.
   - Render still stops at 72 pages.
   - Failure signature changed from `HTMLParagraphElement` to `HTMLDivElement`, indicating the original malformed-HTML bug was real and fixed.

5. The remaining failure occurs later in Augmerc content.
   - Last rendered structures include `.dc-specialty augmerc`, `.dc-learning-path dc-path-block`, and `.dc-skill-card` elements.
   - Paged.js creates split fragments with `data-split-from` on `.dc-specialty` and `.dc-learning-path` wrappers.

6. Two additional loop triggers were active in specialty CSS:
   - `:has()` selector in `examples/dc-design-guide/css/fg-overrides.css` targeting Augmerc pagination glue.
   - `break-after: avoid` on `.dc-learning-path.dc-path-block` in `examples/dc-design-guide/css/dc-components.css`.

7. Removing those two hazards allowed the document to render fully.
   - Final preview render reached 303 pages.
   - Browser reached the actual final page (`End of Transmission`).
   - Output text length was effectively complete relative to source template text.

## Lessons Learned

1. The DC plugin runs after `markdown-it-paged`, so auto-close guards must key off concrete `layout_*` token types, not raw marker paragraphs.

2. A malformed HTML boundary can masquerade as a pure Paged.js fragmentation bug. Always inspect generated HTML around the last successfully rendered content before changing CSS.

3. Fixing one loop can expose the next one deeper in the document. Track changes in failure signature (`paragraph` -> `div`) to confirm progress.

4. Keep all debug work preserved in stash when iterating on regression hunting.
   - `stash@{0}` at the time of this note contains the skill auto-close fix.
   - `stash@{1}` contains earlier page-count debugging edits.

5. `:has()` remains dangerous in active print CSS even when the browser accepts it. In this pipeline, it should be treated as a Paged.js crash/loop risk, especially when used for break control.

6. `break-after: avoid` on large structural wrappers like `.dc-learning-path` is a direct infinite-loop risk in Paged.js. Prefer `auto`, and solve orphan pairing with safer structure or explicit page-start rules.

7. Successful debugging sequence for this incident:
   - inspect generated HTML around last rendered content
   - fix malformed wrapper boundaries first
   - remove `:has()` pagination selectors
   - remove `break-after: avoid` from oversized structural wrappers
   - verify final page count and actual end-of-book content

8. Remaining console warnings after full render are non-fatal and correlate with tall cards / split cards rather than a document-stopping loop.
   - Warning node types: `P`, `LI`, `UL`, `TD`, `H*`, `HR`
   - Most likely associated with tall `.dc-skill-card` content and `.allow-split` continuations.
   - Example tall cards observed in rendered output: `grim-glyph`, `invigorating-litany`, `back-through-the-black`, `we-see-you`.

9. A conservative relaxation of broad heading keep-with rules did not materially reduce the residual warnings, so the safer choice is to keep the now-stable 303-page render rather than continue broad pagination experiments.

## Next Targets

1. Inspect whether split `.dc-learning-path` / `.dc-specialty` wrappers inherit layout constraints that Paged.js cannot fragment safely.
2. Check for nested keep-together behavior involving:
   - `.dc-learning-path`
   - `.dc-path-shell`
   - `.dc-specialty`
   - split fragments with `data-split-from`
3. Compare active CSS against AKM memory `card-gutter-cut-columns-inheritance` and related Paged.js failure modes.

## Resolved In This Session

1. `@skill` now auto-closes before downstream `layout_*` tokens, preventing page/specialty content from being swallowed by an open skill card.
2. Augmerc-specific `:has()` pagination glue rules removed.
3. `.dc-learning-path.dc-path-block { break-after: avoid; }` changed to `break-after: auto;`.
4. Preview now renders to 303 pages instead of stopping at 72.

## Residual Warnings

1. Full render still logs non-fatal `Unable to layout item` warnings.
2. These warnings no longer block pagination and appear tied to local card/list fragmentation decisions.
3. Further reduction should be done surgically per offending card/component, not with more global pagination relaxations.
