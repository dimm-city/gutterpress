/**
 * SFE-P2b Lane B — pure, DOM-free matching of a live `renderCustomBlock`
 * call to the `GutterpressProjection` block it corresponds to (D6, run spec
 * `docs/plans/source-first-editor/runs/SFE-P2b.md`).
 *
 * DELIBERATELY DOM-FREE: this module imports ONLY types from `gutterpress/render`
 * — no `@dimm-city/vscode-markdown-editor`, no `../vscode-adapter/**`, no DOM
 * globals. That keeps it typecheckable under `packages/editor/tsconfig.json`'s
 * DOM-free root program (see that file's own header) with zero transitive
 * pull-in of DOM-typed code, and — the real payoff — lets
 * `tests/gutterpress/provider.test.ts` exercise it directly under plain
 * `bun test`, which has no `document` global in this package (see
 * `tests/web/mount.test.ts`'s header: every DOM-touching P1a case moved to a
 * `.btest.ts` real-Chromium suite specifically because `bun:test` here has no
 * DOM shim). `render-chip.ts` is the ONLY module in `src/gutterpress/**` that
 * touches `document`/`HTMLElement`; this file, and `plan.ts`, never do.
 *
 * THE MATCHING PROBLEM (G-05: "exact-range match only, no fuzzy matching"):
 * the fork's `BlockViewOptions.renderCustomBlock` seam hands the provider
 * `(node: BlockAstNode, sourceText: string)` — the node's OWN AST object and
 * its exact rendered source text, but NOT an `absoluteStart` (that lives only
 * on `BlockMeasurement`/`BlockViewData`, internal view-layer structures never
 * passed to this hook — verified by reading
 * `packages/vscode-markdown-editor/dist/index.d.ts`'s `BlockViewOptions`
 * declaration). So there is no direct offset to compare against a
 * `ProjectedBlock`'s `[from, to)`. The P1b2 test-only provider
 * (`tests/vscode-adapter/custom-view/support/entry.ts`) sidestepped this with
 * a `sourceText.includes(needle)` FUZZY substring search — explicitly a
 * test-only convenience, not something G-05 permits in production: G-05
 * forbids inferring a WRITABLE range from text equality, tag matching, or
 * approximate evidence.
 *
 * This module does not infer a range from text — the range already came from
 * Lane A's `createEditorProjection`, built from real markdown-it token-map
 * evidence. What is needed here is only a CORRELATION between that
 * already-trusted range and the fork's OWN independently-computed
 * `sourceText` for the SAME live call, so the right chip gets painted. The
 * correlation is anchored at the full, exact known range — never a keyword
 * or substring:
 *
 *   key(text) = text.trimEnd()
 *
 * Empirically (verified via the ALREADY-GREEN
 * `tests/vscode-adapter/custom-view/fork-hook.btest.ts`, case 4's own
 * assertion `expect(expectedSourceText).toBe("@page splash\n\n")` for a
 * `"...\n\n@page splash\n\nTrail text."` fixture): the fork's own paragraph
 * node absorbs ONE trailing blank separator line's terminator into its own
 * span (`[12, 26)` = `"@page splash\n\n"`), while this project's projection
 * convention (`editor-projection.ts`'s own header: "`to` is the char offset
 * of the START of the line immediately after the block's last line") stops
 * one line earlier (`[12, 25)` = `"@page splash\n"`) — the SAME leading
 * boundary (`from=12` both sides), differing only in how many TRAILING
 * blank-line terminators each side attributes to this block versus the next.
 * `.trimEnd()` on both sides removes exactly that class of difference (and
 * only that class — real interior or leading content never gets trimmed)
 * and nothing else, so the comparison is EXACT once that one documented,
 * evidence-grounded boundary convention gap is normalized away. This is
 * range-anchored content verification of an ALREADY-KNOWN range, not
 * open-ended text inference — the distinction G-05 draws.
 *
 * Two projected blocks can share an identical `.trimEnd()` key only when
 * their exact authored bytes are identical (e.g. two bare `@page-break`
 * lines with nothing else on them) — the `Map` below resolves that with
 * last-write-wins, which is harmless: `viewAttributes`/`kind` are derived
 * from parsing that SAME text, so two blocks with identical trimmed source
 * necessarily produce byte-identical chip content regardless of which one a
 * given call is "really" answering. Anything that goes on to matter (caret
 * placement inside an ACTIVE block, the accepted source edit itself) is
 * handled entirely by the fork's own `absoluteStart`-based machinery, never
 * by this module — see `provider.ts`'s header for why this chip-selection
 * layer never needs to be exactly right about WHICH physical occurrence
 * matched, only about how to paint it.
 */
