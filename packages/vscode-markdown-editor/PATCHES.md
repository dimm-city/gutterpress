# PATCHES.md — the vendored `@vscode/markdown-editor` fork's patches

This fork applies the patches below on top of the unmodified, published
`@vscode/markdown-editor@0.0.2-85` artifact (re-pinned from 0.0.2-84 on
2026-09-02: 0.0.2-85's vendored files (everything under dist/ and src/, and the README) are byte-identical to 0.0.2-84's — upstream's
0.0.2-85 publish changed only package.json's version and gitHead, so every
hash in `checksums.json` and every hunk below carries over unchanged):

1. **`renderCustomBlock`** (Hunks 1-7 below) — the custom-block-rendering
   seam specified by `docs/plans/source-first-editor/runs/SFE-P1b.md` and
   ratified in `SFE-P1b-decision.md`. Marked `/* gp-fork: renderCustomBlock */`.
2. **`measurement`** (Hunks 8-10, "## Patch 2" below) — the per-keystroke
   geometry-remeasurement fix specified by
   `docs/plans/source-first-editor/runs/SFE-P3f.md`. Marked
   `/* gp-fork: measurement */`.

Every hunk in both patches is additive (no reformatting, no renaming, no
unrelated edits). Only two files are touched: `dist/index.js` and
`dist/index.d.ts` (Patch 2 touches only `dist/index.js`).
`scripts/verify-vendored.mjs` checks
two independent things: (1) every OTHER vendored file — everything in
`checksums.json`'s `unpatched` map — still byte-matches the hash recorded at
vendor time from the published tarball, AND every git-tracked file in this
package outside a small gutterpress-authored allowlist (`package.json`,
`NOTICE`, `PATCHES.md`, `checksums.json`, `.gitignore`, `scripts/`) is
accounted for as a key in `unpatched` or `patched` — a file added on disk,
or a manifest entry silently removed, fails the check rather than passing
unnoticed; (2) `dist/index.js` and `dist/index.d.ts` match the exact
post-patch hashes in `checksums.json`'s `patched` map (no drift since this
document was written). The pre-patch value of those same two files — so the
two-file diff this document describes can be confirmed against the published
tarball without refetching it — is recorded in `checksums.json`'s
`upstreamBaseline` map.

All line numbers below are from the patched `dist/index.js` /
`dist/index.d.ts` in THIS package. The run specification's "Recorded facts"
cited unpatched-baseline line numbers (`3795-3810`, `4290`, `4438-4446`,
`4474`/`4580`) from a prior lane's exploration of the same 0.0.2-84 build
(byte-identical to the 0.0.2-85 artifact now pinned) —
those matched byte-for-byte against the freshly re-verified tarball used to
vendor this package (see `NOTICE`), confirming the citations. Every patch
site below was located by grepping for the DISTINCTIVE STRING LITERALS named
in the run spec (`"md-block md-paragraph"`, `"unhandledBlock"`,
`renderCustomCodeBlock`), not by trusting the line numbers alone, per the run
spec's own instruction — the numbers happened to still match because this
fork was vendored from the same exact version.

## Why four hunks, not two

The run spec anticipated two patch sites — the paragraph arm and the
unhandledBlock arm of the view-factory switch. Implementing the paragraph
arm's `!showMarkup` gate (required by the seam contract: "Consulted ONLY
while the block is inactive") surfaced a structural fact the run spec did not
anticipate: **unlike `codeBlock`/`mathBlock`/`frontMatter`/`unhandledBlock`,
a plain `paragraph`'s `ViewData` (`ParagraphViewData`, minified `Xr`) never
carried a `showMarkup` field upstream.** A paragraph has no OTHER
block-level active/inactive rendering to toggle between (only individual
inline marks within it — bold, italic, links — independently reveal their
own markers near the caret), so upstream never needed to remember the
block-level active/inactive bit past the point the `ViewData` tree is built.
That bit IS computed at build time (`Se()`'s recursive `ViewData` builder
context, threaded in from `ni()`'s per-top-level-block active/inactive
split), it is just discarded before reaching the view-CONSTRUCTION step
(`Y()`) for a paragraph specifically.

Since the seam's contract requires gating on `!showMarkup` for the paragraph
arm, and no other existing signal survives to `Y()` for a paragraph, Hunks 1
and 2 below thread that already-computed bit onto `ParagraphViewData`,
mirroring the IDENTICAL `(ast, showMarkup, content)` shape the four sibling
block `ViewData` classes already use. This is the smallest correct fix:
additive (existing field, existing computed value, one new constructor
parameter, one call site), and it reuses upstream's own established pattern
rather than inventing a new one.

`unhandledBlock`'s `ViewData` (`UnhandledBlockViewData`, minified `fc`)
already carries `showMarkup` upstream (its doc comment: "Complete HTML
comments use `showMarkup` to switch between their quiet reading treatment
and editable source presentation; OTHER UNHANDLED BLOCKS IGNORE THE FLAG and
keep their warning treatment" — confirming the field exists and is populated
for every `unhandledBlock`, html-comment or not), so the unhandledBlock arm
(Hunk 4) needed no prerequisite threading.

## Hunk 1 — `ParagraphViewData` gains `showMarkup`

**File:** `dist/index.js` — the `Xr` class (minified name of
`ParagraphViewData`).

**Why:** prerequisite for Hunk 3 (see "Why four hunks" above). Mirrors the
`(ast, showMarkup, content)` constructor shape `Qr`/`jr`/`Yr`/`fc`
(codeBlock/mathBlock/frontMatter/unhandledBlock `ViewData`) already use.

Before:

```js
class Xr {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "paragraph";
}
```

After:

```js
class Xr {
  /* gp-fork: renderCustomBlock — thread the build-time showMarkup context
   * (already computed by every caller of Se(), see the "paragraph" case
   * below) onto the ViewData itself, mirroring the SAME (ast, showMarkup,
   * content) shape codeBlock/mathBlock/frontMatter/unhandledBlock already
   * use. Upstream never stored it here because no upstream feature needed
   * a paragraph's active/inactive state at view-construction time; the
   * renderCustomBlock seam does. Additive: the sole construction site
   * (Se()'s "paragraph" case) is updated in the same hunk. */
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "paragraph";
}
```

`Xr` has exactly one construction call site in the whole bundle (verified by
`grep -n "new Xr(" dist/index.js`), updated in lockstep by Hunk 2, so no
other call site needed updating and no existing behavior for any OTHER
consumer of `Xr` changes shape.

## Hunk 2 — thread `showMarkup` at `Xr`'s construction site

**File:** `dist/index.js` — the `Se()` `ViewData`-builder function's
`"paragraph"` case (the recursive `AstNode` → `ViewData` conversion; `e`
here is the build-time context object, whose `.showMarkup` is `true` only
while building the currently-active block's subtree — see `ni()`'s
`{...ti, ...}` / `{showMarkup: true, ...}` split, `ti` being the shared
`showMarkup: false` default context).

Before:

```js
    case "paragraph":
      return M(t, new Xr(i, F(i.children, ee(e), t)));
```

After:

```js
    case "paragraph":
      /* gp-fork: renderCustomBlock — pass the build context's showMarkup
       * through to Xr (ParagraphViewData), see its constructor comment. */
      return M(t, new Xr(i, e.showMarkup, F(i.children, ee(e), t)));
```

`F(i.children, ee(e), t)` (the recursive descent into the paragraph's inline
children) is untouched — `ee(e)` still receives the same `e`, so every
inline descendant's own `showMarkup`/marker-visibility behavior is byte-for-
byte unchanged. Only the paragraph's OWN `ViewData` gains the extra field.

## Hunk 3 — the paragraph arm of the view-factory switch

**File:** `dist/index.js` — function `Y(n, e, t)` (`n` = the block's
`ViewData`, `e` = `BlockViewOptions | undefined`, `t` = the previous view
node, for identity reuse), the `"paragraph"` case. This is the function the
run spec's "Recorded facts" cites at `dist/index.js:3795-3810`.

