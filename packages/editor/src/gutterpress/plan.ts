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
 *
 * PLUGIN-REGION (SFE-P2c, docs/plans/source-first-editor/runs/SFE-P2c.md):
 * this run makes the `"plugin-region"` kind real (P2b only reserved it),
 * and this module needed ZERO code change to handle it — verified, not
 * assumed (the run spec's own instruction: "this comes free from the
 * seam... verify rather than assume"). `editor-projection.ts`'s committed
 * shape gives a `plugin-region` block `editMode: "source"` — the SAME
 * value `raw-html` gets, for the same reason documented there ("matching
 * raw-html's two-state posture: G-07's active state is source-aware
 * editing of the block's own exact range, not a structured command surface
 * a third-party plugin never opted into"). Since `segmented` above is keyed
 * on `block.editMode`, never `block.kind`, a plugin-region block already
 * routes through the exact same "bare inert-text preview" path raw-html
 * uses — precisely the outcome this file's own paragraph above predicted
 * for a FUTURE kind ("A future `ProjectedBlockKind` with `editMode:
 * 'structured'` gets the same treatment automatically"; the mirror image,
 * for `editMode: "source"`, is what actually landed here).
 * `tests/gutterpress/plugin-region.btest.ts` (SFE-P2c) proves this live
 * against the real fork, not merely by reading this file.
 *
 * WHAT "THE PLUGIN'S OWN PRODUCED HTML" MEANS IN THIS COMMITTED SHAPE: the
 * run spec asks the inactive view to render "the plugin's OWN produced
 * HTML... inertly." Read against `editor-projection.ts`'s actual output
 * (checked directly, per the run spec's own "(inactiveHtml? viewAttributes?)"
 * prompt — see `editor-projection-plugins.test.ts` and this package's own
 * `provider.test.ts` "plugin-region: buildChipPlan" suite, both asserting
 * this directly): a `plugin-region` block carries `viewAttributes` but
 * NEVER `inactiveHtml` — unlike `raw-html`, which sets `inactiveHtml =
 * token.content`. There is therefore no separate rendered-HTML field for
 * this function to prefer; `sourceText` (the fork's own exact text for the
 * live call, correlated against the block's own proven range by
 * `match.ts`) IS the only "plugin output" available, and it is the block's
 * own AUTHORED SOURCE bytes, not a second, transformed representation.
 * Routing it through the identical non-segmented/inert path raw-html uses
 * is therefore the "honest interim" the run spec asks for, not a
 * workaround — there is nothing else to show. If a future run adds a
 * distinct `inactiveHtml` to `plugin-region` (e.g. the plugin's own
 * rendered fragment, separate from its consumed source), `buildChipPlan`
 * will need an explicit change to prefer it; this run deliberately does
 * not add that speculative field-read ahead of the projection actually
 * producing the value (smallest design that satisfies the current,
 * verified shape).
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
