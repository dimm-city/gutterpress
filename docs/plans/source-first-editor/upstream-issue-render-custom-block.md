# Upstream issue draft - `renderCustomBlock` seam

> **Status:** ready to file at <https://github.com/microsoft/vscode-packages/issues>.
> Filing is a product-owner action, not an agent action: it is an external
> write under a human identity to a repository this workspace cannot verify.
> An issue is a precondition to condition 2 of Patch 1's and Patch 6's
> removal trigger (an accepted PR), not condition 2 itself - see
> `packages/vscode-markdown-editor/PATCHES.md`, "Patch 1 upstreaming /
> removal trigger" and Patch 6's "Removal trigger". Once an issue URL
> exists, add a `Tracking:` line under both triggers and in package.json's
> `gutterpressFork.removalTrigger`.
>
> **Refreshed 2026-09-28** to the shipped seam (Patches 1 and 6: six block
> kinds, not two) and to upstream `0.0.2-111` (gitHead
> `3fd578f652b8ccb5ba000ea25c28c920b8925b95`, published 2026-09-28), whose
> view-factory arms for these kinds are structurally identical to the
> build the seam was first written against (the -84 prerelease). Owner pre-filing
> steps: a duplicate search of the upstream tracker, and confirming the
> repository is reachable from the filing account.
>
> Everything below the rule is the issue body verbatim; the title is above it.
> It is written for upstream maintainers: no Gutterpress-internal plan
> vocabulary, no run IDs, no references to our private docs.

**Title:** `[markdown-editor] Feature request: a generic custom-block render hook on BlockViewOptions (renderCustomBlock)`

---

## Summary

`@vscode/markdown-editor` exposes two hooks for replacing a block's *inactive*
(rendered) presentation - `BlockViewOptions.renderCustomCodeBlock` and
`BlockViewOptions.renderMath` (`dist/index.d.ts` lines 219 and 253 in
`0.0.2-111`) - but both are keyed to specific AST kinds. There is no way for a
host to supply custom inactive rendering for a **paragraph**, an **unhandled
block**, a **heading**, a **block quote**, a **list** or a **table**, which is
where every custom Markdown dialect construct that isn't a fenced code block
ends up.

I'd like to propose a third, generic hook on the same interface:

```ts
readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
```

We've implemented exactly this against the published bundle (first against
the -84 prerelease, carried unchanged to `0.0.2-87`, and re-checked by reading
against `0.0.2-111`, where the six view-factory arms are structurally identical) and
have been running it in a real product; I'm happy to submit it as a PR if the
shape is agreeable.

## Motivation

We're building a source-first Markdown editor for a print/publishing tool whose
dialect adds **paragraph-shaped block markers** - a line like:

```markdown
@page splash
```

means "start a new page named splash". Similar shapes are common: admonition
markers, directive syntax, front-matter-adjacent metadata lines, custom
container openers, or any construct a `markdown-it`-style pipeline recognises
via a core rule rather than a fence.

In the editor we want that line to render, while inactive, as a compact styled
chip ("Page - splash"), and to reveal its exact source when the caret enters -
precisely the two-state behaviour `renderCustomCodeBlock` already gives fenced
blocks. The editor's design (source stays authoritative, the view is a
projection) fits the package's model exactly; the only missing piece is the
hook.

The need is not limited to paragraphs. The same pipeline lets a project
plugin rewrite a block quote into a pull-quote, or an ordered list into
badged rows; a host holding the pipeline's own rendering for such a block can
match it by source range and still has no way to show it in the editor, so
the hook has to reach the heading, block quote, list and table arms too.

## Why the existing seams don't cover it