Before:

```js
    case "paragraph":
      return new fe(n, "p", "md-block md-paragraph", e, we(t));
```

After:

```js
    case "paragraph": {
      /* gp-fork: renderCustomBlock — consulted only while inactive
       * (mirrors the codeBlock !e.showMarkup gate at the
       * renderCustomCodeBlock call site below), returning undefined falls
       * through to the unchanged upstream construction. */
      if (!n.showMarkup && e?.renderCustomBlock) {
        const gpR = e.renderCustomBlock(n.ast, Es(n.ast));
        if (gpR) {
          /* gp-fork: renderCustomBlock — mirror the renderCustomCodeBlock
           * call site's `d.classList.add("md-block", "md-code-block")`
           * (search this file for that exact string): the HOST applies the
           * block-level class, not the provider, exactly as it does for the
           * plain-dom custom-code-block case. Idempotent — harmless if the
           * provider's dom already carries it. See PATCHES.md Hunk 3. */
          gpR.dom.classList.add("md-block");
          return new T(n, gpR.dom, gpR.segments ? Zs(n.ast, gpR.segments, n.ast.length) : D);
        }
      }
      return new fe(n, "p", "md-block md-paragraph", e, we(t));
    }
```

Design notes:

- **Gate.** `!n.showMarkup && e?.renderCustomBlock` mirrors the codeBlock
  gate's shape (`!e.showMarkup && ... && t?.renderCustomCodeBlock` at the
  `renderCustomCodeBlock` call site, `dist/index.js` — search
  `renderCustomCodeBlock`). `n.showMarkup` exists only because of Hunk 1/2.
- **`sourceText`.** `Es(n.ast)` — `Es` (unmodified, pre-existing,
  module-scope function) is upstream's OWN generic "reconstruct a node's
  exact source text" helper: `if (n instanceof <LeafAstNode>) return
  n.content; else return n.children.map(Es).join("")`. It is already used
  upstream (checkbox-marker detection on list items) and is provably exact:
  `AstNode.length` is defined (base class `X`) as the memoized sum of
  `children[i].length`, and every leaf's `.length` is `content.length`
  (`LeafAstNode`/minified `it`), so by induction `Es(node).length ===
  node.length` for every node — i.e. `sourceText.length` always equals the
  node's full source span, exactly matching the convention
  `MathRenderRequest.nodeLength`/`MathSourceSegment.start` already use
  (segment offsets relative to the WHOLE node's start, fences included).
  This was the "cleanest equivalent" to the codeBlock/mathBlock `.code?.content`
  pattern the run spec asked to mirror: paragraphs and unhandledBlocks have
  no dedicated `.code` child to read a ready-made string off of, but they DO
  tile their full source losslessly through their leaf `.content` fields
  (paragraph: the same lossless-parsing guarantee documented on
  `UnhandledBlockAstNode` — "Offsets stay sound: `content` tiles the block's
  full source span exactly" — applies structurally to every `AstNode`, via
  the same `length`-sum invariant), so reusing `Es` needed zero new code and
  zero new assumptions.
- **Plain-`dom` wrapping.** `gpR.dom.classList.add("md-block"); new T(n,
  gpR.dom, D)` mirrors BOTH halves of what `tn`'s (`CodeBlockViewNode`)
  constructor does internally when its own custom-code-block branch fires:
  `d.classList.add("md-block", "md-code-block"), m = d, g = D` — the class
  application AND the plain wrap, not the wrap alone. (Only the generic
  `"md-block"` class is applied here, not `"md-code-block"`, since this arm
  covers `paragraph`/`unhandledBlock`, not code blocks; every
  `.md-block`-scoped editor style this needs to satisfy — see
  `src/view/editor.css`'s `.md-list li>.md-block` /
  `.md-task-list-item>.md-block` rules — keys off that shared class alone.)
  `T` is the SAME base view-node class every block/inline view (including
  `CodeBlockViewNode`) already extends; its constructor is exactly
  `(viewData, domElement, childrenArray)` and is what registers `dom` in
  the DOM→ViewNode lookup tables (`pn`/`pt`) that selection/hit-testing/
  click handling walk. `D` is the same shared empty-array constant `tn`
  uses for `g`. No new view-node class was created, and no engine-private
  extension was added: the class application is prescribed by the upstream
  call site being mirrored, not invented — see `CustomBlockRendering.dom`'s
  doc comment in `dist/index.d.ts` for the published contract this now
  matches.
- **`segments` wiring.** `Zs(n.ast, gpR.segments, n.ast.length)` reuses
  `Zs()` UNMODIFIED — the exact function the two `renderMath` call sites use
  (`Zs(i, c.segments, i.length)` for the math-block view, `Zs(e.ast,
  r.segments, e.ast.length)` for the inline-math view). Passing its result
  as the `children` array to `new T(...)` is exactly parallel to how the
  math views pass it to their own `super(...)` call. **This did NOT require
  touching more than the two switch arms** — `Zs()` and `T` were both
  already generic and unmodified, so full `segments` support (not just the
  plain-`dom` fallback) is mechanically wired through by Lane A. Whether a
  given `renderCustomBlock` PROVIDER actually supplies real per-character
  `segments` (vs. omitting them for the bare-`dom` fallback) is a per-probe
  product/test decision left to Lane B, per the run spec's "Segments
  decision" requirement — this patch does not favor either choice; both are
  fully supported by the plumbing.

## Hunk 4 — the unhandledBlock arm of the view-factory switch

**File:** `dist/index.js` — same `Y(n, e, t)` function, the
`"unhandledBlock"` case. Cited by the run spec at `dist/index.js:3805-3808`
(unpatched baseline).

Before:

```js
    case "unhandledBlock": {
      const s = n.ast.htmlComment;
      return s ? new Ln(n, s, e, N(t, Ln)) : new Sn(n, e, N(t, Sn));
    }
```

After:

```js
    case "unhandledBlock": {
      /* gp-fork: renderCustomBlock — intercepts BEFORE the Ln (html
       * comment) / Sn (generic unhandled) choice, so the hook sees every
       * unhandledBlock kind (html comments are unhandledBlock too; see
       * PATCHES.md for why both are covered). Same !showMarkup gate and
       * fallback contract as the paragraph arm above. */
      if (!n.showMarkup && e?.renderCustomBlock) {
        const gpR = e.renderCustomBlock(n.ast, Es(n.ast));
        if (gpR) {
          /* gp-fork: renderCustomBlock — same host-applies-the-class mirror
           * as the paragraph arm above; see its comment and PATCHES.md
           * Hunk 3. */
          gpR.dom.classList.add("md-block");
          return new T(n, gpR.dom, gpR.segments ? Zs(n.ast, gpR.segments, n.ast.length) : D);
        }
      }
      const s = n.ast.htmlComment;
      return s ? new Ln(n, s, e, N(t, Ln)) : new Sn(n, e, N(t, Sn));
    }
