# Upstream issue draft — `renderCustomBlock` seam

> **Status:** ready to file at <https://github.com/microsoft/vscode-packages/issues>.
> Not yet submitted. Filing this (or the PR it offers) is condition 2 of this
> fork's removal trigger — see `packages/vscode-markdown-editor/PATCHES.md`,
> "Upstreaming / removal trigger".
>
> Everything below the rule is the issue body verbatim; the title is above it.
> It is written for upstream maintainers: no Gutterpress-internal plan
> vocabulary, no run IDs, no references to our private docs.

**Title:** `[markdown-editor] Feature request: a generic custom-block render hook for paragraph / unhandled blocks (`renderCustomBlock`)`

---

## Summary

`@vscode/markdown-editor` exposes two hooks for replacing a block's *inactive*
(rendered) presentation — `BlockViewOptions.renderCustomCodeBlock` and
`BlockViewOptions.renderMath` — but both are keyed to specific AST kinds. There
is currently no way for a host to supply custom inactive rendering for a
**paragraph** or an **unhandled block**, which is where every custom Markdown
dialect construct that isn't a fenced code block ends up.

I'd like to propose a third, generic hook on the same interface:

```ts
readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
```

We've implemented exactly this against `0.0.2-84` and have been running it in a
real product; I'm happy to submit it as a PR if the shape is agreeable.

## Motivation

We're building a source-first Markdown editor for a print/publishing tool whose
dialect adds **paragraph-shaped block markers** — a line like:

```markdown
@page splash
```

means "start a new page named splash". Similar shapes are common: admonition
markers, directive syntax, front-matter-adjacent metadata lines, custom
container openers, or any construct a `markdown-it`-style pipeline recognises
via a core rule rather than a fence.

In the editor we want that line to render, while inactive, as a compact styled
chip ("Page — splash"), and to reveal its exact source when the caret enters —
precisely the two-state behaviour `renderCustomCodeBlock` already gives fenced
blocks. The editor's design (source stays authoritative, the view is a
projection) fits the package's model exactly; the only missing piece is the
hook.

## Why the existing seams don't cover it

We checked each candidate against the published `0.0.2-84` bundle by
instrumenting it in a real browser, rather than reading the `.d.ts` alone:

| Seam | Why it doesn't apply |
|---|---|
| `renderCustomCodeBlock` | Its call site is gated on the node's `language` **and** `closeFence` — properties that exist only on `CodeBlockAstNode`. Structurally unreachable for a paragraph or unhandled block. |
| `renderMath` | Same story, keyed to the math-block / inline-math kinds. |
| Paragraph rendering | The view-node factory's `"paragraph"` arm constructs its view with a hardcoded tag and class string and consults no option. |
| `unhandledBlock` rendering | Two hardcoded view classes chosen by content shape (HTML-comment vs. everything else); the options object is threaded only to children. |
| Parser extension | `MarkdownParser`'s only public surface is `parse(text, previous?, edit?)`; `EditorModel` constructs it internally with no injection point, so a marker line always tokenises as a paragraph. |
| Overlays (`overlayContainer`, `rangeRects`) | Additive by design — as `CommentModeController`'s own doc comment says, layered on top "without modifying it". An overlay can't take the block's place in text flow. |

The only workaround available today is to require authors to wrap custom
constructs in a fenced code block with a sentinel info string so
`renderCustomCodeBlock` becomes reachable. That changes the *authoring syntax*
to satisfy a rendering constraint, which isn't something we can ask of authors.

## Proposed API

Deliberately modelled on the package's own existing pattern —
`CustomBlockRendering` / `SourceSegment` are a rename of your
`MathRendering` / `MathSourceSegment` to non-math-specific names, not a new
shape:

