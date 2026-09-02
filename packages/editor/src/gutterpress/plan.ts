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
 * WHAT "THE PLUGIN'S OWN PRODUCED HTML" MEANS IN THIS COMMITTED SHAPE
 * (SFE-P2c repair round 1 — supersedes the paragraph this replaces, which
 * argued `editor-projection.ts` supplied no `inactiveHtml` for
 * `plugin-region` and therefore "there is nothing else to show." That was a
 * true observation about the P2c-round-0 shape, used to justify a
 * DEVIATION from the run spec's own row — "a `plugin-region` renders the
 * plugin's own HTML inertly" — rather than escalating it. `editor-
 * projection.ts` now DOES emit `inactiveHtml` for `plugin-region`, rendered
 * from `md.renderer.render(tokens.slice(openIdx, closeIdx + 1), ...)` — the
 * SAME renderer/rule set the print path uses (G-03), routed through the
 * same D13 `capHtmlPayload` every other HTML payload in that module goes
 * through): `buildChipPlan` below PREFERS `block.inactiveHtml` for the
 * non-segmented inert preview, falling back to `sourceText` only when the
 * projection supplies none (a matching close token could not be found, or
 * the plugin's own renderer rule threw — `editor-projection.ts`'s own
 * contract there is "never throw, never guess," so `undefined` there means
 * fail-closed to exactly TODAY's authored-source posture for that one
 * block, not a new failure mode). `raw-html` is unaffected either way: its
 * `inactiveHtml` was already set to its own raw bytes, identical to what
 * `sourceText` would have shown. `render-chip.ts`'s posture is UNCHANGED —
 * still `.textContent` only, never parsed markup — so the script-payload
 * inertness proof (`plugin-region.btest.ts`) holds verbatim regardless of
 * which string is written into it.
 */
import type { GeneratedView, ProjectedBlock } from "gutterpress/render";

export interface ChipPlan {
  readonly block: ProjectedBlock;
  /** The exact string the fork handed `renderCustomBlock` for this call — always a superset of `block`'s own slice (see `match.ts`'s header on the trailing-glue boundary difference). Still the SOLE text used for the segmented (marker-family) path; see `inactivePreviewText` for the non-segmented path. */
  readonly sourceText: string;
  /** `true` -> per-character `SourceSegment`s over the whole `sourceText` (marker family). `false` -> a single inert-text preview, no segments (raw-html, plugin-region, and any other non-"structured" kind). */
  readonly segmented: boolean;
  /**
   * The text `render-chip.ts` writes into the non-segmented inert `<pre>`
   * preview (SFE-P2c repair round 1 — see this file's own header, "WHAT
   * 'THE PLUGIN'S OWN PRODUCED HTML' MEANS"). Prefers `block.inactiveHtml`
   * — the pipeline's own rendered fragment for this block — falling back
   * to `sourceText` only when the projection supplies none. For
   * `segmented: true` blocks this is unused (the segmented branch always
   * reads `sourceText` directly); computed unconditionally anyway so the
   * type stays simple and the fallback is visible at construction time,
   * not scattered into the DOM-building module.
   */
  readonly inactivePreviewText: string;
  /** Read-only inert HTML text previews anchored at this block's own `to` (D6/AP-13) — rendered, never parsed as live markup; never segmented. */
  readonly generatedPreviews: readonly string[];
  /** The pipeline's own rendered HTML for a `plugin-region`/`raw-html` block — rendered as real (sanitized) DOM so the editor shows what the book shows. */
  readonly renderedHtml?: string;
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
    inactivePreviewText: block.inactiveHtml ?? sourceText,
    renderedHtml: block.editMode === "source" ? block.inactiveHtml : undefined,
    generatedPreviews: generatedPreviews.map((view) => view.html),
  };
}
