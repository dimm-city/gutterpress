# Inline editing in the viewer — framework analysis (Milkdown and alternatives)

**Date:** 2026-08-04
**Question:** Can we use [Milkdown](https://github.com/Milkdown/milkdown) (or a
comparable framework) to let authors type directly in the paginated viewer, with
edits landing in the `.md` files exactly as they do from the editor pane — plus a
custom right-click menu, primarily over selected text and images?
**Verified against:** this branch, desktop `0.9.0-alpha.2`, preview bridge
protocol v3.

---

## 1. Answer up front

**Milkdown cannot be the editing surface of the paginated viewer.** Not because
of Milkdown's quality — it is the best markdown-native WYSIWYG framework
available — but because of three properties of *this* app that no
ProseMirror-based editor can satisfy:

1. The viewer's DOM is a **Paged.js projection**, not a document. Paged.js splits
   single source elements across page boxes (`data-split-from` / `data-split-to`,
   25 and 13 sites respectively in `packages/cli/src/assets/vendor/paged.polyfill.js`).
   One markdown paragraph can exist as two `<p>` elements on two different pages.
   ProseMirror requires a `contenteditable` subtree it owns 1:1 against its
   document model. Those two requirements are mutually exclusive.
2. Every save **replaces the viewer DOM wholesale** — `spliceChapter()` /
   `swap()` in `packages/cli/src/assets/preview/scripts/preview-shell.js:292,358`
   build a hidden iframe, re-paginate, and splice or swap. An editor instance
   living in that DOM is destroyed on every commit.
3. **Gutterpress markdown is not CommonMark.** `createMarkdownRenderer()`
   (`packages/cli/src/lib/markdown/renderer.ts:138`) stacks `markdown-it-attrs`,
   `markdown-it-footnote`, `markdown-it-deflist`, `markdown-it-source-map`,
   `markdown-it-paged` (the whole `@page`/`@section`/`@spread`/`@chapter` marker
   family), `html: true`, `typographer: true`, plus arbitrary user plugins from
   the manifest. Milkdown parses and serializes with **remark**, a different
   parser for a different dialect. Adopting it means maintaining a second,
   drifting implementation of the Gutterpress dialect.

**What you should build instead** is cheaper, ships sooner, and gets closer to
the Obsidian feel than Milkdown would:

| Tier | Feature | Framework needed |
|---|---|---|
| **0** | Custom right-click menu over the preview (text, images, links, blocks) | none |
| **1** | Click-to-edit block overlay in the viewer, committing into the existing CodeMirror buffer | none |
| **2** | Obsidian-style Live Preview in the editor pane (syntax hides until the caret enters) | CodeMirror 6 decorations — already a dependency |
| **3** | Optional continuous-flow WYSIWYG mode, separate from the paginated viewer | Milkdown, *if* the dialect problem is solved first |

The unlock for tiers 0–2 is a single small change in the shared render core:
**emit exact source character offsets on rendered blocks.** Everything else
composes from primitives that already exist.

---

## 2. What the codebase already gives you

This is unusually good ground to build on. The pieces are already in place:

| Capability | Where |
|---|---|
| Block → source line mapping in rendered HTML | `markdown-it-source-map`, wired at `packages/cli/src/lib/markdown/renderer.ts:155` |
| Block → source *file* mapping | `data-chapter-src` wrappers, `packages/cli/src/lib/markdown/assemble.ts:147` |
| Cross-iframe command/event bridge, origin-pinned | `packages/desktop/src/lib/preview-client.ts` + `pagedjs-interface.js` (protocol v3, `getProtocolVersion` at `pagedjs-interface.js:283`) |
| Click in preview → source line event | `elementActivated`, `pagedjs-interface.js:464` |
| Generic read-only DOM query from the host | `queryDom`, `pagedjs-interface.js:377` |
| Highlight/scroll primitives | `highlight` / `scrollTo`, `pagedjs-interface.js:321,405` |
| Per-chapter incremental re-pagination | `/__chapter` endpoint `packages/cli/src/preview/http-server.ts:564`, spliced by `preview-shell.js:358` |
| Save → dirty/recovery/external-edit state machine | `packages/desktop/src/lib/editor/buffer-state.svelte.ts` (500 ms debounced write, recovery snapshots, conflict reconciliation) |
| Markdown mutation helpers operating on a CodeMirror view | `packages/desktop/src/lib/editor/toolbar-actions.ts` (`applyBold`, `applyImage`, `applyLayoutBlock`, …) |
| Re-render latency budget | `npm run rerender-ci` — median write→visible ≤ 1000 ms (`packages/desktop/package.json`) |

