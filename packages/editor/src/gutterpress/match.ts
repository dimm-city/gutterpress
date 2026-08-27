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
 * AMBIGUOUS COLLISION (SFE-P2b repair round 2 — this section replaces the
 * round-1 text, which closed only the one reported fixture and left every
 * other container syntax, and CRLF documents, still failing open; see git
 * history for the round-1 wording this supersedes): two DIFFERENT physical
 * locations in `source` can hand the fork the SAME `.trimEnd()`-normalized
 * text for two DIFFERENT calls. G-05 requires failing closed whenever a key
 * cannot be safely attributed to exactly one location — so `buildBlockIndex`
 * below excludes any such key from `bySourceText` entirely (no chip renders
 * for ANY occurrence of that key; every call for it falls through to
 * `undefined`, same as an ordinary unmatched call). Two independent sources
 * feed that exclusion:
 *
 *   1. Two-or-more `ProjectedBlock`s in `projection.blocks` sharing a key
 *      (e.g. two chapters that both open `@page splash` — `markers.js`'s
 *      `openPage` derives `class`/`data-chapter-label` from the ENCLOSING
 *      `@chapter` frame, not from the `@page` line's own text, so the two
 *      blocks' `viewAttributes`/generated previews differ even though their
 *      trimmed source is byte-identical; painting either one's chip on the
 *      other's call would be wrong content, which G-05 treats as worse than
 *      no chip at all).
 *   2. A key that is ALSO reachable, once each line's leading container
 *      marker(s) are stripped, from some OTHER physical location in
 *      `source` that is not the owning block's own range — e.g. the same
 *      marker line repeated inside a blockquote or a list item, which
 *      `editor-projection.ts` deliberately refused to project (its own
 *      `markerLineLooksAuthored` check requires the line to start with
 *      `@`, not `>`/`-`/an ordinal). That refused occurrence has NO entry
 *      in `projection.blocks`, but the fork still calls `renderCustomBlock`
 *      for it with a `sourceText` that, after `.trimEnd()`, is identical to
 *      the legitimate block's own key — see {@link hasOtherPhysicalOccurrence}.
 *
 * WHY SOURCE 2's DETECTION IS A WHOLE-DOCUMENT LINE INDEX, NOT A BLANK-LINE
 * CHUNK SCAN (round-1's approach, replaced here): round 1 split `source` on
 * blank-line runs, stripped only a `>` prefix per line, and compared each
 * WHOLE CHUNK's key against a block's key. Three ways that missed real
 * refused occurrences, each verified live against the production
 * `mountGutterpressEditor` (a temporary instrumented btest driving it in
 * real Chromium — written, run, deleted; this file's own change is what
 * remains):
 *
 *   - A refused occurrence with NO blank line separating it from the real
 *     block (`"@page splash\n> @page splash\n\nTail.\n"`) shares round-1's
 *     blank-line CHUNK with the real block, so the chunk's key becomes the
 *     two lines joined ("@page splash\n@page splash") — never equal to
 *     either line's OWN key alone, so the whole-chunk comparison silently
 *     passed it through.
 *   - A refused occurrence under a LIST item (`"- @page splash"`) was never
 *     stripped at all — round 1 only stripped `>` markers, not list bullets
 *     or ordinals.
 *   - A CRLF document's blank-run regex only matched a bare `\n\n`, never
 *     `\r\n\r\n`, so the entire source became ONE chunk and the check was
 *     inert.
 *
 * The fix below drops "chunk by blank lines, compare whole chunks" for
 * "index EVERY physical line in the document by its container-stripped
 * text, independent of blank-line boundaries" ({@link computeSourceLines},
 * {@link stripContainerPrefixes}, both CRLF-aware via a terminator regex
 * that matches `\r\n`, `\r`, or `\n`) — a block's key is checked against
 * every OTHER line (or, for a multi-line key such as a raw-html block,
 * every other WINDOW of consecutive lines) in the whole document, so it no
 * longer matters whether a blank line happens to separate the refused
 * occurrence from anything else, and it generalizes to any container
 * marker (blockquote, bullet list, ordered list, or nested combinations —
 * {@link CONTAINER_PREFIX_RE} strips one layer at a time) rather than only
 * blockquote.
 *
 * NORMALIZATION ASYMMETRY (SFE-P2b repair round 3 — closes the class round 2
 * left open, not a new fixture list): round 2's line index compared each
 * physical line's container-STRIPPED text against a block's key, but the two
 * sides normalized WHITESPACE differently, so two variants one character away
 * from round 2's own fixtures still failed open, verified live:
 *
 *   - TRAILING WHITESPACE: `matchProjectedBlock` keys on `sourceText.trimEnd()`,
 *     but round 2's `SourceLine.text` was never trimmed — `"> @page splash   "`
 *     (three trailing spaces) stripped to `"@page splash   "`, never equal to
 *     the owning block's `"@page splash"` key. Fixed by trimming
 *     {@link SourceLine}'s own `text` field the same way, once, at the point
 *     it is computed (see that interface's doc comment) — and, for
 *     consistency, trimming each split `keyLines` entry in
 *     {@link hasOtherPhysicalOccurrence} the same way.
 *   - RESIDUAL INDENTATION: {@link CONTAINER_PREFIX_RE} consumed at most ONE
 *     `[ \t]` after `>`, so `">   @page splash"` (two spaces past the one
 *     CommonMark itself treats as the marker's own separator) stripped to
 *     `"  @page splash"` and stopped there — still not equal to the key.
 *     Fixed by widening the blockquote alternative to `>[ \t]*` (see that
 *     constant's doc comment).
 *
 * Both fixes are one-directional tightenings: they can only make two texts
 * that previously compared UNEQUAL (on whitespace alone) compare EQUAL now,
 * never the reverse — so they can only exclude MORE ambiguous keys, never
 * accidentally un-exclude one that round 2 correctly caught.
 * `editor-projection.test.ts`'s enumeration tests and
 * `gutterpress.btest.ts`'s existing round-2 cases stay green under this
 * change (asserted, not assumed) precisely because neither depends on
 * trailing whitespace or multi-space container separators.
 *
 * This is still a heuristic detector over container syntax, not a formal
 * proof that every possible whitespace/container permutation is covered —
 * see `provider.test.ts`'s property-style case in this same suite, which
 * exercises a cross product of container prefixes and surrounding whitespace
 * rather than one fixture per reported shape.
 *
 * WHY THIS STAYS A BUILD-TIME KEY EXCLUSION AND NOT A PER-CALL SEQUENCE
 * CURSOR: the round-2 finding this section responds to suggested tracking a
 * document-order cursor over `projection.blocks` instead, matching each
 * live call against "the cursor's own next block" and advancing only on an
 * exact hit — which would indeed make a nested/refused occurrence
 * unmatchable without needing to detect it at all. That was tried and
 * discarded after live verification (the same instrumented-btest method
 * referenced above) showed it regresses existing, approved behavior:
 * `renderCustomBlock` is called again, for a single already-matched block,
 * OUT OF the original document order, whenever a user activates then
 * deactivates that one block with no source edit in between (confirmed by
 * logging every call across a real mount → activate → deactivate cycle —
 * the deactivate step produced a fresh call carrying the SAME sourceText as
 * the block's very first call, after three unrelated blocks' calls had
 * already been logged in between). The projection stays fresh across that
 * whole cycle (G-11 staleness is keyed to the document's edit VERSION, and
 * merely activating/deactivating a block is not an edit), so this is not a
 * rare corner case — it is exactly what `gutterpress.btest.ts`'s "two-state:
 * activation, deactivation restores the chip with zero drift" suite already
 * exercises and asserts on. A one-shot consuming cursor cannot re-match
 * that later, out-of-sequence call: the cursor would already have advanced
 * past that block's position, silently un-painting the chip for every block
 * a user has ever activated once. The STATELESS map lookup this file keeps
 * (`bySourceText`) has no such failure mode — a real, unambiguous key
 * always resolves to its one owning block, however many times and in
 * whatever order it is asked, because attribution is decided once, at
 * `buildBlockIndex` time, from the document's text alone, never from call
 * order. Generalizing WHAT counts as ambiguous (source 2 above) closes the
 * reported gap without touching that call-order-independent guarantee.
 *
 * Neither exclusion degrades correctness elsewhere: caret placement inside
 * an ACTIVE block and the accepted source edit itself are handled entirely
 * by the fork's own `absoluteStart`-based machinery, never by this module
 * (see `provider.ts`'s header) — dropping an ambiguous key only ever
 * removes an INACTIVE chip, never a writable range.
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

/** True when `[aFrom, aTo)` and `[bFrom, bTo)` share at least one character position — used to tell "this line/window IS the block's own occurrence" apart from "this is a DIFFERENT physical occurrence with the same container-stripped text" despite the two ranges not being byte-identical (see the header's boundary-convention note on trailing glue). */
function rangesOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * One layer of leading container marker at the start of a line: a
 * blockquote marker (`>`, followed by ANY amount of space/tab — CommonMark
 * itself only ever treats at most one following space/tab as the marker's
 * OWN separator, but this detector is intentionally more permissive than the
 * spec here: SFE-P2b repair round 3 found `">   @page splash"` (two extra
 * spaces past the single separator CommonMark consumes) still reached this
 * module as a live "residual indentation" duplicate — `stripContainerPrefixes`
 * stopped after removing only `"> "`, leaving `"  @page splash"` !=
 * the owning block's key. Consuming every leading space/tab after `>` closes
 * that gap; it can only ever make MORE lines strip down to a marker-shaped
 * key, never fewer, so it cannot introduce a false non-match) or a
 * list-item marker (an unordered bullet `-`/`*`/`+`, or an ordinal `N.`/
 * `N)`, each requiring at least one following space/tab, matching
 * CommonMark's own list-marker grammar closely enough for this detection
 * purpose). {@link stripContainerPrefixes} applies this repeatedly so
 * nested containers (`> - text`, `> > text`, a list item inside a
 * blockquote, ...) fully unwrap to their authored-looking content.
 */
const CONTAINER_PREFIX_RE = /^[ \t]*(?:>[ \t]*|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/;

/** Strips every leading container-marker layer from one line's raw text (no line terminator included). A line with no such marker is returned unchanged. */
function stripContainerPrefixes(line: string): string {
  let text = line;
  for (;;) {
    const next = text.replace(CONTAINER_PREFIX_RE, "");
    if (next === text) return text;
    text = next;
  }
}

/**
 * One physical line of `source`: its exact char range (`to` excludes the
 * line terminator, if any) and its container-stripped, TRAILING-WHITESPACE-
 * TRIMMED text.
 *
 * The `.trimEnd()` (SFE-P2b repair round 3) matches {@link matchProjectedBlock}'s
 * own `sourceText.trimEnd()` key normalization: a live "trailing whitespace"
 * duplicate (`"> @page splash   "`, three trailing spaces the fork's own
 * paragraph node absorbs into ITS text but that
 * `matchProjectedBlock`/{@link blockKey} would trim away) previously left
 * `text` as `"@page splash   "` — never equal to the owning block's own
 * `.trimEnd()`d key — so {@link hasOtherPhysicalOccurrence} silently missed
 * it. Trimming here, once, at the same point `text` is computed, keeps every
 * line/key comparison in this module normalized the SAME way. This can only
 * ever make two texts compare EQUAL that previously compared unequal on
 * trailing whitespace alone, never the reverse — the fail-closed guard can
 * only get more conservative, not less.
 */
interface SourceLine {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Matches a line terminator of any style — `\r\n`, bare `\r`, or bare `\n` — so line splitting is CRLF-safe (round-1's blank-run regex was not; see the header). */
const LINE_TERMINATOR_RE = /\r\n|\r|\n/g;

/** Splits `source` into every physical line (always at least one, even for an empty string), independent of blank-line boundaries. */
function computeSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  LINE_TERMINATOR_RE.lastIndex = 0;
  let lineStart = 0;
  let m: RegExpExecArray | null;
  while ((m = LINE_TERMINATOR_RE.exec(source))) {
    const raw = source.slice(lineStart, m.index);
    lines.push({ from: lineStart, to: m.index, text: stripContainerPrefixes(raw).trimEnd() });
    lineStart = m.index + m[0].length;
  }
  lines.push({
    from: lineStart,
    to: source.length,
    text: stripContainerPrefixes(source.slice(lineStart)).trimEnd(),
  });
  return lines;
}

/** Groups line INDICES (into the parallel `lines` array) by their container-stripped text, for O(1) average lookup of "which lines, anywhere in the document, read as exactly this text once any container markers are stripped". Blank-text lines are excluded — never a meaningful match target. */
function buildSingleLineIndex(lines: readonly SourceLine[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text;
    if (text.length === 0) continue;
    const existing = index.get(text);
    if (existing) existing.push(i);
    else index.set(text, [i]);
  }
  return index;
}

/**
 * True when `key` (a `ProjectedBlock`'s own `.trimEnd()`d exact text, owned
 * by the range `[ownerFrom, ownerTo)`) is ALSO reachable, once container
 * markers are stripped, from some line or run of lines elsewhere in the
 * document — i.e. a second physical occurrence editor-projection.ts either
 * refused to project (a marker line nested in a blockquote/list) or that is
 * simply unrelated authored content that happens to read the same once
 * de-quoted/de-bulleted. Either way the key cannot be safely attributed to
 * `key`'s own block alone (see the header's "AMBIGUOUS COLLISION").
 *
 * Single-line keys (the common case — every marker-family block per
 * `markers.js`'s own one-line-per-marker convention) resolve via one O(1)
 * average map lookup. A multi-line key (a raw-html block spanning several
 * source lines) falls back to a window scan anchored at candidate lines
 * matching the key's OWN first line — bounded by how many lines happen to
 * read the same as that first line, not by the document's total length.
 */
function hasOtherPhysicalOccurrence(
  key: string,
  ownerFrom: number,
  ownerTo: number,
  lines: readonly SourceLine[],
  singleLineIndex: ReadonlyMap<string, readonly number[]>,
): boolean {
  // Each split line is `.trimEnd()`d too (SFE-P2b repair round 3), matching
  // `SourceLine.text`'s own normalization above — both sides of every
  // comparison below go through the exact same trailing-whitespace rule, so
  // a duplicate that differs from the owning block's key only in trailing
  // whitespace on some line still resolves as the SAME text. `key` itself
  // (from `blockKey`) is already `.trimEnd()`d at its very end, so this is a
  // no-op for the common single-line case; it only changes anything for a
  // multi-line key's INTERNAL lines, where it is strictly more conservative
  // (more things treated as candidate duplicates), never less.
  const keyLines = key.split(/\r\n?|\n/).map((line) => line.trimEnd());
  const firstLineCandidates = singleLineIndex.get(keyLines[0]!);
  if (!firstLineCandidates) return false;

  if (keyLines.length === 1) {
    for (const i of firstLineCandidates) {
      const line = lines[i]!;
      if (!rangesOverlap(line.from, line.to, ownerFrom, ownerTo)) return true;
    }
    return false;
  }

  for (const i of firstLineCandidates) {
    if (i + keyLines.length > lines.length) continue;
    let windowMatches = true;
    for (let j = 1; j < keyLines.length; j++) {
      if (lines[i + j]!.text !== keyLines[j]) {
        windowMatches = false;
        break;
      }
    }
    if (!windowMatches) continue;
    const windowFrom = lines[i]!.from;
    const windowTo = lines[i + keyLines.length - 1]!.to;
    if (!rangesOverlap(windowFrom, windowTo, ownerFrom, ownerTo)) return true;
  }
  return false;
}

/**
 * Builds the lookup structures for `projection` against the exact `source`
 * text it was built from. Call once per projection (typically at
 * `createGutterpressBlockProvider` construction time); `matchProjectedBlock`
 * below is the O(1) per-call query against the result.
 *
 * G-05 fail-closed: a key reachable from more than one physical location in
 * `source` (whether two real `ProjectedBlock`s, or one real block plus a
 * refused/non-projected occurrence — or simply unrelated authored text —
 * elsewhere, see the header's "AMBIGUOUS COLLISION") is excluded from
 * `bySourceText` entirely. No chip renders for any occurrence of an
 * ambiguous key; every call for it falls through to `undefined`, same as an
 * ordinary unmatched call.
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

  // Second collision source: a key that ALSO turns up, once container
  // markers are stripped, in some OTHER line or line-run of `source` that
  // is not this block's own occurrence (see header). Only the keys that
  // survived the loop above are worth checking — an already-ambiguous or
  // never-live key has nothing left to protect.
  if (bySourceText.size > 0) {
    const lines = computeSourceLines(source);
    const singleLineIndex = buildSingleLineIndex(lines);
    for (const [key, block] of bySourceText) {
      if (hasOtherPhysicalOccurrence(key, block.from, block.to, lines, singleLineIndex)) {
        ambiguousKeys.add(key);
        bySourceText.delete(key);
      }
    }
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
 *
 * Stateless and idempotent by design (see the header's "WHY THIS STAYS A
 * BUILD-TIME KEY EXCLUSION" note): the same `sourceText` always resolves
 * the same way, however many times and in whatever order the fork asks,
 * because attribution was decided once, at `buildBlockIndex` time, from the
 * document's text alone.
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
