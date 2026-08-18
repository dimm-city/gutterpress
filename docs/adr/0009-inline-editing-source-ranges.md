# ADR 0009 — Inline editing: source ranges, the commit gate, and the preview bridge

Date: 2026-08-04 · Status: accepted, **superseded in part 2026-08-17** (see
[Superseded in part](#superseded-in-part-2026-08-17) below)

> [!IMPORTANT]
> Everything this ADR says about **the preview** still holds and is still
> load-bearing. What no longer holds is its conclusion that a ProseMirror-family
> editor is unavailable to Gutterpress *anywhere* — it is now the editor pane's
> surface. Read the supersession note before citing this ADR against a
> rich-editing change.

> **Note on predecessors.** `CLAUDE.md` and `docs/ux-design-contract.md` reference
> ADRs 0002, 0004, 0005, 0006 and 0007, none of which are present in this
> repository (only 0008 is). ADR 0005 in particular is cited as the home of the
> preview bridge protocol. Rather than amend a missing document, this ADR records
> the v3 → v5 protocol delta self-containedly.

## Superseded in part (2026-08-17)

A rich-text editing surface now exists — ProseMirror over a real document
model (`packages/desktop/src/lib/editor/`). That does not overturn this ADR so
much as narrow it: **its three ruled-out premises were about mounting an editor
over the PAGINATED PREVIEW, and the new surface is not that.** It is the editor
pane, it is its own iframe, and it paginates with CSS (`engine/viewer/live-document.ts`)
rather than by fragmenting the DOM.

Taking the premises one at a time, because the distinction matters:

1. **"Paged.js fragments the document"** — VOID. Paged.js was deleted
   2026-08-10. The observation was correct and is now unreachable: nothing
   splits a block into `data-split-from` fragments, and the rich surface does
   not run a fragmenter at all. The deeper form of the objection — that a
   ProseMirror editor needs a `contenteditable` subtree it owns 1:1 — is
   satisfied by giving it its own surface instead of the preview's DOM.
2. **"Every save replaces the preview DOM"** — STILL TRUE, still a reason not
   to mount a stateful editor inside the preview. Unchanged.
3. **"Gutterpress markdown is not CommonMark"** — STILL TRUE, and still the
   most important warning in this document. What changed is that it no longer
   implies a second parser: `prosemirror-markdown` is designed to tokenize with
   a markdown-it instance you supply, so the editor parses with Gutterpress's
   OWN pipeline — same plugins, same `markers.js`, same `typographer`/`linkify`.
   The remark objection this ADR actually raised (a second, drifting dialect)
   is avoided by construction. **Do not read this as permission to introduce
   remark, marked, or `@tiptap/markdown`** — each would reintroduce exactly the
   drift described here.

Two decisions below are superseded:

- **"There is no second document model and no serializer."** There is now, for
  the editor pane. The accompanying fear — `remark-stringify` reformatting the
  whole file on save — was answered by deciding it deliberately rather than by
  avoiding it: output is CANONICAL, not byte-preserving, exactly as Typora,
  Milkdown and HackMD are. What replaces byte identity as the safety property
  is a FIXPOINT gate over every markdown file in every example book —
  normalizing an already-normalized document must return it unchanged, source
  compared to source, no threshold and no allowlist
  (`tests/editor/markdown-doc-corpus.test.ts`). The whole-file-diff cost to
  snapshot history is real and accepted; it is meant to be paid once per
  project by an explicit normalize-on-adoption step.
- **The framing that a WYSIWYG framework "is not available to us."** It is,
  for the editor pane. It remains unavailable for the preview, for reason 2.

What is UNCHANGED and still normative: `data-source-range` carrying
`token.map` verbatim, layout markers threading `token.meta.line`, the commit
engine's clean-buffer gate, never patching the paginated DOM optimistically,
the bridge protocol, and **"never guess an edit."** A file the document model
cannot represent opens in SOURCE mode with the reason stated — the parser
fails closed rather than mis-serializing.

## Context

Gutterpress authors edit markdown in a source pane and watch a paginated
preview. Editing *in* the preview — right-click actions on an image, a link, a
selection; a click-to-edit box over a block — was the most requested missing
affordance, and the obvious implementation (a WYSIWYG framework such as
Milkdown or Tiptap owning the preview DOM) is not available to us. Three
properties of this app rule it out, each verified by spike rather than assumed:

1. **Paged.js fragments the document.** Blocks that overflow a page are split
   into multiple DOM elements (`data-split-from` / `data-split-to`) that
   duplicate every attribute. A 2000-word paragraph was observed splitting into
   9 fragments across 9 pages. ProseMirror-family editors require a
   `contenteditable` subtree they own 1:1 against their model; a caret cannot
   even cross a fragment boundary.
2. **Every save replaces the preview DOM** (`spliceChapter()` / `swap()` in
   `preview-shell.js`), destroying anything stateful mounted inside it.
3. **Gutterpress markdown is not CommonMark.** The renderer stacks
   `markdown-it-attrs`, `markdown-it-footnote`, `markdown-it-deflist`,
   `markdown-it-source-map`, `markdown-it-paged`'s whole `@marker` family,
   `html: true`, `typographer: true`, and arbitrary manifest plugins. A
   remark-based editor means a second, drifting implementation of that dialect,
   and `remark-stringify` reformats the *whole document* on save — which would
   make every one-word edit a whole-file diff and destroy the value of the
   automatic snapshot history.

The full analysis is in
[`docs/reviews/inline-editing-analysis-2026-08-04.md`](../reviews/inline-editing-analysis-2026-08-04.md);
the phased implementation plan is [`docs/inline-editing-plan.md`](../inline-editing-plan.md).

## Decision

Inline editing is a **projection over the markdown source plus a patch
generator into it**. There is no second document model and no serializer. Four
decisions carry the design, and each is easy to "simplify away" later by
someone without this context — which is why they are recorded here.

### 1. `data-source-range` carries `token.map` verbatim

Every rendered block-level element carries
`data-source-range="<start>:<end>"` — markdown-it's own `token.map`
semantics unchanged: **0-based line index, half-open `[start, end)`**.

Line ranges, not character offsets, are the wire format. markdown-it
LF-normalizes its input before any plugin runs (`normalize` is the first core
rule, rewriting `\r\n?` → `\n`), and CodeMirror normalizes document line
breaks, so character offsets computed at render time would not reliably index
the editor buffer. Offsets are resolved SPA-side against the authoritative
buffer text via `buildLineStarts`/`charRange`, whose line-break regex
(`/\r\n?|\n/g`) must stay identical to markdown-it's — a naive `\n` split
breaks on lone-`\r` files, where markdown-it still sees multiple lines.

Known, deliberate non-coverage: raw `html_block` (markdown-it's renderer
discards `token.attrs` for it), reference-style link/image *definitions* (they
emit no tokens at all), inline footnote bodies (`^[...]` synthesizes an
unmapped paragraph), and `th`/`td`/`li` wrappers (no `token.map`). Consumers
fall back to the nearest annotated ancestor.

### 2. Layout markers thread `token.meta.line` — **never** `token.map`

`markdown-it-paged`'s `layout_*_open` and break tokens carry
`token.meta = { line }` (1-based marker line), and the annotation rule
converts it to `[line - 1, line)`.

**Setting `token.map` on these tokens instead would be a silent regression.**
`markdown-it-source-map` decorates any level-0 `*_open` token that has a
non-null `map`, so the wrapper `<div>`s would start carrying
`data-source-line`. That changes the candidate set of the shipped scroll-sync
code: `sourcedBlocks()` selects `[data-source-line]`, and
`topVisibleSourceEl()` keeps the best candidate only on a **strictly greater**
rect top. A wrapper's top ties exactly with its first child's, the wrapper
comes first in document order, and a tie never displaces it — so scroll-sync
would resolve to the `@chapter` marker's line instead of the paragraph on
screen, on every page of a multi-page chapter (Paged.js clones the wrapper per
page). `preview-shell.js`'s `capture()`/`restore()` has the same exposure.

Threading `meta` leaves `data-source-line` coverage byte-identical, which a
regression test asserts by extracting and diffing all `data-source-line`
occurrences before and after.

### 3. The commit engine's clean-buffer gate cannot be replaced by a slice comparison

Every mutation flows through `commitRangePatch`, which refuses unless the
target chapter's buffer is **clean and disk-fresh** and the target slice
matches what was captured when the menu or overlay opened.

The gate is load-bearing and non-obvious. The preview DOM is rendered from
*saved* content. If the buffer is dirty — the author typed in the editor pane —
the DOM's line ranges still index the old content while the character offsets
resolve against the new. `expected` is captured from that same misaligned
slice, so the commit-time equality check passes **trivially** on the wrong
occurrence of a repeated block. With boilerplate content (repeated captions,
disclaimers) even a human eyeball check passes. No slice comparison can detect
this failure mode; only the gate can.

Three supporting rules:

- **Freshness is checked live.** `reconcileExternalChange()` runs *before* the
  patch is composed. The in-memory `diskContent` can lag a just-written
  external change until the watcher fires; `performSave` would eventually catch
  it, but only after `buffer.edit()` had already mutated the buffer, leaving a
  conflict banner whose "Keep mine" resolves to a stale-base patch.
- **An edit-generation counter** (bumped on every apply and every
  `renderingComplete`) is captured at open and re-checked at apply. This closes
  the clean-but-DOM-stale window: commit #1 lands and flushes before the splice
  refreshes the DOM, leaving a second action's captured range stale while the
  buffer looks clean.
- **The chapter id is untrusted.** `data-chapter-src` arrives from a document
  that runs author content with `allow-scripts`. It is validated (`..`
  segments, leading `/`, backslashes, drive letters all rejected) before it can
  reach the project-directory join.

Writes never touch the filesystem directly: they go through `EditorBuffer`, or
through `applyRangeEdit` when a CodeMirror view is mounted on the target file
so the edit shares that view's undo history. A commit flushes immediately
rather than waiting out the autosave debounce (default 500 ms).

### 4. The paginated DOM is never patched optimistically

`.pagedjs_page_content` is a live CSS multi-column container
(`column-fill: auto`, fixed column width). Content that overflows after a DOM
patch does **not** visibly overlap or clip — it spills into invisible columns
thousands of pixels to the side, observable only as
`getClientRects().length > 1`. The failure mode is silent, so "render the edit
inline for instant feedback" cannot be validated by looking at the page.

Paged.js also never re-layouts after a mutation — no observer, no correction.
Anything the overlay touches in that DOM (mask classes, scroll lock) is purely
cosmetic and fully reversible; the authoritative refresh is always a real
re-render through the settled-write → chapter-splice pipeline.

### 5. Bridge protocol v3 → v5

The preview bridge stays **read-only plus cosmetic**. It exposes geometry and
target metadata and can mask/lock presentation; it never mutates markdown. All
writes happen SPA-side behind the gate above, so a malicious or broken preview
document can at worst produce a menu with wrong labels.

| Version | Adds |
|---|---|
| v4 | `getContextTargetAt({x, y})`; the `contextMenuRequested` event (mouse **and** keyboard) |
| v5 | `getRectsFor({ref} \| {chapter, range})`; `setEditMask({ref, masked})` |

Two constraints shaped the surface:

- **The `Shift+F10` / menu-key listener must live inside the book iframe.**
  Keyboard events targeted at a focused element in a cross-origin iframe never
  reach the parent SPA, so an SPA-side listener cannot satisfy the UX
  contract's keyboard-operability requirement. This is a physical constraint,
  not a style preference.
- **`preventDefault()` fires only when `kind !== "none"`.** Right-clicks on
  page furniture (margin boxes, running headers, page numbers) keep native
  behavior; that text is real, selectable content and suppressing its native
  menu with no replacement would be a regression. Verified separately that
  in-page `preventDefault()` does suppress Electron's `webContents`-scoped
  native `context-menu` handler (real Electron under xvfb, synthetic input:
  0 fires suppressed vs 1 unsuppressed), so no frame-gating in `main.ts` was
  needed.

Payloads cross two `postMessage` boundaries and must stay JSON-cloneable
(rects are spread into plain objects). Split fragments duplicate every
attribute, so consumers group by `data-ref` — never `id`, which Paged.js
strips from all fragments but the first.

## Consequences

- Only the edited block's bytes change, so snapshot diffs stay minimal and the
  version history remains useful — the property a remark round-trip would have
  destroyed.
- Actions degrade to "open in editor" rather than guessing. Where the rendered
  text cannot be mapped back to source unambiguously (ambiguous typography,
  footnote markers, code spans and link interiors), the menu item is disabled
  with a reason. This is deliberate: a wrong edit in an author's book is the
  worst outcome the feature can produce.
- Editing precision is bounded by annotation coverage (§1). Extending it —
  inline-level ranges, raw HTML blocks — is additive future work, not a
  redesign.
- The renderer stays PWA-clean: the annotation rule is node-free and ships
  through `gutterpress/render`; every SPA-side module here is
  fetch/injection-based with no `node:*` imports.

## Alternatives rejected

- **Milkdown / Tiptap / BlockNote / Lexical owning the preview DOM** — ruled
  out by the three properties in Context.
- **`contenteditable` on page boxes with a DOM→markdown diff** — the caret
  cannot cross split fragments, and nothing re-paginates after a native edit.
- **Character offsets on the wire** — defeated by markdown-it's and
  CodeMirror's line-ending normalization.
- **Slice comparison in place of the clean-buffer gate** — cannot detect the
  misalignment it would need to detect (§3).
- **A WYSIWYG mode as the default** — the UX contract requires any seamless
  WYSIWYG surface to be opt-in, because print layout fidelity is the product.