Roughly 80% of "inline editing" is bridge plumbing that is already written and
tested. What is missing is *write* capability and *precise* source anchoring.

---

## 3. The three hard constraints, in detail

### 3.1 Paged.js fragments the document

Paged.js clones flow content into `.pagedjs_page > … > .pagedjs_page_content`
boxes and splits any element that overflows, tagging the halves with
`data-split-from` / `data-split-to`. The consequences:

- A block's rendered text is not guaranteed contiguous in the DOM.
- Node identity is not stable across re-pagination.
- `contenteditable` on a page box would let the user type into a *fragment*, and
  the fragment's relationship to the source is only "the block I was split from".

Anything that assumes "the DOM is the document" — ProseMirror, Tiptap, Lexical,
BlockNote, and plain `contenteditable` + DOM→markdown diffing — is fighting the
renderer. This is not a Paged.js bug; pagination is inherently a projection.

### 3.2 The viewer is a double iframe, cross-origin, and disposable

Layout: SPA (`app://local`) → `PreviewFrame` iframe (shell, `http://127.0.0.1:<port>`)
→ book iframe. The SPA↔shell boundary is `postMessage` with a pinned origin
(`preview-client.ts:115`) and the frame is sandboxed to
`allow-scripts allow-same-origin` (`PreviewFrame.svelte:59`). The shell relays
transparently between the SPA and the active book frame.

Every content change tears down the active book frame (`swap`) or splices in
freshly paginated pages (`spliceChapter`). A stateful editor mounted in there
does not survive a keystroke commit.

**One helpful consequence for the menu work:** the shell and book iframes both
fill their parent at (0,0) and the *inner document* is what scrolls, so a
`getBoundingClientRect()` taken inside the book frame is already in the SPA's
coordinate space once you add `PreviewFrame`'s own offset. Fit-width zoom is
applied via CSS `zoom`, and `getBoundingClientRect` is post-zoom (see the note at
`pagedjs-interface.js:28`), so no manual scaling is needed. Overlays positioned
from bridge-reported rects will land correctly.

### 3.3 The dialect problem, and why it is the expensive one

To let Milkdown edit a Gutterpress chapter, every construct below needs a
remark/micromark extension, a ProseMirror node or mark spec, and a serializer
rule — and each must round-trip byte-identically or the feature is worse than
useless:

- `@chapter` / `@spread` / `@page` / `@section` / `@continue` / `@end-section` /
  `@page-break` / `@column-break`, each with bare names, `key=value` pairs,
  `#id`, and `.class` shorthand (`markdown-it-paged.js`)
- `{.class #id key=val}` attribute blocks (`markdown-it-attrs`)
- footnotes, definition lists
- raw HTML (`html: true` — authors use it for covers and layout blocks)
- typographer transformations (`typographer: true` rewrites quotes and dashes
  *in the rendered output*, which matters for reverse-mapping — see §6.2)
- whatever the project's manifest plugins add, including npm-vendored ones

That is not a port; that is a second parser for a dialect that currently has one
authoritative implementation. Any divergence shows up as *silent content
corruption in an author's book*, which is the worst possible failure mode for
this product.

