/**
 * SFE-P2b Lane B — turns a matched `ProjectedBlock` (+ its anchored
 * `GeneratedView`s) into a plain-data rendering PLAN, still with zero DOM.
 *
 * Kept as its own DOM-free module for the same reason as `match.ts` (see
 * that file's header): `tests/gutterpress/provider.test.ts` needs to assert
 * "raw-html renders as inert text", "a generated view is included",
 * "generated content never gets segments" WITHOUT a `document` global. A
 * `ChipPlan` is that assertable surface — plain strings/booleans a
 * `bun:test` unit test can inspect directly, with the actual DOM build
 * deferred to `render-chip.ts` (browser-only in practice, exercised by
 * `tests/gutterpress/gutterpress.btest.ts`).
 *
 * `segmented` (per-character `SourceSegment`s vs. a bare inert-text `<pre>`
 * preview) is decided from `block.editMode`, not `block.kind` directly, so a
 * future `ProjectedBlockKind` with `editMode: "structured"` gets the same
 * treatment automatically: marker-family blocks (`editMode: "structured"`)
 * get real per-character segments — the P1b2 option-a pattern
 * (`tests/vscode-adapter/custom-view/fork-hook.btest.ts`'s "segments
 * decision" suite) proved this is what makes caret/drag precision land at
 * an EXACT offset rather than only "inside the block" — reused here for the
 * SAME reason: marker lines are short, single declaration lines, so the
 * per-character DOM cost is bounded regardless of document size. `raw-html`
 * blocks (`editMode: "source"`) deliberately do NOT get segments: D13 caps
 * an inactive HTML payload at up to 1 MiB, and per-character Text nodes for
 * a payload that size would be a real performance cliff for no benefit the
 * run spec asks for — it names segments for "the marker line" only. A
 * raw-html chip therefore uses the P1b2 "bare-dom fallback" mode instead
 * (caret entry lands at the block's own start; a legitimate, precedented
 * mode, not a placeholder).
 *
 * `generatedPreviews` is `readonly string[]` — plain HTML TEXT, never a DOM
 * node, never paired with a `SourceSegment`. This is the type-level half of
 * "the provider never creates segments for generated content" (D6/G-04): a
 * `string` cannot carry a segment, so there is no code path — bug or
 * otherwise — through which one could attach one.
 */
import type { GeneratedView, ProjectedBlock } from "gutterpress/render";

export interface ChipPlan {
  readonly block: ProjectedBlock;
  /** The exact string the fork handed `renderCustomBlock` for this call — always a superset of `block`'s own slice (see `match.ts`'s header on the trailing-glue boundary difference). */
  readonly sourceText: string;
  /** `true` -> per-character `SourceSegment`s over the whole `sourceText` (marker family). `false` -> a single inert-text preview, no segments (raw-html and any other non-"structured" kind). */
  readonly segmented: boolean;
  /** Read-only inert HTML text previews anchored at this block's own `to` (D6/AP-13) — rendered, never parsed as live markup; never segmented. */
  readonly generatedPreviews: readonly string[];
}

export function buildChipPlan(
  block: ProjectedBlock,
  generatedPreviews: readonly GeneratedView[],
  sourceText: string,
): ChipPlan {
  return {
    block,
    sourceText,
    segmented: block.editMode === "structured",
    generatedPreviews: generatedPreviews.map((view) => view.html),
  };
}
