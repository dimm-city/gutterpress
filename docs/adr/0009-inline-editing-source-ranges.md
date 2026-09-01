# ADR 0009 — Inline editing: source ranges, the commit gate, and the preview bridge

Date: 2026-08-04 · Status: accepted · **Revised 2026-08-24** (native engine)

> **Revision 2026-08-24 — two of the three premises are dead.** This ADR was
> written against a preview that pre-dated the current engine. The viewer is
> now Chromium's own multicol fragmenter
> (`packages/cli/src/engine/viewer/`), and two of the three premises in
> Context died with the change — the two that held up the floating-overlay
> design:
>
> - **The DOM is no longer fragmented.** The native viewer "never chunks the
>   DOM" (`fragment.ts` header): a block spanning pages is ONE element with
>   several client rects, not N cloned elements. Split fragments, `data-ref`
>   grouping and the `id`-stripping caveat no longer describe anything.
> - **A DOM edit now re-paginates.** `Gutterpress.refresh()` → `relayout()`
>   rebuilds the strips from scratch (`buildStrips()`) and re-measures. The
>   earlier preview had no such path.
>
> **Unchanged and still load-bearing:** decisions 1–3 (line-based
> `data-source-range`, `token.meta.line` for markers, the clean-buffer commit
> gate) — none of them ever depended on the engine — and premise 3, which is
> still what rules out any HTML→markdown serializer. **Superseded:** decision 4
> and the v5 half of decision 5. The replacement design is in
> [`docs/inline-editing-plan.md`](../inline-editing-plan.md).
>
> **Status note 2026-09-01 (SFE-P4) — the mutation half of this ADR's
> motivation was removed; this ADR is NOT superseded.** SFE-P4 deleted the
> preview-mutation machinery decisions 3 and 5 exist to justify:
> `commitRangePatch`'s clean-buffer/generation gate (decision 3, §3 below) was
> deleted with `CommitEngine`, and the v8 addition to the bridge protocol
> (decision 5, §5 below — `beginBlockEdit`/`endBlockEdit` and their three
> events) was deleted, taking the protocol to v9. **Decisions 1 and 2 are
> unaffected and remain the current design**: `data-source-range` carrying
> `token.map` verbatim, and layout markers threading `token.meta.line`, still
> serve navigation (click-to-source), source reveal, and editor threading —
> none of that depended on there being a write path. See
> [`docs/inline-editing-plan.md`](../inline-editing-plan.md)'s 2026-09-01
> status note and the deletion ledger's "SFE-P4" entry
> (`../plans/source-first-editor/deletion-ledger.md`) for the measured
> deletion proof.

> **Note on predecessors.** `CLAUDE.md` and `docs/ux-design-contract.md` reference
> ADRs 0002, 0004, 0005, 0006 and 0007, none of which are present in this
> repository (`docs/adr/` holds 0008 through 0016 — 0002/0004/0005/0006/0007
> remain absent; **updated 2026-09-01, SFE-P6c:** ADR 0014 and ADR 0016 now
> carry the current record for the platform/host-portability topic ADR 0004
> used to cover). ADR 0005 in particular is
> cited as the home of the preview bridge protocol. Rather than amend a missing
> document, this ADR records the v3 → v5 protocol delta self-containedly.

## Context

Gutterpress authors edit markdown in a source pane and watch a paginated
preview. Editing *in* the preview — right-click actions on an image, a link, a
selection; a click-to-edit box over a block — was the most requested missing
affordance, and the obvious implementation (a WYSIWYG framework such as
Milkdown or Tiptap owning the preview DOM) is not available to us. Three
properties of this app rule it out, each verified by spike rather than assumed:

1. **The preview fragments the document** — **DEAD 2026-08-24.** In the
   earlier preview, a block overflowing a page was split into multiple DOM
   elements duplicating every attribute; a
   2000-word paragraph was observed splitting into 9 fragments across 9 pages,
   and a caret could not cross a fragment boundary. The native viewer splits
   nothing: one element, several client rects. This premise is what ruled out
   `contenteditable` on the page boxes, and it no longer holds.
2. **Every save replaces the preview DOM** — still true, and now absolute:
   `spliceChapter()` was removed and every content update goes through
   `swap()` (`preview-shell.js`), which replaces the whole book iframe.
   Anything stateful mounted inside it is destroyed. An in-flow editing surface
   therefore has to hold the swap open while it is live — the shell's existing
   `pendingSwap` gate is the hook.
3. **Gutterpress markdown is not CommonMark** — **still true, and still
   decisive.** The renderer stacks
   `markdown-it-attrs`, `markdown-it-footnote`, `markdown-it-deflist`,
   `markdown-it-source-map`, `markers.js`'s whole `@marker` family,
   `html: true`, `typographer: true`, and arbitrary manifest plugins. A
   remark-based editor means a second, drifting implementation of that dialect,
   and `remark-stringify` reformats the *whole document* on save — which would
   make every one-word edit a whole-file diff and destroy the value of the
   automatic snapshot history.

The full analysis was in `docs/reviews/inline-editing-analysis-2026-08-04.md`,
which is **not present in this repository** (noted 2026-08-24 — same class of
dangling reference as the predecessor ADRs above); this ADR is self-contained
without it. The current plan is
[`docs/inline-editing-plan.md`](../inline-editing-plan.md).

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