There is a second, quieter cost. Milkdown serializes with `remark-stringify`,
which normalizes the **whole document**: heading style, list markers, emphasis
characters, blank-line runs, wrapping. A one-word edit produces a
whole-file diff. Gutterpress auto-commits snapshots through isomorphic-git
(CLAUDE.md §7) — whole-file diffs on every save make the version history
worthless, and make external collaboration (Open Design, `docs/open-design/`)
hostile. This is a well-documented failure mode of remark-based editors, not a
Gutterpress-specific worry.

---

## 4. Milkdown evaluated on its merits

| Property | Finding |
|---|---|
| Version / activity | `@milkdown/core`, `@milkdown/kit`, `@milkdown/crepe` all at **7.22.0**, published 2026-08-03 — actively maintained |
| License | MIT (all three packages) |
| Architecture | ProseMirror document model + remark parse/serialize; ~60 packages under `@milkdown/*` |
| Size | ~200 KB gzipped for a typical build |
| Headless | Yes — ships no CSS, which suits our theming |
| Batteries-included variant | `@milkdown/crepe` (toolbar, slash menu, block handle, image upload) |
| Collaboration | Y.js binding available (not needed today) |
| Custom syntax | Supported, but each construct costs a remark extension + node spec + serializer rule |

**Where it could live under §8.** Milkdown is pure browser code — no `node:*` —
so importing it into the SPA is PWA-clean and does not violate the platform
abstraction rule. That part is fine.

**Where it could not live.** Putting it *inside* the preview iframe means adding
it to `packages/cli/src/assets/preview/scripts/`, which today are hand-written
IIFE files shipped verbatim as embedded assets (CLAUDE.md §4). There is no
bundling step for preview assets, and adding one to ship 200 KB of ProseMirror
into the `bun build --compile` binary is exactly the kind of complexity the
Primary Goals section tells us to refuse without strong justification.

**Verdict.** Milkdown is the right tool for a *separate continuous-flow editing
mode* — a "Write" view alongside "Source" and "Print preview" — and only after
the dialect problem is solved. It is the wrong tool for editing inside the
paginated viewer, and it is not needed at all for the experience the request
actually describes.

---

## 5. Alternatives considered

| Option | Model | Fits paged viewer? | Round-trip risk | Verdict |
|---|---|---|---|---|
| **Milkdown** | ProseMirror + remark | No (§3.1/3.2) | High — whole-file re-serialize, dialect reimplementation | Tier 3 only, flow mode |
| **Tiptap 3** (`@tiptap/markdown` 3.29.2) | ProseMirror + own MD layer | No, same reason | High, same reason; plus some extensions sit behind a paid plan — a distribution question for a shipped binary | No |
| **BlockNote** | ProseMirror, block-first | No | High; block model is further from markdown than Milkdown's | No |
| **Lexical** | Own model | No | High; markdown is a plugin, not the model | No |
| **Plain `contenteditable` on page boxes + DOM→MD diff** | none | Technically yes | Very high — fragmented DOM, typographer, generated content | No |
| **Per-block overlay editor committing to source ranges** | CodeMirror (already present) | **Yes** | **None** — patch is a substring splice | **Tier 1** |
| **CodeMirror 6 decorations (Obsidian Live Preview)** | CodeMirror (already present) | n/a — it's the editor pane | **None** — decorations are view-only; the buffer stays plain markdown | **Tier 2** |

The CodeMirror-decorations row deserves emphasis: **Obsidian's Live Preview is
itself a CodeMirror 6 decoration layer**, not a ProseMirror editor. Syntax
markers are hidden by decorations until the caret enters the construct; the
document is always literal markdown. That is why Obsidian never corrupts files
and never reformats them. Gutterpress already depends on
`@codemirror/view`, `@codemirror/state`, `@codemirror/language`, and
`@codemirror/lang-markdown`, and already has a Lezer-based highlight style
(`MarkdownEditor.svelte:194`). "Obsidian-like editing" is an incremental feature
on an existing dependency, not a new framework.

