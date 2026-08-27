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
 * AMBIGUOUS COLLISION (SFE-P2b repair round 1 — this section replaces a
 * prior "harmless collision" claim that was false and is preserved here as
 * a record of why): two projected blocks CAN share an identical
 * `.trimEnd()` key while producing DIFFERENT chip content. Concretely,
 * `markers.js`'s `openPage` derives `class`/`data-chapter-label` from the
 * ENCLOSING `@chapter` frame, not from the `@page` line's own text — so two
 * `@page splash` lines under two different chapters trim-equal each other
 * but carry different `viewAttributes` and anchor different
 * `GeneratedView`s (proven live: mounting
 * `"@chapter A\n\n@page splash\n\nBody one.\n\n@chapter B\n\n@page
 * splash\n\nBody two.\n"` through the real production
 * `mountGutterpressEditor` painted chapter B's `data-chapter-label` and
 * generated chapter-opener onto BOTH `@page splash` chips; chapter A's own
 * opener was never rendered anywhere). A second, distinct collision source:
 * `editor-projection.ts` can REFUSE to project a construct whose resolved
 * range does not reproduce a "@" marker line (e.g. a marker line nested
 * inside a blockquote — `markerLineLooksAuthored` fails because the line
 * starts with `>`, not `@`) — that refused occurrence has NO entry in
 * `projection.blocks`, but the fork still calls `renderCustomBlock` for it
 * with a `sourceText` that, after `.trimEnd()`, is identical to the
 * legitimate block's own key (proven live: `"@page splash\n\n> @page
 * splash\n\nTail.\n"` mounts a full structured chip, complete with
 * per-character segments and badges, on the BLOCKQUOTED occurrence the
 * projection deliberately declined).
 *
 * Both are the SAME underlying failure: a bare text key cannot tell two
 * physically DIFFERENT source occurrences apart, and last-write-wins (or
 * any other single-winner rule) paints one occurrence's chip onto the
 * other's call. G-05 requires failing closed here, not guessing — so
 * `buildBlockIndex` below treats any key reachable from more than one
 * physical location in `source` as AMBIGUOUS and excludes it from
 * `bySourceText` entirely (no chip renders for ANY occurrence of that key;
 * the block falls through to the fork's own default rendering, exactly
 * like an unmatched call). Two independent sources feed that exclusion:
 *
 *   1. Two-or-more `ProjectedBlock`s in `projection.blocks` sharing a key
 *      (the `@chapter A`/`@chapter B` case above).
 *   2. A key that is also reachable from a chunk of `source` OTHER than the
 *      owning block's own range, once each line's leading blockquote
 *      marker(s) are stripped (the nested-`@page splash` case above) — see
 *      {@link scanDequotedChunks}.
 *
 * Neither degrades correctness elsewhere: caret placement inside an ACTIVE
 * block and the accepted source edit itself are handled entirely by the
 * fork's own `absoluteStart`-based machinery, never by this module (see
 * `provider.ts`'s header) — dropping an ambiguous key only ever removes an
 * INACTIVE chip, never a writable range.
 */
import type { GeneratedView, GutterpressProjection, ProjectedBlock } from "gutterpress/render";