```

**Why intercept before the `Ln`/`Sn` choice, covering html comments too:**
the run spec's decision text says "the paragraph and unhandledBlock arms";
an `UnhandledBlockAstNode` whose `.htmlComment` is set is STILL `kind:
"unhandledBlock"` (the `Ln`/`Sn` split is a rendering-detail choice WITHIN
the unhandledBlock arm, not a different AST/ViewData kind — both `Ln` and
`Sn` receive the exact same `n`/`ViewData` shape,
`UnhandledBlockViewData`). Restricting the hook to only the `Sn` (generic)
branch would silently exclude html-comment blocks from a seam the run spec
describes as covering the whole arm, with no textual basis for that
narrowing. Placing the check first means a provider gets first refusal on
EVERY unhandled block regardless of sub-kind, and `undefined` falls through
to the exact unpatched `Ln`/`Sn` choice, unchanged.

`n.showMarkup` here needed no prerequisite threading — `UnhandledBlockViewData`
(minified `fc`) already receives `e.showMarkup` at its one construction site
(`Se()`'s `"unhandledBlock"` case: `new fc(i, e.showMarkup, F(i.children, e, t))`)
in the unpatched upstream code.

## Hunk 5 — `BlockViewOptions.renderCustomBlock`

**File:** `dist/index.d.ts` — the exported `BlockViewOptions` interface.

Added (directly after the existing, untouched `renderCustomCodeBlock`
member):

```ts
    /**
     * gp-fork: renderCustomBlock. Pluggable renderer for the *inactive*
     * (rendered) form of a `"paragraph"` or `"unhandledBlock"` node —
     * parallel to {@link renderCustomCodeBlock} and {@link renderMath}, but
     * for any block those two seams do not cover. Called with the block's
     * AST node and its exact source text (see {@link CustomBlockRendering}).
     * When set and it returns a result, its {@link CustomBlockRendering.dom}
     * replaces the block's default rendering, and its
     * {@link CustomBlockRendering.segments}, if supplied, let parts of the
     * rendered output map back to source ranges so the caret can land
     * inside them (the same mechanism {@link renderMath}'s `segments` use).
     * Returning `undefined` falls back to the default rendering, unchanged.
     * Never consulted while the block is active (source shown).
     */
    readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
```

Exact signature required by `SFE-P1b.md`'s "Binding decisions" block. No
existing member of `BlockViewOptions` was reformatted or reordered.

## Hunk 6 — `CustomBlockRendering` / `SourceSegment`

**File:** `dist/index.d.ts` — two new exported interfaces, placed
immediately after the `BlockViewOptions` interface (adjacent to the member
that references them; the file's existing declarations are otherwise
untouched — no re-sort was attempted).

```ts
/**
 * gp-fork: renderCustomBlock. Result of a {@link BlockViewOptions.renderCustomBlock}
 * renderer. A direct rename of the package's own {@link MathRendering} to a
 * non-math-specific name — not a new shape.
 */
export declare interface CustomBlockRendering {
    /**
     * Host element to mount (the rendered block output). The host adds the
     * `md-block` class to this element itself (mirroring
     * {@link BlockViewOptions.renderCustomCodeBlock}'s call site, which does
     * the same for its own plain-`dom` result) — every `.md-block`-scoped
     * editor style depends on it, so providers do not need to set it
     * themselves, and setting it anyway is harmless (idempotent).
     */
    readonly dom: HTMLElement;
    /**
     * Source-mapped spans within {@link dom} (need not tile the whole node).
     * Optional — omit for the bare-`dom` fallback: the whole element is
     * mounted with no interior source mapping, so caret entry lands at the
     * block's start and drag precision is reduced to that one boundary.
     * When present, threaded into the same segment-tiling helper the
     * package's own math views already use.
     */
    readonly segments?: readonly SourceSegment[];
}

/**
 * gp-fork: renderCustomBlock. A span of a {@link CustomBlockRendering.dom}
 * that maps to a slice of source, relative to the block node's start. A
 * direct rename of the package's own {@link MathSourceSegment} to a
 * non-math-specific name — not a new shape.
 */