This also matches the standing UX contract, which already says: *"Typora-style
seamless WYSIWYG as an opt-in toggle — never the default; explicit source/preview
is the default because print layout fidelity matters"*
(`docs/ux-design-contract.md:213`).

---

## 6. What has to be built

### 6.1 The keystone: exact source offsets on rendered blocks

`markdown-it-source-map` (v0.1.1, unchanged since 2017) emits only
`data-source-line` — the **start** line of a top-level block. That is enough to
scroll to; it is not enough to *write back*, because there is no end boundary.

Replace it (or wrap it) with a small core rule in
`packages/cli/src/lib/markdown/` that stamps both ends as **character offsets
into the chapter file**:

```html
<p data-source-line="42" data-src-from="1183" data-src-to="1247">…</p>
```

Derivation is straightforward: `token.map` gives `[startLine, endLine)`; a
precomputed line-offset table for the chapter converts those to character
offsets. Keep `data-source-line` so every existing consumer
(`pagedjs-interface.js`, `preview-shell.js`, `EditorPreviewSyncController`)
keeps working unchanged.

Why this is the right primitive:

- Writing back is a substring splice:
  `src.slice(0, from) + edited + src.slice(to)`. No parsing, no serializer, no
  normalization.
- **Only the edited block changes.** Git diffs stay minimal; version history and
  external collaboration stay useful. This is the single biggest advantage over
  any WYSIWYG framework.
- It lives in the shared render core, so the CLI, the desktop app, and the PWA
  `WebAdapter` all get it — one implementation, per CLAUDE.md §7's shared-lib
  rule.
- It is additive and low-risk.

### 6.2 Selection → source mapping: be honest about what is reliable

The request calls out selected **text** and **images**. These have very different
difficulty, and the design should reflect that rather than pretending otherwise.

**Images and links are the strong case.** The `<img>`/`<a>` element carries
`src`/`href`. Given the enclosing block's `[from, to)` range, you find the exact
markdown token by attribute value with high confidence. Every useful action —
replace image, set width, edit alt text, change position, edit link target — is a
precise, verifiable token-level patch. **This is where the right-click menu should
lead.**

**Arbitrary text selection is the weak case.** Rendered text ≠ source text:
`**bold**` renders as `bold`, `typographer: true` rewrites `"` → `“` and `--` →
`–`, footnote references render as superscript markers, entities are decoded.
There is no offset-preserving mapping from a rendered DOM `Range` back to a
markdown offset today.

Two workable strategies, in increasing cost:

1. **Search-and-verify (recommended first).** Take the selected rendered text,
   reverse the known typographer substitutions, and search within the block's
   `[from, to)` source slice. Require a **unique** match. On a unique hit, apply
   the transformation (wrap in `**…**`, etc.). On ambiguity or no match, degrade
   to "open this block in the editor with the block selected" rather than making a
   wrong edit. Silent wrong edits are unacceptable; a graceful fallback is not.
2. **Inline source offsets (the real fix).** markdown-it block tokens carry
   `map`; inline tokens do not. A core rule can capture inline positions by
   recording `state.pos` around inline rule execution and emitting
   `data-src-from`/`data-src-to` on `link_open`, `image`, `strong_open`,
   `em_open`, etc. Feasible, but the edge cases are real (blockquote/list
   indentation stripping, lazy continuation), so this belongs in a later phase
   with its own test corpus.

### 6.3 Bridge protocol v4

Additions to `pagedjs-interface.js`, with `getProtocolVersion()` bumped to `4`
so a hot-updated SPA can feature-detect against an older bundled lib (the
existing pattern at `pagedjs-interface.js:283`):

