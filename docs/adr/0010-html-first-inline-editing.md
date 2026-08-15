# ADR 0010 — HTML-first inline editing: the paginated book is the editor

Date: 2026-08-15 · Status: superseded by ADR 0011 (the Galley goal stands;
the contenteditable/DOM→markdown mechanism described here was replaced by
the ProseMirror document model) · Supersedes parts of ADR 0009 (see §5)

## Context

ADR 0009 rejected "contenteditable on page boxes with a DOM→markdown diff"
on three spike-verified grounds. Two were **Paged.js physics** and died with
Paged.js (deleted 2026-08-10): the native viewer paginates with CSS multicol
strips, so a block is ONE DOM node flowing across page boundaries — a caret
crosses pages natively, typing reflows with zero JS, and `relayout()`
rebuilds pagination by MOVING nodes (references survive). Measured on a
worst-case ~200pp single-strip book (`edit-physics.test.ts`): text mutation +
forced full-strip reflow **2.3 ms median**; typing p95 frame **21.7 ms**;
full relayout **58.7 ms median**; caret refs survive relayout.

The third ground — a serializer for a non-CommonMark dialect drifts, and
whole-document reformatting destroys snapshot-diff value — is answered by
design, not dismissed (§2).

The product owner directed the flip (2026-08-15): markdown→HTML runs at
load; the paginated preview IS the editor; **saving only syncs the source
`.md` files to match the screen**; verification is non-blocking and
view-healing only; normalization of edited blocks is accepted; desktop
first; the source pane survives as an on-demand view.

## Decision

1. **The book DOM is the editing surface; markdown files remain the only
   durable document model.** `.gp-strip` hosts are contenteditable; a
   `beforeinput` policy confines edits to source-annotated content blocks —
   wrappers, chapter openers, engine artifacts, and raw-HTML islands refuse
   input. Pagination re-settles via an idle, caret-preserving
   `Gutterpress.refresh()` (`gp:relayout` re-stamps editability).
2. **A block-scoped, closed-set serializer** (`lib/markdown/serialize.ts`,
   pure, shipped via `gutterpress/render`) converts one edited block back to
   canonical markdown. Anything it doesn't fully understand **refuses** and
   degrades to the block overlay — never a guessed edit. Only edited blocks'
   bytes change (ADR 0009's diff-minimalism preserved); typographer output
   is emitted verbatim (Unicode passes through; typed ASCII converges to
   smart forms via drift-heal). Soundness contract: substitution must
   re-render model-equal without perturbing any other block — enforced
   offline by `scripts/roundtrip-gate.ts` over every example book (zero
   unsound tolerated; per-book coverage ratchets in
   `roundtrip-baseline.json`).
3. **The commit engine is unchanged and remains the only write path.** The
   frame proposes `{chapter, range, expected, replacement}`; the SPA session
   commits through every existing gate. Inline saves carry
   `origin:"inline-edit"` end-to-end so the preview server suppresses its
   rebuild — **the viewer never re-renders or swaps during an editing
   session**; `book.html` regenerates on load/reload/external change. Acks
   update the frame's source mirror and shift `data-source-range` below the
   patch by its line delta.
4. **Converge-on-drift, never blocking:** after commits, the frame fetches
   the chapter's fresh render from the revived `/__chapter` route, diffs per
   block (DOMParser), heals ONLY drifted blocks in place — skipping dirty,
   focused, and unextractable blocks — and re-stamps authoritative ranges.
   Ripples (footnote renumbering) are just drift in siblings. Persistent
   drift degrades the block to the overlay.
5. **Supersessions of ADR 0009** — everything not listed stands, notably §1
   source ranges, §2 meta-threading, and §3's commit gates verbatim:
   - §4 "the paginated DOM is never patched optimistically" → user input
     patches it by design; the app itself patches only via verified heals.
   - "No serializer" (Context/Decision preamble) → narrowed to "no
     WHOLE-DOCUMENT serializer"; the block-scoped, refuse-by-default codec
     is permitted with the §2 soundness gates.
   - §5's read+cosmetic bridge posture → widened by protocol v7: the frame
     may PROPOSE patch text (`editPatches`); placement and base-slice are
     still verified SPA-side, and proposals are accepted only while edit
     mode is on. This is a deliberate trust change: a malicious book script
     could propose content edits to its own project's chapter files, within
     annotated ranges, bounded by path-safety gates, visible on screen, and
     recoverable via snapshots/recovery sidecars.
6. **The edit module ships as a separate preview-only bundle**
   (`gutterpress-edit.js`); published books carry no edit code.

## Consequences

- Keystroke-to-screen is native contenteditable (no build, no debounce);
  keystroke-to-disk is the autosync debounce + commit gates. Undo is native
  — source follows the DOM wherever it moves; no undo journal.
- The UX contract's "source pane remains the default editing model" rule is
  superseded: inline editing is the default (`preview.inlineEditing` is a
  kill switch, default ON). The pane survives as an on-demand source view
  and the degrade surface, alongside the block overlay.
- `rerender-ci` keeps its meaning (pane saves and external edits still
  rebuild+swap); inline-editing latency is gated separately
  (`edit-physics.test.ts` tripwires, `roundtrip-gate.ts` in CI).
