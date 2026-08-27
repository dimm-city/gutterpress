# PATCHES.md — the `renderCustomBlock` seam

This fork applies exactly one feature patch — the `renderCustomBlock` seam
specified by `docs/plans/source-first-editor/runs/SFE-P1b.md` and ratified in
`SFE-P1b-decision.md` — on top of the unmodified, published
`@vscode/markdown-editor@0.0.2-84` artifact. Every hunk below is additive
(no reformatting, no renaming, no unrelated edits) and marked in the source
with `/* gp-fork: renderCustomBlock */`. Only two files are touched:
`dist/index.js` and `dist/index.d.ts`. `scripts/verify-vendored.mjs` proves
these are the only files that differ from the published tarball, and proves
their current content matches exactly the post-patch hashes recorded below
(no drift since this document was written).

All line numbers below are from the patched `dist/index.js` /
`dist/index.d.ts` in THIS package. The run specification's "Recorded facts"
cited unpatched-baseline line numbers (`3795-3810`, `4290`, `4438-4446`,
`4474`/`4580`) from a prior lane's exploration of the same 0.0.2-84 build —
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
        if (gpR)
          return new T(n, gpR.dom, gpR.segments ? Zs(n.ast, gpR.segments, n.ast.length) : D);
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
- **Plain-`dom` wrapping.** `new T(n, gpR.dom, D)` — `T` is the SAME base
  view-node class every block/inline view (including `CodeBlockViewNode`,
  minified `tn`) already extends; its constructor is exactly `(viewData,
  domElement, childrenArray)` and is what registers `dom` in the
  DOM→ViewNode lookup tables (`pn`/`pt`) that selection/hit-testing/click
  handling walk. This IS "the same wrapper machinery the existing
  renderCustomCodeBlock path uses for the plain-dom, no-segments case":
  `tn`'s own constructor does the equivalent thing internally when its
  custom-code-block branch fires (`m = d; g = D; ...; super(e, m, g)` — `D`
  is the same shared empty-array constant used here). No new view-node
  class was created.
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
        if (gpR)
          return new T(n, gpR.dom, gpR.segments ? Zs(n.ast, gpR.segments, n.ast.length) : D);
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
    /** Host element to mount (the rendered block output). */
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

## Upstreaming / removal trigger

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
that day's diff is trivial.