| Command / event | Purpose |
|---|---|
| `getBlockAt({x, y})` / extend `elementActivated` | Return `{chapter, from, to, line, rect, tag}` for the block under a point |
| `getContextTarget({x, y})` | `{kind: "image" \| "link" \| "text" \| "block", rect, chapter, from, to, attrs, selectionText}` — everything the menu needs in one round trip |
| `contextMenuRequested` event | Fired from a `contextmenu` listener in the book frame that calls `preventDefault()` (this also suppresses Electron's native menu — see `packages/desktop/electron/main.ts:731`) |
| `getRectFor({from, to})` | Rect(s) for a source range, for overlay placement; returns multiple rects when Paged.js split the block |
| `beginEdit` / `endEdit({from, to})` | Mask the live block (visibility/outline) while an overlay edits it, and restore after |

Note the bridge stays **read-only plus presentation**. It never writes markdown.
All writes go through the host — that is what keeps the security posture of
`preview-client.ts` intact.

### 6.4 Writes must go through `EditorBuffer` — not the filesystem

This is the part that makes the request's phrase *"just as if they would in the
current editor view"* literally true.

`EditorBuffer` (`buffer-state.svelte.ts`) owns the dirty state machine, the
500 ms debounced disk write, crash-recovery snapshots, external-edit
reconciliation, and the close-flush. Bypassing it for viewer edits would produce
a second, inconsistent write path.

The right design is stronger than "route through the buffer": **keep CodeMirror
as the single document model, and treat the viewer overlay as another way to
dispatch a transaction into it.** A block edit becomes
`view.dispatch({ changes: { from, to, insert } })` against the already-open (and
possibly hidden) editor view. You get, for free:

- identical save/recovery/conflict behavior
- shared undo history — `Ctrl+Z` in the viewer undoes a viewer edit
- the existing `toolbar-actions.ts` helpers (`applyBold`, `applyImage`, …) work
  unchanged as right-click menu actions
- editor↔preview sync keeps working, because nothing new owns the document

If the edited block belongs to a chapter that is not the open buffer, open that
chapter first — the machinery for that already exists in
`EditorPreviewSyncController`'s cross-chapter reveal.

### 6.5 Latency: commit-on-blur, not per-keystroke

`spliceChapter()` re-paginates one chapter in a hidden iframe and splices the
pages; the CI gate holds median write→visible at ≤ 1000 ms. That is fine for
commit-on-blur/`Enter` and impossible for per-keystroke.

The overlay makes this a non-issue perceptually: the author types in a real text
field positioned over the block, so typing feedback is instant; the page reflows
once on commit. Professional layout tools behave the same way.

If you later want true type-and-see-it reflow, the trick is an optimistic DOM
patch — render just the edited block and swap its HTML into the live paged DOM,
then let the debounced true re-pagination correct it. Anything that changes block
height invalidates every page break after it, so treat that strictly as
Tier-2 polish behind the correct path, never as the source of truth.

### 6.6 The right-click menu itself

Render it **in the SPA**, as a Svelte component absolutely positioned over
`PreviewFrame` using the rect from `getContextTarget`. Reasons:

- PWA-clean by construction (§8) — works on both the Electron and browser targets
  with one implementation.
- No IPC, no `Platform` contract change; it is ordinary renderer UI.
- Consistent styling with the rest of the app, unlike a native `Menu`.

Two things to get right:

- The book frame's `contextmenu` handler must `preventDefault()`, otherwise
  Electron's native handler at `main.ts:731` also fires. (Today that handler
  early-returns unless there is an editable target or a selection, so a
  right-click on a preview image currently does nothing — worth confirming
  during implementation.)
- Menu contents should be driven by `kind`. Suggested first set:
  - **image** — Replace image…, Set width…, Edit alt text…, Alignment, Reveal in
    Media panel, Edit block in editor
  - **link** — Edit link…, Copy target, Open externally, Edit block in editor
  - **text selection** — Bold, Italic, Code, Link… (each via the §6.2 search-and-verify
    path, greyed out with a tooltip when the mapping is ambiguous), Edit block in editor
  - **block** — Edit here, Insert page break above/below, Wrap in `@section`…,
    Go to source line