We checked each candidate against the published bundle by instrumenting it in
a real browser, rather than reading the `.d.ts` alone (line numbers are from
`0.0.2-111`'s `dist/index.js`):

| Seam | Why it doesn't apply |
|---|---|
| `renderCustomCodeBlock` | Its call site (line 4849) is gated on the node's `language` **and** `closeFence` - properties that exist only on `CodeBlockAstNode`. Structurally unreachable for any other block kind. |
| `renderMath` | Same story, keyed to the math-block / inline-math kinds (call sites at 5033 and 5139). |
| Paragraph rendering | The view-node factory's `"paragraph"` arm (line 4292) constructs its view with a hardcoded tag and class string (`"md-block md-paragraph"`) and consults no option. |
| `unhandledBlock` rendering | Two hardcoded view classes chosen by content shape (HTML-comment vs. everything else, line 4304); the options object is threaded only to children. |
| `heading`, `blockQuote`, `list`, `table` | Each arm constructs its upstream view unconditionally (`new <Ctor>(n, e, R(t, <Ctor>))`), no option consulted. |
| Parser extension | `MarkdownParser`'s only public surface is `parse(text, previous?, edit?)`; `EditorModel` constructs it internally with no injection point, so a marker line always tokenises as a paragraph. |
| Overlays (`overlayContainer`, `rangeRects`) | Additive by design - as `CommentModeController`'s own doc comment says, layered on top "without modifying it". An overlay can't take the block's place in text flow. |

The only workaround available today is to require authors to wrap custom
constructs in a fenced code block with a sentinel info string so
`renderCustomCodeBlock` becomes reachable. That changes the *authoring syntax*
to satisfy a rendering constraint, which isn't something we can ask of authors.

## Proposed API

Deliberately modelled on the package's own existing pattern -
`CustomBlockRendering` / `SourceSegment` are a rename of your
`MathRendering` / `MathSourceSegment` to non-math-specific names, not a new
shape:

```ts
interface BlockViewOptions {
  // ... existing members unchanged ...

  /**
   * Pluggable renderer for the *inactive* (rendered) form of a top-level
   * block the two existing seams do not cover: "paragraph", "unhandledBlock",
   * "heading", "blockQuote", "list" and "table". Returning `undefined` falls
   * back to the default rendering, unchanged. For a paragraph or unhandled
   * block it is never consulted while the block is active (source shown);
   * for the other four kinds see "Active-state gating" below.
   */
  readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
}

interface CustomBlockRendering {
  /** Host element to mount. The host adds the `md-block` class itself. */
  readonly dom: HTMLElement;
  /** Optional source-mapped spans within `dom`, relative to the node's start. */
  readonly segments?: readonly SourceSegment[];
}

interface SourceSegment {
  readonly dom: Node;
  readonly start: number;
  readonly length: number;
}
```

Semantics we implemented, each mirroring an existing decision in the codebase:

- **Gated on inactive only, where the view data carries the bit** - for
  `paragraph` and `unhandledBlock` the consult is under `!showMarkup`, the
  same gate the `renderCustomCodeBlock` call site uses. Active blocks fall
  through to the unchanged source rendering, so the two-state transition
  comes for free.
- **`undefined` falls through** to the existing hardcoded construction, so
  behaviour is byte-identical for every current caller.
- **The host applies `md-block`**, matching what the custom-code-block call
  site already does for its own plain-`dom` result
  (`classList.add("md-block", "md-code-block")`).
- **`segments` reuse the existing tiling helper** unmodified - the same one
  both `renderMath` call sites pass their segments to. With segments supplied,
  caret entry lands at the correct interior offset and pointer-drag selection
  maps exactly; without them, the whole element mounts opaquely and entry lands
  at the block boundary.

### Active-state gating for the four kinds without `showMarkup`

`HeadingViewData`, `BlockQuoteViewData`, `ListViewData` and `TableViewData`
do not carry the active/inactive bit (`showMarkup`) the way
`CodeBlockViewData`, `MathBlockViewData`, `FrontMatterViewData` and
`UnhandledBlockViewData` do. In our bundle patch we did not thread it onto
four more classes - that would touch each class's fields, constructor and
construction site for a bit only the hook reads - so for those four arms the
hook is consulted on every build and the **host** decides whether its
rendering may stand in for the block: ours returns `undefined` for them
unless the surface is read-only, where nothing ever becomes active and a
substituted rendering cannot swallow a block the author is trying to edit.

In a source-tree PR the right shape is probably the opposite: thread
`showMarkup` onto those four `ViewData` classes (cheap in source, one
constructor parameter each, exactly as `ParagraphViewData` needs it below)
so the hook is uniformly "inactive only" for every kind and the host needs
no gating of its own. We'd build to whichever you prefer.

## Implementation notes

<details>
<summary>Touch points, one of which is a non-obvious prerequisite</summary>

The view-factory arms plus type declarations are mechanical. One
prerequisite is worth flagging because it surprised us:

**`ParagraphViewData` does not carry `showMarkup`.** Unlike
`CodeBlockViewData`, `MathBlockViewData`, `FrontMatterViewData` and
`UnhandledBlockViewData` - which all use an `(ast, showMarkup, content)`
constructor - a paragraph's `ViewData` stores only `(ast, content)`. That makes
sense historically: a plain paragraph has no *block-level* active/inactive
rendering to switch between; only its inline marks independently reveal their
own markers near the caret. The bit **is** computed during the `ViewData` build
(the per-top-level-block active/inactive context split), it's just dropped
before view construction for paragraphs specifically.

Gating the new hook on `!showMarkup` therefore needs that already-computed bit
threaded onto `ParagraphViewData`, mirroring the identical shape its four
sibling classes already use. It's one new constructor parameter and one call
site - `ParagraphViewData` has exactly one construction site in the bundle.
`UnhandledBlockViewData` already carries the flag, so that arm needs no
prerequisite.

**For `sourceText`** we reused the package's own node-to-source-text helper
(the one used for list-item checkbox-marker detection). It's provably exact
here: `AstNode.length` is the memoised sum of children's lengths and every
leaf's length is its `content.length`, so the reconstructed string's length
always equals the node's full source span - matching the offset convention
`MathRenderRequest.nodeLength` / `MathSourceSegment.start` already use.
None of the six kinds has a fence-like prefix to strip, so segment offsets
need no adjustment and the signature needs no `contentStart` parameter.

**For the unhandled-block arm** we intercept *before* the HTML-comment vs.
generic view choice, so a provider gets first refusal on every unhandled block
regardless of sub-kind; both branches receive the same `ViewData` shape, and
`undefined` falls through to the unchanged choice.

**For the heading, block quote, list and table arms** the consult is the
same three lines as the paragraph arm's, placed before the unchanged
`return new <Ctor>(...)`.

</details>

The change is additive throughout: no existing declaration reformatted,
renamed or reordered; no new view-node class (the generic base `ViewNode` and
the existing tiling helper were already sufficient); no engine-private
extension points.

## What we validated

Against the exact published runtime in headless Chromium, driven with real
keyboard and pointer input (the suite was written against the -84
prerelease; the patched files are byte-identical from there through
`0.0.2-87`, our current pin, and the suite runs green there; against `0.0.2-111` we have so
far only confirmed by reading that the six arms and the two existing hooks'
call sites are unchanged):

- The hook fires for paragraph and unhandled-block probes while inactive, with
  the correct AST node and byte-exact `sourceText`; it is **not** consulted for
  code blocks or for the active paragraph.
- Returning `undefined` produces DOM identical to an unpatched mount.
- Caret entry activates the block and shows real source; edits inside land at
  byte-exact offsets; leaving restores the custom rendering with zero source
  drift.
- With per-character `segments`, caret entry lands **inside** the custom
  content at the exact predicted offset (cross-checked independently via
  `VisualLineMap.offsetAtPoint`), and pointer-drag selects the exact expected
  interior range.
- Full-document and stepped `Shift+Arrow` selections cross a custom-rendered
  block with exact source mapping.
- Every pre-existing behaviour we depend on (exact source edits, external
  document replacement, host-owned undo, clipboard, IME/`EditContext` input,
  accessibility, isolated mounting and CSS scoping, disposal/remount) passes
  identically with and without the patch applied.
- A sweep that mounts 28 real book chapters (185 KB of Markdown, every kind
  above represented), opens and closes one custom-rendered block in each,
  and reads the source back byte-for-byte.

## Related seams we also carry (follow-ups, not this ask)

So that a paragraph-only hook is not mistaken for the whole of what a
custom-dialect host needs, here are the other generic seams our fork adds,
each additive and each a candidate for its own issue once this one has a
shape. None of them is required for `renderCustomBlock` to be useful on its
own:

- **`groupBlocks`** - mount runs of top-level blocks inside a host-owned
  container element (our dialect has section/page scopes that wrap blocks;
  the page's CSS addresses the wrapper), with a spec for which block "opens"
  a group so that a marker block can mount after its wrapper rather than
  between the wrapper and the block above it.
- **`decorateInactiveBlock`** - a per-block post-render hook (element, AST,
  source text, absolute offset) for source-derived presentation such as
  `markdown-it-attrs` trailers.
- **`afterDocumentMount`** - a synchronous hook after the document's
  children are mounted and before they are measured, so a host can lay the
  document out (we paginate it into page-sized column strips) before
  caret/selection geometry is computed.
- **A render epoch** (`gpRerender()`) - retire every block view and rebuild
  it through the hooks above without replacing the model, so the selection
  and the controller's edit history survive when the host's own rendering
  input changes asynchronously.
- **Point-in-block hit testing** - `resolveOffsetFromPoint` resolving the
  point among the lines of the block under the pointer (with the platform
  hit-test for a table cell) instead of by `y` alone, so a multi-column
  layout's second column takes its own clicks.

## Offer

We're carrying this as a small internal fork of the published artifact, which
we'd much rather delete. Two caveats on our end, stated plainly:

1. Our patch is against the **published bundle**, because we couldn't access
   the source tree at the time. A PR would obviously need to be written against
   `vscode-team-tools/packages/markdown-editor` source - happy to do that work.
2. We kept the seam deliberately generic and free of any dialect-specific
   vocabulary, precisely so it could be upstreamed as-is.

If the shape looks right, I'll open a PR. If you'd prefer a different signature
(e.g. a kind filter, a single unified `renderCustomView` that subsumes the code
and math hooks, or a per-kind options map), we'd happily build to whatever you
consider the right long-term surface - a generic seam of *any* shape solves
this for us.

**Environment:** `@vscode/markdown-editor@0.0.2-111` (dist-tag `next`, gitHead
`3fd578f`; our pin is `0.0.2-87`, whose relevant files are byte-identical),
Chromium 141, TypeScript 5.9.