/** Prebuilt O(1) lookup structures for one `GutterpressProjection` snapshot. */
export interface BlockIndex {
  readonly projection: GutterpressProjection;
  /** `.trimEnd()`d exact-slice text -> the `ProjectedBlock` it names. A key reachable from more than one physical source location is deliberately ABSENT here (fail-closed) — see this module's header, "AMBIGUOUS COLLISION". */
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

/** One or more leading blockquote markers (`>`, optionally nested, each with an optional following space/tab) at the start of a line. */
const BLOCKQUOTE_PREFIX_RE = /^[ \t]*(?:>[ \t]?)+/;

/** True when `[aFrom, aTo)` and `[bFrom, bTo)` share at least one character position — used to tell "this chunk IS the block's own occurrence" apart from "this chunk is a DIFFERENT physical occurrence with the same de-quoted text" despite the two ranges not being byte-identical (see the header's boundary-convention note on trailing glue). */
function rangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * Splits `source` into maximal runs of non-blank lines (chunks separated by
 * one or more blank lines — the same grouping a blank-line-delimited marker
 * line sits in), and for each chunk strips every line's leading blockquote
 * marker(s) before joining and `.trimEnd()`-ing it. This is the exact
 * transform a blockquote-nested marker line's `sourceText` has already
 * undergone by the time it reaches `renderCustomBlock` (see this module's
 * header, "AMBIGUOUS COLLISION" — verified live against the real fork).
 *
 * Used only to DETECT collisions (never to attribute a match): a chunk here
 * that de-quotes to a real block's key, but does not overlap that block's
 * own `[from, to)`, proves the SAME text is reachable from a second,
 * non-projected physical location — the key is unsafe to match on at all.
 */
function scanDequotedChunks(source: string): Array<{ readonly from: number; readonly to: number; readonly key: string }> {
  const BLANK_RUN_RE = /\n[ \t]*(?:\n[ \t]*)+/g;
  const chunks: Array<{ from: number; to: number; key: string }> = [];

  const pushChunk = (from: number, to: number): void => {
    if (to <= from) return;
    const key = source
      .slice(from, to)
      .split(/\r\n?|\n/)
      .map((line) => line.replace(BLOCKQUOTE_PREFIX_RE, ""))
      .join("\n")
      .trimEnd();
    if (key.length > 0) chunks.push({ from, to, key });
  };

  let chunkStart = 0;
  let m: RegExpExecArray | null;
  BLANK_RUN_RE.lastIndex = 0;
  while ((m = BLANK_RUN_RE.exec(source))) {
    pushChunk(chunkStart, m.index);
    chunkStart = m.index + m[0].length;
  }
  pushChunk(chunkStart, source.length);

  return chunks;
}

/**
 * Builds the lookup structures for `projection` against the exact `source`
 * text it was built from. Call once per projection (typically at
 * `createGutterpressBlockProvider` construction time); `matchProjectedBlock`
 * below is the O(1) per-call query against the result.
 *
 * G-05 fail-closed: a key reachable from more than one physical location in
 * `source` (whether two real `ProjectedBlock`s, or one real block plus a
 * refused/non-projected occurrence elsewhere — see the header's "AMBIGUOUS
 * COLLISION") is excluded from `bySourceText` entirely. No chip renders for
 * any occurrence of an ambiguous key; every call for it falls through to
 * `undefined`, same as an ordinary unmatched call.
 */
export function buildBlockIndex(projection: GutterpressProjection, source: string): BlockIndex {
  const bySourceText = new Map<string, ProjectedBlock>();
  const ambiguousKeys = new Set<string>();

  for (const block of projection.blocks) {
    const key = blockKey(source, block);
    // Defensive only: `editor-projection.ts`'s own invariants (a marker
    // block's range always reproduces a "@..." line; a raw-html block's
    // range always covers real HTML bytes) mean `key` is never empty in
    // practice — but an empty key would be a universal, meaningless match
    // target (every blank-only sourceText would collide on it), so it is
    // excluded rather than trusted.
    if (key.length === 0) continue;
    if (ambiguousKeys.has(key) || bySourceText.has(key)) {
      // Two (or more) real projected blocks share this key — neither can be
      // safely attributed (see header). Drop it for good: a later block
      // with this same key must not resurrect it.
      ambiguousKeys.add(key);
      bySourceText.delete(key);
      continue;
    }
    bySourceText.set(key, block);
  }

  // Second collision source: a key that ALSO turns up, once blockquote
  // prefixes are stripped, in some OTHER chunk of `source` that is not this
  // block's own occurrence — e.g. the same marker line repeated inside a
  // blockquote, which `editor-projection.ts` deliberately refused to
  // project (see header). That refused occurrence has no `ProjectedBlock`
  // of its own, so the loop above never sees it; this pass is what catches
  // it.
  for (const chunk of scanDequotedChunks(source)) {
    const owner = bySourceText.get(chunk.key);
    if (!owner) continue; // not a live key (never projected, or already ambiguous) — nothing to protect
    if (rangesOverlap(chunk.from, chunk.to, owner.from, owner.to)) continue; // this chunk IS the block's own occurrence
    ambiguousKeys.add(chunk.key);
    bySourceText.delete(chunk.key);
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