Tier 0 is deliverable on its own: the menu, with every action routed to
"apply through the existing editor buffer", is genuinely useful before any
inline-editing overlay exists.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Wrong-target text edits from ambiguous selection mapping | Require a unique match; degrade to "edit block in editor" instead of guessing (§6.2) |
| Offset drift between render time and commit time (file changed underneath) | Commit through `EditorBuffer`, which already detects external changes; re-resolve the block range against the live buffer and refuse the patch if the slice no longer matches what was rendered |
| Blocks split across pages confuse overlay placement | `getRectFor` returns multiple rects; edit the first fragment's rect and mask the rest |
| Bridge version skew (hot-updated SPA, older bundled lib) | `getProtocolVersion` → 4, feature-detect (existing pattern) |
| Scope creep into a general WYSIWYG | The UX contract already caps this: opt-in, never the default (`docs/ux-design-contract.md:213`) |
| Overlap with issue #37 (visual *layout* editor) | Disjoint: #37 projects over CSS; this projects over markdown. Keep them separate |

---

## 8. Recommendation

1. **Do not adopt Milkdown for the viewer.** It cannot own the paged DOM, it
   would require reimplementing the Gutterpress markdown dialect in remark, and
   its serializer rewrites whole files — which breaks the Git snapshot story.
2. **Build the source-offset primitive first** (§6.1). It is small, additive,
   shared by CLI/desktop/PWA, and every other tier depends on it.
3. **Ship the right-click menu next** (Tier 0). It is the highest
   value-per-unit-of-risk item in the request, needs no editing framework, and
   images and links — the cases the request names — are exactly the cases that
   map back to source reliably.
4. **Then the block overlay** (Tier 1), dispatching CodeMirror transactions into
   the existing buffer so viewer edits are indistinguishable from editor edits.
5. **Then Obsidian-style Live Preview in the editor pane** (Tier 2) via
   CodeMirror decorations. This is what actually delivers the "Obsidian feel",
   on a dependency we already ship, with byte-exact files.
6. **Revisit Milkdown only for Tier 3** — a separate continuous-flow "Write"
   mode — and only if the dialect round-trip can be proven lossless against a
   corpus of real projects first.

Suggested issues to file: source-offset primitive (blocks); preview context menu
(Tier 0); block overlay editor (Tier 1); CM6 live-preview decorations (Tier 2);
inline source offsets (enables reliable selection actions); bridge protocol v4.

---

## Sources

- [Milkdown/milkdown](https://github.com/Milkdown/milkdown) · [milkdown.dev](https://milkdown.dev/) · [What is Milkdown (DeepWiki)](https://deepwiki.com/Milkdown/milkdown/1.1-what-is-milkdown)
- [Milkdown Editor Implementation (DeepWiki)](https://deepwiki.com/Milkdown/milkdown/4-editor-implementation)
- [Tiptap: bidirectional markdown support](https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap) · [@tiptap/markdown](https://www.npmjs.com/package/@tiptap/markdown)
- [obsidian-codemirror-options](https://github.com/nothingislost/obsidian-codemirror-options) — Obsidian Live Preview is CodeMirror 6 + decorations
- [Atomic Editor — Obsidian-style live preview for CodeMirror 6](https://github.com/kenforthewin/atomic-editor) · [HN discussion](https://news.ycombinator.com/item?id=48345201)
- [codemirror-rich-obsidian](https://github.com/Type-32/codemirror-rich-obsidian) · [codemirror-live-markdown](https://github.com/blueberrycongee/codemirror-live-markdown)
- npm registry: `@milkdown/core` / `@milkdown/kit` / `@milkdown/crepe` 7.22.0 (2026-08-03, MIT); `@tiptap/core` 3.29.2; `markdown-it-source-map` 0.1.1