`markers.js`'s `layout_*_open` and break tokens carry
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
screen, on every page of a multi-page chapter (the earlier preview cloned the
wrapper per page). `preview-shell.js`'s `capture()`/`restore()` has the same
exposure.

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

### 4. The paginated DOM is never patched optimistically — **superseded 2026-08-24**

**The hazard is unchanged.** `.gp-strip` is a live CSS multicol container
(`column-fill: auto`, fixed column width, `overflow: visible`) whose `.gp-run`
wrapper is sized to the measured page count and does the clipping. Content that
grows past that stays invisible rather than overlapping — it flows into columns
beyond the drawn sheets. Spike-verified again on the native viewer
(2026-08-24): a strip whose true extent grew to 2400px went on being clipped at
its 900px run width, with no visual cue. An unrefreshed optimistic patch is
still forbidden, for exactly this reason.

**What changed is that the viewer can now correct itself.**
`Gutterpress.refresh()` → `relayout()` unwraps the strips, re-runs
`buildStrips()` from scratch, and re-measures `scrollWidth / stride` into
`--gp-pages` before redrawing the sheets. A full rebuild (not a re-measure) is
what makes this sound for edits that introduce a new page context. So the rule
becomes: **a DOM mutation is permitted when, and only when, a `refresh()`
follows it.** Pagination shown mid-edit is a projection of the author's own
in-progress typing; the authoritative render still arrives on commit, through
the normal write → regenerate → `swap()` path.

### 5. Bridge protocol v3 → v5 — **partly superseded 2026-08-24**

The preview bridge stays **read-only plus cosmetic**. It exposes geometry and
target metadata and can mask/lock presentation; it never mutates markdown. All
writes happen SPA-side behind the gate above, so a malicious or broken preview
document can at worst produce a menu with wrong labels.

| Version | Adds |
|---|---|
| v4 | `getContextTargetAt({x, y})`; the `contextMenuRequested` event (mouse **and** keyboard) |
| v5 | `getRectsFor({ref} \| {chapter, range})`; `setEditMask({ref, masked})` |
| v6 | the `{ref}` target form dropped from both (the native viewer never mints a ref) |
| v7 | `getContextTargetAt()` gains `pageMarker` + the margin-band fallback |
| v8 | `beginBlockEdit()` / `endBlockEdit()` and the `blockEditRequested` / `blockEditFinished` / `blockEditStateChanged` events. **Removes** `getRectsFor()` and `setEditMask()` |

`getRectsFor()` and `setEditMask()` existed only to position and de-clutter
behind a floating panel. With the panel gone they had no other caller and are
removed; the in-flow surface needs neither geometry nor a mask.

The **read-only plus cosmetic** rule above survives v8 in spirit but not in
letter: the bridge now mutates the book DOM (it swaps a block's rendered HTML for
its markdown source and back). It still writes nothing to disk — every write
stays SPA-side behind the gate in decision 3 — and the mutation is fully
reversible, with the rendered HTML restored on both the commit and cancel paths.

Two constraints on the v8 surface, each a consequence of the caret living in a
cross-origin document:

- **The host supplies the text; the book document never sources its own.**
  `beginBlockEdit` takes the source slice as an argument. Deriving it from the
  DOM would mean editing a projection of possibly-stale content — and the DOM is
  rendered from SAVED content, which is exactly what decision 3 guards against.
- **An end the author initiates arrives as an event, not a reply.** Escape,
  Cmd/Ctrl+Enter and blur happen inside the iframe where the SPA cannot observe
  them, so `blockEditFinished` carries the text out. `endBlockEdit` is for ends
  the HOST initiates (a dialog opening over the workspace) and returns the text
  in its reply. `blockEditStateChanged` fires on every open and close regardless
  of which side initiated it, because `preview-shell.js` holds hot-reload swaps
  on it — a swap mid-edit would destroy the caret and the uncommitted text with
  it, and a missed close would freeze the preview.

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
(rects are spread into plain objects). ~~Split fragments duplicate every
attribute, so consumers group by `data-ref`.~~ **Obsolete 2026-08-24:** the
native viewer never clones, so a `{chapter, range}` spec resolves to at most one
element and there is nothing to group.

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

- **Milkdown / Tiptap / BlockNote / Lexical owning the preview DOM** — still
  ruled out, but by premise 3 alone now: they need a document model and a
  serializer for a dialect that has neither. Premise 1 no longer contributes.
- **`contenteditable` on page boxes with a DOM→markdown diff** — **half of this
  flipped on 2026-08-24.** The DOM→markdown diff stays rejected: premise 3 means
  there is no serializer for this dialect and never will be one. The
  `contenteditable` half was rejected for two reasons that no longer hold ("the
  caret cannot cross split fragments, and nothing re-paginates after a native
  edit") — both spike-verified false on the native viewer. `contenteditable`
  holding the block's markdown **source** (no diff, no serializer) is now the
  adopted design; see `docs/inline-editing-plan.md`.
- **Character offsets on the wire** — defeated by markdown-it's and
  CodeMirror's line-ending normalization.
- **Slice comparison in place of the clean-buffer gate** — cannot detect the
  misalignment it would need to detect (§3).
- **A WYSIWYG mode as the default** — the UX contract requires any seamless
  WYSIWYG surface to be opt-in, because print layout fidelity is the product.