```ts
interface BlockViewOptions {
  // ... existing members unchanged ...

  /**
   * Pluggable renderer for the *inactive* (rendered) form of a "paragraph" or
   * "unhandledBlock" node — parallel to renderCustomCodeBlock and renderMath,
   * but for blocks those two seams do not cover. Returning `undefined` falls
   * back to the default rendering, unchanged. Never consulted while the block
   * is active (source shown).
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

- **Gated on inactive only** — `!showMarkup`, the same gate the
  `renderCustomCodeBlock` call site uses. Active blocks fall through to the
  unchanged source rendering, so the two-state transition comes for free.
- **`undefined` falls through** to the existing hardcoded construction, so
  behaviour is byte-identical for every current caller.
- **The host applies `md-block`**, matching what the custom-code-block call
  site already does for its own plain-`dom` result
  (`classList.add("md-block", "md-code-block")`).
- **`segments` reuse the existing tiling helper** unmodified — the same one
  both `renderMath` call sites pass their segments to. With segments supplied,
  caret entry lands at the correct interior offset and pointer-drag selection
  maps exactly; without them, the whole element mounts opaquely and entry lands
  at the block boundary.

## Implementation notes

<details>
<summary>Four runtime touch points, one of which is a non-obvious prerequisite</summary>

Three of the four are mechanical — the two view-factory arms plus type
declarations. The fourth is worth flagging because it surprised us:

**`ParagraphViewData` does not carry `showMarkup`.** Unlike
`CodeBlockViewData`, `MathBlockViewData`, `FrontMatterViewData` and
`UnhandledBlockViewData` — which all use an `(ast, showMarkup, content)`
constructor — a paragraph's `ViewData` stores only `(ast, content)`. That makes
sense historically: a plain paragraph has no *block-level* active/inactive
rendering to switch between; only its inline marks independently reveal their
own markers near the caret. The bit **is** computed during the `ViewData` build
(the per-top-level-block active/inactive context split), it's just dropped
before view construction for paragraphs specifically.

Gating the new hook on `!showMarkup` therefore needs that already-computed bit
threaded onto `ParagraphViewData`, mirroring the identical shape its four
sibling classes already use. It's one new constructor parameter and one call
site — `ParagraphViewData` has exactly one construction site in the bundle.
`UnhandledBlockViewData` already carries the flag, so that arm needs no
prerequisite.

**For `sourceText`** we reused the package's own node→source-text helper (the
one used for list-item checkbox-marker detection). It's provably exact here:
`AstNode.length` is the memoised sum of children's lengths and every leaf's
length is its `content.length`, so the reconstructed string's length always
equals the node's full source span — matching the offset convention
`MathRenderRequest.nodeLength` / `MathSourceSegment.start` already use.
Paragraphs and unhandled blocks have no fence-like prefix to strip, so segment
offsets need no adjustment and the signature needs no `contentStart` parameter.

**For the unhandled-block arm** we intercept *before* the HTML-comment vs.
generic view choice, so a provider gets first refusal on every unhandled block
regardless of sub-kind; both branches receive the same `ViewData` shape, and
`undefined` falls through to the unchanged choice.

</details>

The change is additive throughout: no existing declaration reformatted,
renamed or reordered; no new view-node class (the generic base `ViewNode` and
the existing tiling helper were already sufficient); no engine-private
extension points.

## What we validated

Against the exact published `0.0.2-84` runtime in headless Chromium, driven
with real keyboard and pointer input:

- The hook fires for paragraph and unhandled-block probes while inactive, with
  the correct AST node and byte-exact `sourceText`; it is **not** consulted for
  headings, lists, code blocks, or for the active block.
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

## Offer

We're carrying this as a small internal fork of the published artifact, which
we'd much rather delete. Two caveats on our end, stated plainly:

1. Our patch is against the **published bundle**, because we couldn't access
   the source tree at the time. A PR would obviously need to be written against
   `vscode-team-tools/packages/markdown-editor` source — happy to do that work.
2. We kept the seam deliberately generic and free of any dialect-specific
   vocabulary, precisely so it could be upstreamed as-is.

If the shape looks right, I'll open a PR. If you'd prefer a different signature
(e.g. a kind filter, a single unified `renderCustomView` that subsumes the code
and math hooks, or a per-kind options map), we'd happily build to whatever you
consider the right long-term surface — a generic seam of *any* shape solves
this for us.

**Environment:** `@vscode/markdown-editor@0.0.2-84` (dist-tag `next`), Chromium
141, TypeScript 5.9.