import type { GeneratedView, GutterpressProjection, ProjectedBlock } from "gutterpress/render";

/** Prebuilt O(1) lookup structures for one `GutterpressProjection` snapshot. */
export interface BlockIndex {
  readonly projection: GutterpressProjection;
  /** `.trimEnd()`d exact-slice text -> the `ProjectedBlock` it names. See this module's header for why last-write-wins on a duplicate key is safe. */
  readonly bySourceText: ReadonlyMap<string, ProjectedBlock>;
  /** A `ProjectedBlock.to` offset -> every `GeneratedView` anchored there (D6: `GeneratedView.anchor` is always some block's own `to`, by construction — see `editor-projection.ts`'s header). */
  readonly generatedByAnchor: ReadonlyMap<number, readonly GeneratedView[]>;
}

export interface BlockMatch {
  readonly block: ProjectedBlock;
  /** Every `GeneratedView` anchored at `block.to` — 0 or more, in projection order. */
  readonly generatedPreviews: readonly GeneratedView[];
}

const EMPTY_GENERATED: readonly GeneratedView[] = [];

function blockKey(source: string, block: ProjectedBlock): string {
  return source.slice(block.from, block.to).trimEnd();
}

/**
 * Builds the lookup structures for `projection` against the exact `source`
 * text it was built from. Call once per projection (typically at
 * `createGutterpressBlockProvider` construction time); `matchProjectedBlock`
 * below is the O(1) per-call query against the result.
 */
export function buildBlockIndex(projection: GutterpressProjection, source: string): BlockIndex {
  const bySourceText = new Map<string, ProjectedBlock>();
  for (const block of projection.blocks) {
    const key = blockKey(source, block);
    // Defensive only: `editor-projection.ts`'s own invariants (a marker
    // block's range always reproduces a "@..." line; a raw-html block's
    // range always covers real HTML bytes) mean `key` is never empty in
    // practice — but an empty key would be a universal, meaningless match
    // target (every blank-only sourceText would collide on it), so it is
    // excluded rather than trusted.
    if (key.length === 0) continue;
    bySourceText.set(key, block);
  }

  const generatedByAnchor = new Map<number, GeneratedView[]>();
  for (const view of projection.generated) {
    const existing = generatedByAnchor.get(view.anchor);
    if (existing) existing.push(view);
    else generatedByAnchor.set(view.anchor, [view]);
  }

  return { projection, bySourceText, generatedByAnchor };
}

/**
 * The live per-call query: does `sourceText` (as handed to the fork's
 * `renderCustomBlock` for one node) correspond to a block `index` knows
 * about? Returns `undefined` — never a guess — when it does not.
 */
export function matchProjectedBlock(index: BlockIndex, sourceText: string): BlockMatch | undefined {
  const key = sourceText.trimEnd();
  if (key.length === 0) return undefined;
  const block = index.bySourceText.get(key);
  if (!block) return undefined;
  return {
    block,
    generatedPreviews: index.generatedByAnchor.get(block.to) ?? EMPTY_GENERATED,
  };
}

/**
 * G-11 — "projection results carry `sourceVersion`; consumers reject
 * stale." A projection needs refresh in either of two cases:
 *
 *   1. The live document's version has moved past the version it was built
 *      against (ordinary staleness).
 *   2. D13 — `projection.limited` is `true` (the block-count cap stopped
 *      the walk before covering the whole document). `editor-projection.ts`'s
 *      own doc comment on `GutterpressProjection.limited` is explicit: "A
 *      consumer MUST treat `limited: true` as stale-equivalent (G-11's
 *      existing convention): fall through to default (non-projected)
 *      rendering for the whole document" — folded in here, not as a
 *      separate check, so every caller of `needsRefresh`
 *      (`GutterpressBlockProvider.needsRefresh`,
 *      `GutterpressEditorMount.needsRefresh`) gets this for free. Rebuilding
 *      a projection for the SAME oversized document would still come back
 *      `limited: true` — "needs refresh" here means "do not trust this
 *      projection for chip rendering," not "rebuilding will necessarily
 *      clear the condition."
 */
export function projectionNeedsRefresh(projection: GutterpressProjection, currentVersion: number): boolean {
  return projection.limited === true || projection.sourceVersion !== currentVersion;
}