export declare interface SourceSegment {
    /** A DOM node (ideally a Text node) within the rendered output. */
    readonly dom: globalThis.Node;
    /** Start offset of the mapped slice, relative to the block node's start. */
    readonly start: number;
    /** Source length of the mapped slice. */
    readonly length: number;
}
```

As the run spec states, these are a direct rename of the package's own
`MathRendering`/`MathSourceSegment` (unpatched `dist/index.d.ts:2378-2411`)
to a non-math-specific name — not a new shape. `MathRendering`/
`MathSourceSegment` themselves are untouched.

Verified against a real `tsc --noEmit` type-check (not just `--skipLibCheck`
syntax parsing): a scratch consumer asserting the exact
`(node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined`
signature type-checks, and a deliberately wrong-typed
`(node: BlockAstNode, sourceText: number) => undefined` assignment is
correctly rejected by `tsc` (confirmed via a removed/restored
`@ts-expect-error` sabotage check — see the run report).

## Hunk 7 — internal `ParagraphViewData` declaration (documentation-only)

**File:** `dist/index.d.ts` — the internal (non-exported, `declare class`,
no `export` keyword — not part of the package's public type surface)
`ParagraphViewData` declaration, kept accurate to match Hunk 1's runtime
shape change.

Before:

```ts
declare class ParagraphViewData {
    readonly ast: ParagraphAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "paragraph";
    constructor(ast: ParagraphAstNode, content: readonly AnyViewData[]);
}
```

After:

```ts
declare class ParagraphViewData {
    readonly ast: ParagraphAstNode;
    /**
     * gp-fork: renderCustomBlock. Upstream never stored this on
     * ParagraphViewData (a plain paragraph has no other block-level
     * active/inactive rendering to switch between); the seam's `!showMarkup`
     * gate needs it here the same way codeBlock/mathBlock/frontMatter/
     * unhandledBlock already carry it. See dist/index.js's Xr class.
     */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "paragraph";
    constructor(ast: ParagraphAstNode, showMarkup: boolean, content: readonly AnyViewData[]);
}
```

Since this type is not exported, this hunk has zero effect on the package's
public API surface — it exists purely so the `.d.ts` accurately documents
the runtime shape Hunk 1 introduced, for anyone reading the file.

## What Lane A did NOT do

- Did not touch `dist/commands.js`, `dist/config*.js`, `dist/stringEdit-*.js`,
  `dist/web-editors.js`, any `.css`, or any `.map` file — `checksums.json`'s
  `unpatched` map (verified by `scripts/verify-vendored.mjs`) proves this.
- Did not add a `contentStart`-style offset param to the seam (the run
  spec's signature is exactly `(node, sourceText)`) — `sourceText` is always
  the FULL node span (fences/markers included, since paragraphs and
  unhandled blocks have no fence-like prefix to strip the way math/code do),
  so segment offsets need no adjustment.
- Did not reformat, rename, or reorder any existing declaration.
- Did not wire real per-character `segments` for any specific probe (e.g.
  `@page splash`) — that is Lane B's test-provider and contract-test
  responsibility, per the run spec's "Segments decision" requirement. Lane
  A's patch supports both the plain-`dom` and `segments` shapes equally.

## Patch 1 upstreaming / removal trigger

Delete this fork, and switch `packages/editor` back to the plain
`@vscode/markdown-editor` registry dependency, when EITHER:

1. Upstream ships an equivalent generic custom-block-render hook on
   `BlockViewOptions` for the `paragraph`/`unhandledBlock` arms (matching or
   subsuming this seam's contract), or
2. This exact `renderCustomBlock` seam is upstreamed as an accepted PR
   against `microsoft/vscode-packages` (directory
   `vscode-team-tools/packages/markdown-editor`).

Per CLAUDE.md's design-for-deletion rule and `SFE-P1b.md`'s provenance
constraint, an upstream feature request/PR for this seam is the preferred
end state; this fork is deliberately as small and as generic as possible so
that day's diff is trivial. (This trigger covers Patch 1 only — see Patch
2's own trigger below.)

---

## Patch 2 — measurement (SFE-P3f — the D13 fix)

**Decision record.** `docs/plans/source-first-editor/runs/SFE-P3f.md`,
building on SFE-P3d-sweep Lane D's differential proof
(`docs/plans/source-first-editor/p3d-sweep-audit.md`, "## Lane D"): the D13
250 KiB p95 budget miss is inherent to this vendored fork —
`EditorView._renderAutorun -> _publishMeasurements` unconditionally
remeasures every mounted block's DOM geometry on every render, regardless
of how much of the document a keystroke actually changed. D5's fork
governance permits a minimal, hunk-documented, checksum-verified patch for
exactly this kind of finding; this is that patch.

### Consumer map (SFE-P3f METHOD step 1)

`_publishMeasurements` is the ONLY producer of `MeasuredLayoutModel`'s
(`wo`, `dist/index.js`) published state — `_measurements` (one
`BlockMeasurement` per top-level block: `block`, `absoluteStart`, `height`,
`rect`, `viewportClip`, `visualLineMap`, `viewNode`) and `_virtualLines`
(the pending-paragraph cursor line, untouched by this patch — see below).
Every consumer reads through `EditorView.measuredLayout.measurements` or
`.visualLineMap` (the latter a DERIVED observable, `wo.visualLineMap`, that
concatenates every block's `visualLineMap.lines` — its own doc comment
already states the load-bearing invariant this patch relies on: "every
per-block map uses the SAME editor-local coordinate space, so concatenation
is well-formed WITHOUT TRANSLATION OR RE-SORTING"). Grepping every read site
of `measuredLayout.measurements`/`measuredLayout.visualLineMap` in
`dist/index.js` gives the complete consumer list:

| Consumer | Call site | What it reads | When |
|---|---|---|---|
| `resolveOffsetFromPoint` (pointer -> offset, drag selection) | `dist/index.js:~6233` | `visualLineMap.get()` -> `offsetAtPoint` | event-time (pointer move/click) |
| `_resolveTableCellOffset` (empty-cell disambiguation) | `~6262` | `visualLineMap.get().lines` (run-overlap check) | event-time |
| `_selectionBlocksObs` (which blocks the current selection spans) | `~5985` | `measurements.read(e)` (`.rect`/`.viewNode`) | reactive, render-time |
| `_revealRange` (caret-reveal / scroll-into-view) | `~6403,6412,6451` | `measurements.get()`, `visualLineMap.get()` | after an accepted edit |
| `_selectionView`/`_cursorView`/`_gutterMarkersView` overlays | `~5892,5896,5900` | `visualLineMap` (observable) | reactive, render-time |
| Selection/decoration measurement passthrough | `~6661` | `measurements.read(r)` | reactive |
| Find-widget match-rect painting (`rangeRects`-style tiling) | `~6699,6733` | `visualLineMap.get()` (per-run rects, the same tiling the `renderCustomBlock` segment seam depends on) | `requestAnimationFrame`-scheduled paint |
| A line-map handoff (comment widget / similar positioning) | `~7735` | `visualLineMap.get()` | event-time |
| `_paint()` line/offset math elsewhere in the same class | `~6525,6560` | `visualLineMap.get()`, `measurements.get()` | event/paint-time |

**Disposition, all consumers:** every row above reads the CURRENT value of
an observable that `_publishMeasurements` populates, in full, exactly once
per call, via `MeasuredLayoutModel.setMeasurements(e, t)` (`te((s) => {...})`
— a single transactional update, unmodified by this patch). This patch does
not defer, skip, or partially publish any block's measurement: EVERY block
in `e.blocks` still gets a complete `BlockMeasurement` entry on every
`_publishMeasurements(p, true)` call, published at the exact same point in
the render cycle as before this patch. The only thing this patch changes is
HOW that entry's `visualLineMap` is computed for a block whose rendered
subtree is provably unchanged (translate a cached, correct map instead of
re-walking the DOM) — never WHETHER or WHEN it is published. There is
therefore no "stale/unmeasured" state for any consumer above to observe;
the honesty requirement in SFE-P3f.md's binding constraints ("every
consumer that could read a deferred value must either trigger measurement
on demand or provably never be reached for an unmeasured block") is met by
construction — there is no deferred value, only a cheaper-to-produce one.

**This is a claim about TIMING, not about correctness, and the two are
separate questions.** "Every consumer always reads a published value" says
nothing about whether that published value is the RIGHT one — a stale
`visualLineMap` translated from a cache keyed on the wrong `absoluteStart`
is still published on schedule, in full, exactly as this paragraph
describes; it is simply wrong. SFE-P3d-sweep+P3f repair round 1 found
exactly that defect in an earlier version of this patch (the cache-reuse
guard below did not compare `absoluteStart`, so a block's cached map — and
therefore what every consumer above reads — went stale by exactly the
length of any edit landing earlier in the document, corrupting pointer
click resolution, drag selection, and caret painting for every block after
the edit). That defect is fixed in the code below (the `gpReusable` guard's
`absoluteStart` comparison) and is why "Why the translate is exact, not
approximate," below, states two separate invariants rather than one — see
that section for what is actually guaranteed, correctly, by the code as it
ships.

The pending-paragraph path (`_virtualLines`, `e.pendingParagraph` in
`_publishMeasurements`) is untouched: it is measured unconditionally,
directly from the live DOM, in the SAME unmodified code this patch left in
place after the per-block loop.

### Strategy chosen, and the prototype that chose it (SFE-P3f METHOD step 2)

SFE-P3f.md's preference order was: (1) skip remeasuring blocks whose view
nodes were reused by identity; (2) viewport-scoped measurement with lazy
fill. A throwaway harness (single 250 KiB document, 20 keystrokes, no
inter-keystroke pacing, reusing `tests/perf/support/entry.ts`/`drive.ts`/
`corpus.ts` unmodified — the same fast ~15s inner loop Lane D's own
prototyping used) reproduced the baseline signal first (p50=536.8ms
p95=610.2ms, matching Lane D's 554-632ms band), then measured strategy (1):

- **Strategy (1) alone, sound implementation:** p50=274.9ms p95=333.0ms —
  roughly a 46% p95 reduction, but still 3.3x over the 100ms budget.
- **A stage-by-stage timing breakdown inside `_renderAutorun`** (temporary
  `globalThis.__gpProf` marks at each stage, removed before finishing;
  method identical in spirit to Lane D's own `__gpProfile` hook) showed
  `_renderAutorun`'s OWN synchronous cost, with strategy (1) applied, drops
  to ~21ms total per keystroke at 250 KiB (`ni()` ~0.5ms, `sn.create()`
  ~3.8ms, `_publishMeasurements` ~14-16ms) — i.e. strategy (1) fully
  eliminates the O(document) cost Lane D located INSIDE
  `_publishMeasurements`. The REMAINING ~250-270ms lives entirely OUTSIDE
  `_renderAutorun`, between the raw `keydown` event and `_renderAutorun`
  even starting — confirmed unaffected by this patch either way (measured
  at ~251ms mean with the patch active, ~269ms mean with strategy (1)
  forced off/full-remeasure, i.e. present in the UNPATCHED fork too, not
  introduced or worsened by this patch).
- **Locating that remaining cost:** it is not inside the adapter (Lane D
  already showed that stage-by-stage, sub-millisecond) and not inside
  `_publishMeasurements` bookkeeping (a deliberately UNSOUND experiment —
  skipping even the cheap per-block `getBoundingClientRect`/
  `getComputedStyle` reads entirely for cache-eligible blocks, discarded
  before finishing — barely moved the number, and a 4-size sweep with that
  same unsound experiment showed the residual cost scales near-linearly
  with TOTAL mounted document size even when the loop body does almost
  nothing: 10 KiB~15ms, 25 KiB~31ms, 100 KiB~113ms, 250 KiB~271ms p50). The
  likely mechanism, located by reading (not further instrumented, and not
  patched): `EditorView`'s keyboard controller (`class wl`,
  `dist/index.js:~7600`) wires `EditContext.addEventListener("textupdate",
  this._handleTextUpdate)` — ordinary character input on this fork is
  driven by the BROWSER's native `EditContext` `textupdate` event, not
  synchronously inside the `keydown` handler; `this.editContext`'s own text
  buffer mirrors the FULL document (`editContext.updateText(0,
  editContext.text.length, s)`, `_renderAutorun`'s first lines). This is
  consistent with `contain`/`content-visibility` being absent everywhere in
  `src/view/editor.css` EXCEPT one unrelated decorative spinner
  (`.monaco-pixel-spinner`) — nothing scopes layout/paint to a sub-region of
  the document, so the browser's own native EditContext/layout pipeline for
  a large mounted DOM is the plausible remaining cost, not a JS-level loop
  this patch's candidate strategies can shrink further.
- **Verifying strategy (2) would not help either:** the SAME unsound
  "skip everything for cache-eligible blocks" experiment above IS,
  functionally, most of what viewport-scoped measurement would achieve for
  a keystroke typed at the end of a document (nearly every block is
  cache-eligible and untouched) — it barely moved the number. Since the
  dominant remaining cost sits OUTSIDE `_publishMeasurements` entirely (the
  no-op experiment below), no reduction in how many blocks
  `_publishMeasurements` touches — by identity-skip OR by viewport
  scoping — can reach it. A THIRD experiment made `_publishMeasurements`
  return immediately (a complete no-op) whenever called incrementally,
  isolating cost outside it entirely: 250 KiB p50 stayed at 255.2ms (vs
  274.9ms with the real, sound patch) — confirming `_publishMeasurements`,
  even fully disabled, is responsible for only ~20ms of the total, and that
  ANY strategy scoped to `_publishMeasurements` (1 or 2) tops out at
  roughly the same ceiling. Per SFE-P3f.md's own instruction ("Pick the
  SMALLEST that empirically lands the budget; do not build both"), and
  since strategy (1) captures effectively all of what a measurement-pass
  fix can capture, strategy (2) was not built.

**Conclusion:** strategy (1), soundly implemented, is the correct and
sufficient measurement-pass fix — it does not reach the 100ms budget alone,
but the remaining gap is a separate, pre-existing mechanism outside
`_publishMeasurements`/`_renderAutorun` (and, on the CSS evidence above,
plausibly outside anything a JS-level patch to the measurement pass could
fix at all). See "Budget verdict" in this run's `p3d-sweep-audit.md` "##
Lane E (P3f)" section for the honest final numbers and the explicit
non-recommendation to chase this further inside this patch's scope.

### Why the translate is exact, not approximate

**SFE-P3d-sweep+P3f repair round 1 correction:** an earlier version of this
section argued from ONE invariant (view-node identity) to the conclusion
that translation is always exact. That was wrong: `mo()` (and therefore
every cached `visualLineMap`) depends on TWO independent inputs — the
block's rendered DOM subtree, AND its `absoluteStart` (baked into every
run's `sourceRange` as an ABSOLUTE document offset, `v.fromTo(m+R, m+V)`
with `m` derived from `absoluteStart`). View-node identity proves only the
first is unchanged; it says nothing about the second. `absoluteStart` is
assigned per-render, POSITIONALLY (`ni()`'s `d += h.length` accumulation),
is not part of `ViewData`, and is never consulted by `Y()`/`canReuse` — so
a block whose own AST/`showMarkup` subtree is untouched (reused by
identity, internal geometry genuinely unchanged) can still have a
DIFFERENT `absoluteStart` than the one its cached `sourceRange`s were built
from, whenever an edit changes the character count of anything earlier in
the document. Translating that stale cache's RECTS does not, and cannot,
fix its now-wrong `sourceRange`s — translation moves pixels; it never
touches `sourceRange` (see `gpTranslateVisualLineMap`, which carries
`sourceRange` through untouched by design). The corrected argument below
proves both invariants explicitly, and the code enforces both.

**(1) Internal geometry is proven unchanged by view-node identity.** `Y(n,
e, t)` (`dist/index.js:~3780`, unmodified by this patch) already implements
block-level DOM/view-node reuse: `if (t instanceof T) { if (t.canReuse(n,
e)) return t; }`, where `T.canReuse(e) { return this.data === e; }` — a
REFERENCE check against the block's `ViewData`. The ViewData builder
(`Se()`/`M()`, unmodified) already preserves ViewData identity only when a
block's ENTIRE subtree — ast, `showMarkup` (active/inactive), and every
nested mark's own visibility — is unchanged (this is the SAME identity the
existing `renderCustomBlock` patch's Hunk 1-2 threads `showMarkup` through,
and the SAME identity `EditorModel.document`'s own memoization already
relies on for the parse side — see that class's doc comment: "unchanged
blocks keep their object identity across reparses"). So: `r.node` being the
SAME object as the entry this loop measured last render, for the SAME
array position, already means (by an invariant this renderer's OWN
DOM-reuse correctness already depends on, not one this patch introduces)
that block's rendered DOM — and therefore its INTERNAL geometry (line
wraps, run positions relative to the block's own top-left) — did not
change. The `className` equality check adds a second, independent, CHEAP
guard against any block-level presentation state (e.g.
`md-block-active`/`md-markers-hidden`, `md-diff-added`) this reasoning did
not anticipate; `src/view/editor.css`'s only layout-relevant rule gated by
such a class (`.md-table.md-block-active td { position: relative }`) sits
inside a table whose own active-state change already invalidates ViewData
identity for that block, so it can never surface on a
`gpReusable`-eligible node — the `className` check is defense-in-depth, not
load-bearing on its own.

**(2) Absolute source offsets are proven unchanged ONLY by comparing
`absoluteStart` directly — view-node identity implies nothing about it.**
The `gpReusable` guard therefore requires `gpCache.absoluteStart ===
r.absoluteStart` as a THIRD, independent condition alongside identity and
`className` (see Hunk 9 below). When it holds, no edit has changed the
character count of anything earlier in the document since the cache was
recorded, so every cached `sourceRange` is still the correct absolute
range for this block. When it does NOT hold — the case the earlier,
uncorrected version of this patch missed — the cache is stale by exactly
that shift and the code falls through to a full `Pe.measure()` instead of
translating; a `dOff`-shifting alternative (add the observed
`absoluteStart` delta to every cached `sourceRange`, avoiding the full
remeasure) was considered and rejected in favor of the simpler,
obviously-sound fallback — see "Repair round 1: the fallback-over-shift
choice," below.

What CAN change between two renders of a block whose identity, `className`,
AND `absoluteStart` are ALL confirmed unchanged is only its screen
POSITION — a sibling before it in document order grew or shrank in
rendered height. This patch re-reads that position for EVERY block, every
render, via the SAME cheap `getBoundingClientRect()` call the unpatched
code already made (never skipped — see "Why the cheap read is never
skipped," below), and applies the OBSERVED delta (`c.x - gpCache.rect.x`,
`c.y - gpCache.rect.y` — real numbers from a real, fresh DOM read, never
modeled/assumed via margin or gap arithmetic) to the cached map via
`C.prototype.translate` (unmodified, pre-existing on the rect class).
Because the block's own internal layout is provably unchanged (invariant
1), its absolute source offsets are provably unchanged (invariant 2), and
its coordinate space is shared document-wide (`wo.visualLineMap`'s own
stated invariant, above), a uniform translation of every line/run rect by
that SAME observed delta is exactly what a fresh `Pe.measure()` call would
have computed — not an approximation of it.

### Repair round 1: the fallback-over-shift choice

SFE-P3d-sweep+P3f's repair round considered two equally-sound fixes for the
missing `absoluteStart` check: (a) fall back to a full `Pe.measure()`
whenever `absoluteStart` changed (what shipped), or (b) keep translating
but additionally shift every cached `sourceRange` by the observed
`absoluteStart` delta, avoiding the remeasure. (a) was chosen on
correctness/simplicity grounds despite a real, measured cost: it is the
smaller, more obviously correct change (one added comparison, no new
arithmetic on `sourceRange`), and it cannot silently miscompute a shift the
way a `dOff`-arithmetic bug could. But the D13 benchmark harness
(`packages/editor/tests/perf/support/drive.ts`) does not exercise an
append-only workload — its `page.click(selector)` + `press("End")` lands
the caret at character ~937 of 256,018, under 1% into the document, so
nearly every block's `absoluteStart` shifts on nearly every keystroke.
Against that (unfixed) navigation, (a) forfeits the entire apparent win:
the re-measured p95 across this repair round's two clean invocations is
560.2-577.0 ms, statistically indistinguishable from the unpatched
554.3-631.7 ms band (Lane B/Lane D) — roughly 240 ms of the originally
reported 290.3-339.7 ms p95 evaporates once the `absoluteStart` fix makes
`gpReusable` correctly fall through to a full remeasure for those blocks.
A throwaway diagnostic navigating with `Control+End` (a genuine
end-of-document edit, where every earlier block's `absoluteStart` is
legitimately unchanged) confirmed the mechanism itself is real and
correctly gated: 4 `document.createRange()` calls per keystroke, matching
the design intent. So (a)'s cost is real only on the benchmark's current
(broken) navigation, not on the workload this patch targets — but the D13
gate measures the former, not the latter, and reports it that way. Option
(b) — shifting cached `sourceRange`s instead of falling back — is left
open for a future run once `drive.ts`'s navigation is fixed and the actual
end-of-document workload can be measured; it was not taken up this round
because it adds `sourceRange` arithmetic that is exactly the kind of
subtle-bug surface the `absoluteStart` fix was written to close, and doing
that safely deserves a run of its own. See `p3d-sweep-audit.md`'s "## Lane
E (P3f)" section, in particular its "Repair round 1 correction" box and
"Before/after — all four sizes (SFE-P3d-sweep+P3f repair round 1:
RE-MEASURED)" table, for the full measured record.

### Why the cheap read is never skipped

An earlier, UNSOUND experiment (discarded — see "Strategy chosen," above)
tried skipping the per-block `getBoundingClientRect()`/`getComputedStyle()`
reads too, relying on a "nothing shifted above me" arithmetic assumption
instead. That was rejected even though it measured the same speed: making
it SOUND would require reasoning about CSS margin collapsing and gap
behavior between blocks — real complexity this patch has no need to take
on, because the cheap reads were already shown NOT to be the bottleneck
(Lane D's own block-count-invariant differential, reconfirmed by this
patch's own experiments above). This patch always re-reads the block's own
position fresh from the DOM and only ever trusts a TRANSLATION of already-
correct cached geometry, never an assumption about what did not move.

### Why the `ResizeObserver` and scroll call sites are excluded

`_publishMeasurements` has three call sites in this class:
`_renderAutorun` (`~6346`, the one this patch marks `incremental`), a
`ResizeObserver` callback (`~5859`, fires when the editor's own container
box changes size), and a `scroll` listener (`~5866`, debounced via
`requestAnimationFrame`). Both of the latter two keep calling
`_publishMeasurements(u)`/`_publishMeasurements(l)` with a single argument
— `n` is `undefined` there, so `gpReusable` is `false` `n ? ... : void 0`
short-circuits `gpCache` to `void 0` — every block is fully remeasured on
those paths, byte-for-byte as before this patch. A container resize can
change every block's available width (text can rewrap — the ONE case this
patch's identity invariant does not cover, since AST/`showMarkup` identity
says nothing about container width) and is exactly the shape of change
`ResizeObserver` exists to catch; a `contain`/`content-visibility`-free
document scrolling is preserved as a full remeasure because this fork's own
author chose to remeasure on scroll (this patch does not know or need to
know why — see "Strategy chosen," above, on why that choice was left alone
rather than second-guessed) and neither path is on the D13 per-keystroke
path this patch targets.

### Hunk 8 — `gpTranslateVisualLineMap`, a new helper

**File:** `dist/index.js`, placed immediately after `mo()`'s existing
helper functions (`go`/`Rs`/`po`/`_o`/`mt`/`vo`), before `class wo`
(`MeasuredLayoutModel`) — co-located with the geometry primitives it
complements.

**Why:** a pure, standalone translation of a previously computed `Pe`
(visual-line map) by a fixed `(dx, dy)`, built entirely from EXISTING,
UNMODIFIED primitives: `C.prototype.translate` (already defined on the rect
class), and the `Pe`/`ot`/`me` constructors (already used this way, fresh
each time, by `mo()` itself — see "Why the translate is exact," above, for
the correctness argument).

Added (new function; no "before" — this is a pure addition):

```js
/**
 * gp-fork: measurement (SFE-P3f — the D13 fix). Translates a previously
 * computed Pe (a block's visual-line map, see mo() above) by a fixed
 * (dx, dy), using C's own unmodified translate(). Every line's rect and
 * every run's rect move by the same amount; sourceRange/source/
 * isVisualLineAnchor are carried over untouched. That is exact ONLY when
 * the caller has already proven the map's absoluteStart is byte-identical
 * to this block's CURRENT absoluteStart (see the __gpCache.absoluteStart
 * check at the one call site below) — sourceRange is an ABSOLUTE document
 * offset baked in by mo(), and this function has no way to shift it, so a
 * caller that invokes this after the block's absoluteStart changed (an
 * edit landed earlier in the document) would silently publish a stale
 * offset<->rect mapping. See PATCHES.md for why the call site's identity
 * check is sound and for the one call site that uses it.
 */
function gpTranslateVisualLineMap(n, e, t) {
  return e === 0 && t === 0 ? n : new Pe(n.lines.map((s) => new ot(
    s.rect.translate(e, t),
    s.runs.map((i) => new me(i.sourceRange, i.rect.translate(e, t), i.source, i.isVisualLineAnchor)),
    s.virtualCursorLine
  )));
}
```

`e === 0 && t === 0` short-circuits to the SAME `Pe` instance (no
allocation) for the common case of a block that has not shifted at all —
typing at the end of a document, or below the edit point but above nothing
that changed height. `virtualCursorLine` is carried through unchanged
(`mo()` never constructs an `ot.virtual(...)` line inside a per-block `Pe`
— that sentinel is built separately, only for the pending-paragraph path —
so it is always `undefined` here; preserving it generically costs nothing).

### Hunk 9 — `_publishMeasurements` gains an `incremental` parameter

**File:** `dist/index.js`, the `EditorView` class (`gl`),
`_publishMeasurements` method.

Before:

```js
  /**
   * Measure each mounted block's rect and per-block visual line map, then
   * publish the result into the {@link MeasuredLayoutModel}. The model
   * is not read here, so there is no feedback loop into the render autorun.
   */
  _publishMeasurements(e) {
    const t = this.coordinateSpace.capture(), s = [];
    for (const r of e.blocks) {
      const c = t.toLocalRect(r.node.element.getBoundingClientRect());
      r.node.recordMeasuredHeight(c.height);
      const a = r.node.scrollElement;
      let l;
      const d = getComputedStyle(a).overflowX;
      if ((d === "auto" || d === "scroll" || d === "hidden" || d === "clip") && a.scrollWidth > a.clientWidth + 1) {
        const m = t.toLocalRect(a.getBoundingClientRect()).left + a.clientLeft;
        l = { left: m, right: m + a.clientWidth };
      }
      const h = Pe.measure([{
        absoluteStart: r.absoluteStart,
        viewNode: r.node
      }], this.coordinateSpace, t);
      s.push({
        block: r.node.block,
        absoluteStart: r.absoluteStart,
        height: c.height,
        rect: c,
        viewportClip: l,
        isMeasured: !0,
        visualLineMap: h,
        viewNode: r.node
      });
    }
```

After:

```js
  /**
   * Measure each mounted block's rect and per-block visual line map, then
   * publish the result into the {@link MeasuredLayoutModel}. The model
   * is not read here, so there is no feedback loop into the render autorun.
   *
   * gp-fork: measurement (SFE-P3f — the D13 fix). `n` (new, optional):
   * true ONLY from the per-keystroke _renderAutorun call site below. The
   * two other call sites in this class — the ResizeObserver callback and
   * the scroll listener, both above in this constructor — keep calling
   * this with a single argument, so `n` is `undefined` there and every
   * block is always fully remeasured on those paths, byte-for-byte as
   * before this patch: a container resize or a scroll can move or rewrap
   * ANY block without touching a single view node's identity, so neither
   * path is safe to shortcut this way, and neither is on the D13 budget's
   * per-keystroke path this patch targets. See PATCHES.md for the full
   * consumer trace and why gating on `n` this way is sound.
   */
  _publishMeasurements(e, n) {
    const t = this.coordinateSpace.capture(), s = [];
    for (const r of e.blocks) {
      const c = t.toLocalRect(r.node.element.getBoundingClientRect());
      r.node.recordMeasuredHeight(c.height);
      const a = r.node.scrollElement;
      let l;
      const d = getComputedStyle(a).overflowX;
      if ((d === "auto" || d === "scroll" || d === "hidden" || d === "clip") && a.scrollWidth > a.clientWidth + 1) {
        const m = t.toLocalRect(a.getBoundingClientRect()).left + a.clientLeft;
        l = { left: m, right: m + a.clientWidth };
      }
      /* gp-fork: measurement — r.node is the exact same object as the
       * entry this loop measured last render at this position iff Y()
       * (the view-node factory) reused it by identity, which happens only
       * when nothing in its ast/showMarkup/active-state subtree differs —
       * i.e. only when its rendered DOM, and therefore its INTERNAL
       * geometry (line wraps, run positions relative to the block's own
       * top-left), is provably unchanged since __gpCache below was
       * recorded (see PATCHES.md's consumer-map rationale). That identity
       * says nothing about the block's ABSOLUTE source offsets, which are
       * baked into every cached run via `sourceRange` (see mo()/gpTranslate
       * VisualLineMap above) and shift whenever an edit lands earlier in
       * the document without touching this block's own DOM at all. So the
       * cache is reusable only when BOTH hold: (1) className is unchanged
       * — a cheap, generic guard against any block-level presentation
       * state this reasoning did not otherwise anticipate — and (2) this
       * block's absoluteStart is byte-identical to the absoluteStart the
       * cache was recorded under, which is the ONLY thing that proves no
       * edit shifted this block since. When (2) fails, the cached
       * sourceRanges are stale by the shift amount and MUST NOT be reused
       * even via translation — translating rect geometry does not, and
       * cannot, correct a stale sourceRange, so this falls through to a
       * full Pe.measure() instead. When both hold, the expensive
       * per-text-leaf walk (Pe.measure() -> mo(): one DOM Range +
       * getClientRects() per text leaf) is skipped and replaced by
       * translating the cached map's RECT geometry only by this block's
       * freshly (and cheaply) remeasured position delta — exact, not
       * approximate, under that same identity invariant, since translate()
       * only ever moves rects by the block's OWN observed shift and never
       * touches sourceRange, which is guaranteed unchanged by (2). */
      const gpCache = n ? r.node.__gpCache : void 0, gpReusable = gpCache !== void 0 && gpCache.className === r.node.element.className && gpCache.absoluteStart === r.absoluteStart;
      const h = gpReusable
        ? gpTranslateVisualLineMap(gpCache.visualLineMap, c.x - gpCache.rect.x, c.y - gpCache.rect.y)
        : Pe.measure([{
          absoluteStart: r.absoluteStart,
          viewNode: r.node
        }], this.coordinateSpace, t);
      r.node.__gpCache = { rect: c, visualLineMap: h, className: r.node.element.className, absoluteStart: r.absoluteStart };
      s.push({
        block: r.node.block,
        absoluteStart: r.absoluteStart,
        height: c.height,
        rect: c,
        viewportClip: l,
        isMeasured: !0,
        visualLineMap: h,
        viewNode: r.node
      });
    }
```

Design notes:

- **`__gpCache`.** A plain own-property stashed directly on the block's
  `ViewNode` instance (`T` and its subclasses use ordinary, unfrozen
  instance fields throughout — confirmed by inspection, no
  `Object.freeze`/`Object.seal` anywhere in this file). No separate
  `Map`/`WeakMap` is needed: since `r.node` is only ever the SAME object
  across renders when `Y()` genuinely reused it, the cache and its
  eligibility check share one identity by construction, and a discarded
  node's cache is reclaimed with it — no cleanup pass required, no
  unbounded growth. **Carries `absoluteStart` (repair round 1)** alongside
  `rect`/`visualLineMap`/`className`, specifically so `gpReusable` can
  compare it against the block's CURRENT `r.absoluteStart` — the field an
  earlier version of this patch omitted, letting a block's cache be reused
  by DOM identity alone even after its absolute position in the source had
  shifted (see "Why the translate is exact, not approximate," above).
- **Always writes `__gpCache`, on every path.** Whether a block was
  reused (translated) or fully remeasured, the fresh, verified-correct
  result is stashed for next time — including on the FULL-remeasure
  `ResizeObserver`/scroll paths, so a resize or scroll leaves the cache
  maximally fresh for the very next keystroke, rather than only ever
  updating it from the incremental path.
- **`recordMeasuredHeight`/`viewportClip` are computed exactly as before,
  unconditionally, for every block.** This patch does not attempt to skip
  these — Lane D's own block-count-invariant differential, reconfirmed by
  this patch's own experiments (see "Strategy chosen," above), already
  showed these are not the cost; only the per-text-leaf walk is.

### Hunk 10 — the `_renderAutorun` call site

**File:** `dist/index.js`, `EditorView._renderAutorun`, the final line.

Before:

```js
    this._document.set(p, void 0), this._publishMeasurements(p), l ? this._paintDiff(p, l.insertedRanges) : this._clearDiff();
```

After:

```js
    this._document.set(p, void 0), this._publishMeasurements(p, !0), l ? this._paintDiff(p, l.insertedRanges) : this._clearDiff();
```

The ONLY call site that opts into the incremental path — see Hunk 9's
design notes and "Why the `ResizeObserver` and scroll call sites are
excluded," above, for why the other two call sites are deliberately
untouched.

### What Patch 2 did NOT do

- Did not touch the `ResizeObserver` callback or the scroll listener's own
  call to `_publishMeasurements` — both keep calling it with one argument,
  so both remain byte-for-byte full remeasures.
- Did not attempt viewport-scoped measurement (candidate strategy 2) —
  measured, and rejected, as not reaching the budget either, for a
  documented reason (see "Strategy chosen," above), consistent with "pick
  the smallest that empirically lands the budget; do not build both."
- Did not skip, cache, or otherwise change `recordMeasuredHeight`'s
  per-block call, `viewportClip`'s computation, `e.pendingParagraph`'s
  handling, or `MeasuredLayoutModel.setMeasurements`'s transactional
  update — all untouched, all still run on every block, every render.
- Did not add any escape hatch, option, or public API surface — `n` is an
  internal parameter of a private (`_`-prefixed) method, not exposed via
  `BlockViewOptions`/`EditorViewOptions` or any other public contract in
  `dist/index.d.ts` (this patch touches only `dist/index.js`).
- Did not attempt to locate or patch the SEPARATE, larger remaining cost
  this patch's own investigation surfaced (the `EditContext`
  `textupdate`-driven latency between `keydown` and `_renderAutorun`
  starting) — out of SFE-P3f.md's scope (which names the measurement pass
  specifically), plausibly not fixable by any JS-level patch at all (see
  "Strategy chosen," above), and squarely in the input/IME-handling
  territory where "Correctness outranks the budget" applies most strongly.
  Reported, not patched — see this run's `p3d-sweep-audit.md` "## Lane E
  (P3f)" section and the upstream-issue companion document.

### Patch 2 upstreaming / removal trigger

Delete this patch, and let `_publishMeasurements` remeasure every block
unconditionally again, when EITHER:

1. Upstream ships an equivalent incremental-measurement optimization inside
   `_publishMeasurements`/`_renderAutorun` itself (matching or subsuming
   this patch's behavior), or
2. This exact optimization — skip re-walking a block's visual-line geometry
   when its view node was reused by identity, translating cached geometry
   by the block's observed position delta instead — is upstreamed as an
   accepted PR against `microsoft/vscode-packages` (directory
   `vscode-team-tools/packages/markdown-editor`).

Per CLAUDE.md's design-for-deletion rule, an upstream fix is the preferred
end state here too; this patch changes nothing about `_publishMeasurements`'s
OBSERVABLE output (see "Consumer map," above) so its removal, once upstream
subsumes it, is a pure performance no-op for every consumer. (This claim
holds for the patch AS SHIPPED, `absoluteStart`-checked — see "Why the
translate is exact, not approximate," above, for the repair round that made
it true.)

## Patch 3 — `groupBlocks` (container mounting for Gutterpress scopes)

Marked `/* gp-fork: groupBlocks */`. Touches `dist/index.js` (Hunks 11-12)
and `dist/index.d.ts` (Hunk 13). Additive; every existing line is
unchanged.

**Why.** Gutterpress markers (`@section … @end-section`, `@page`, `@spread`,
`@chapter`) are SCOPES: the print pipeline renders them as a `div.section`
/ `div.page` / … wrapping the blocks between the markers, and a book's own
stylesheet targets that wrapper (`.section.lede`, `.page.cover-page`,
`.gp-columns-2`). The upstream editor's document is a flat list of
top-level block views mounted directly under `.md-document`, so with
Patch 1 alone the editor could show the marker LINE (as a custom block) but
never the scope: nothing in the DOM carried the wrapper the CSS needs, so
the editor could not render a Gutterpress book the way the book renders.

**What.** `BlockViewOptions.groupBlocks` is consulted once per document
render (in the document view's `create`) with every top-level block — its
AST node, exact source text (the same `Es(ast)` text `renderCustomBlock`
receives) and absolute start offset. It returns container specs: runs of
consecutive blocks (`start` inclusive / `end` exclusive, indices into that
list) plus the wrapper's tag, class and attributes, and a `key` the wrapper
element is reused by across renders. `gpMountGroups` (Hunk 12) builds the
mount-node list with those runs nested inside their wrappers and hands it
to the SAME child reconciler (`Q`) the upstream code already used for the
flat list; the block views themselves, the `blocks` layout list, and every
measurement/caret path that reads a block's `element` are untouched — only
a mounted block's DOM PARENT changes. Specs must nest properly; one that
does not fit inside the range being built is skipped, never guessed.

### Hunk 11 — `sn.create` (the document view) mounts through `gpMountGroups`

Replaces the single `Q(i, u.map((f) => f.mountNode))` call with the
grouped mount when `groupBlocks` is set (and the flat mount, byte-identical
in effect, when it is not or returns nothing), and carries the wrapper map
on the view instance (`_gpWrappers`) so the next render reuses wrappers.

### Hunk 12 — `gpMountGroups`, a new helper

Defined immediately after `class sn`. Pure DOM/list work: converts specs to
`u`-index ranges, sorts outer-first, and recursively builds the mount list.

### Hunk 13 — `BlockViewOptions.groupBlocks`, `BlockGroupCandidate`, `BlockGroupSpec` (index.d.ts)

The option, documented next to `renderCustomBlock`, and the two plain-data
interfaces it uses, declared before `CustomBlockRendering`.

### Patch 3 upstreaming / removal trigger

Delete this patch when upstream offers a way to mount runs of blocks inside
a host-owned container (a container/grouping hook, or a block kind whose
children are top-level blocks) — `packages/editor`'s provider then returns
its specs through that surface instead.

## Patch 4 — `decorateInactiveBlock` (source-derived presentation on inactive blocks)

Marked `/* gp-fork: decorateInactiveBlock */`. Touches `dist/index.js`
(Hunk 14, inside `sn.create`'s per-block map, right after the
active/markers-hidden class toggles) and `dist/index.d.ts` (Hunk 15, the
option next to `groupBlocks`). Additive.

**Why.** Gutterpress books use markdown-it-attrs: `# Title {#ch-1 .x}`
gives the heading an id and a class the book's CSS targets. The editor's
own parser has no attrs syntax, so it rendered the trailer as heading text
and the CSS never matched. The hook lets the host apply those attributes to
the rendered element and hide the trailer while the block is inactive; an
active block still shows its source verbatim, as the fork always did.

**What.** After a top-level block view is built and its active/inactive
classes are set, if the block is inactive AND the view is new (not reused
by identity), `options.decorateInactiveBlock(element, ast, sourceText,
absoluteStart)` is called once. `absoluteStart` is the block's offset in
the document (the same value Patch 3's group candidates carry): the host
matches a block to the pipeline's record of it by its text, and two blocks
with the same text (a skill card's heading repeated for its continuation)
are told apart only by where they are. A reused view was decorated when it was built; a block that
becomes active is rebuilt (fresh view data), and rebuilt again when it goes
inactive, so decoration always follows a complete default rendering.

### Patch 4 upstreaming / removal trigger

Delete when upstream renders markdown-it-attrs trailers itself, or offers a
post-render hook per block.

## Patch 5 — `afterDocumentMount` (host re-layout before measurement)

Marked `/* gp-fork: afterDocumentMount */`. One call added in `sn.create`
immediately after the document's children are mounted (Hunk 16,
`dist/index.js`) and the option declared next to `decorateInactiveBlock`
(Hunk 17, `dist/index.d.ts`). Additive.

**Why.** Gutterpress paginates the editor's document on screen with the
same multicol fragmenter the preview uses: it moves runs of blocks into
column strips and draws page sheets around them. That has to happen after
the editor has mounted its blocks and BEFORE it measures them, or the
caret/selection geometry is computed against the unpaginated layout and
drawn in the wrong place.

**What.** `options.afterDocumentMount(documentElement)` runs synchronously
inside the render, after `Q(...)` mounted the blocks and before the render
autorun continues to measurement. The host must leave every block view's
element in the document (moving it is fine).

### Patch 5 upstreaming / removal trigger

Delete when upstream exposes a post-mount/pre-measure hook.

## Patch 6 — `renderCustomBlock` for every top-level block kind

Patch 1 wired the `renderCustomBlock` seam into two arms of the view-factory
switch: `paragraph` and `unhandledBlock`. Every other block kind — a
heading, a block quote, a list, a table — constructed its upstream view
unconditionally, so a host holding the pipeline's own rendering for one of
those blocks had no way to show it. That is not a hypothetical: a project
plugin that rewrites a block quote into a pull-quote, or an ordered list
into cost-badged rows, produces a page whose blocks the editor could match
by source range and still not render.

Four hunks, one per arm, all identical in shape to Hunk 3's paragraph arm
(same `Es(n.ast)` source text, same host-applies-`md-block` mirror, same
`Zs(...)`/`D` segment handling, same fall-through to the unchanged upstream
construction when the host returns `undefined`). Marked
`/* gp-fork: renderCustomBlock */` like the arms Patch 1 added.

### Hunk 14 — the `heading` arm
### Hunk 15 — the `blockQuote` arm
### Hunk 16 — the `list` arm
### Hunk 17 — the `table` arm

Each replaces

```js
    case "<kind>":
      return new <Ctor>(n, e, N(t, <Ctor>));
```

with the same arm preceded by the seam consult.

**No `!showMarkup` gate, and why that is not a weakening.** Hunk 3's
paragraph arm consults the hook only while the block is inactive, which
Hunks 1-2 made possible by threading the already-computed active/inactive
bit onto `ParagraphViewData`. `HeadingViewData`, `BlockQuoteViewData`,
`ListViewData` and `TableViewData` do not carry that bit either, and
threading it onto four more classes would be a far larger patch than this
seam needs — it would touch each class's fields, constructor and
construction site, for a bit only Gutterpress reads.

The decision moves to the HOST instead, which is the only side that knows
whether its rendering may stand in for the editable block.
`packages/editor/src/gutterpress/provider.ts` returns `undefined` for these
four kinds unless the surface is LOCKED, where nothing ever becomes active
and a substituted rendering therefore cannot swallow a block the author is
trying to edit. Unlocked, these arms behave exactly as they did before this
patch.

**Removal trigger.** Same as Patch 1's: this whole file goes when upstream
ships an equivalent generic block-render hook. If upstream ships one for
paragraphs only, this patch stays until it covers every block kind.

