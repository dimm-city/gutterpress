# ADR 0011 — the Galley editor: one document model, two projections

Date: 2026-08-15 · Status: accepted · Supersedes ADR 0010's mechanism (the
Galley *goal* stands; the machinery changes)

## Context

ADR 0010 shipped HTML-first inline editing by making the rendered DOM
editable and reverse-engineering markdown from it. That forced every hard
subsystem the branch grew: a 1,226-line closed-set DOM→markdown serializer,
per-block patch proposals with range-shift bookkeeping, expected-slice
commit gates, and a converge-on-drift verifier healing the screen against
background re-renders — all because the screen and the file were **two
independent truths** needing reconciliation.

A measured evaluation (docs/inline-editor-library-evaluation.md) showed the
"editor frameworks lose content" objection is an integration property, not
a library property: a ProseMirror schema plus an automatic opaque-atom
fallback round-trips the whole corpus with **zero words lost** while
keeping ~96% of blocks richly editable — and `prosemirror-markdown`
consumes Gutterpress's own markdown-it token stream, so there is exactly
one parser in the product. The product owner then directed the rebuild:
anchor everything to the best inline editing UX; markdown is the storage
format.

## Decision

1. **One truth: the ProseMirror document.** The server parses each chapter
   with the real pipeline (all plugins) and ships the token stream
   (`/__galley/book`). The frame builds one doc — a `chapterFile` wrapper
   per source file — and both the screen (Tiptap render, viewer-paginated)
   and the files (whole-chapter serialization) are projections of it.
   Screen↔file drift is impossible by construction; the ADR 0010 verifier,
   `/__chapter` healing, and drift-degrade machinery are deleted, not
   maintained.

2. **The editor's `view.dom` IS the fragmenter's flow root.** The viewer
   paginates by moving the flow root's element nodes into per-run multicol
   strips — the same element references every time. ProseMirror's view
   descriptors track references, not paths, so with its DOMObserver
   detached around each fragmenter pass (`withFragmenter`) and ParseRule
   ignores for viewer chrome, editing and pagination compose without either
   subsystem changing. `fragment.ts`/`decorate.ts` are untouched.

3. **Zero loss is structural.** Token runs without schema handlers escalate
   to verbatim opaque atoms (recursively — a table inside a `@section`
   degrades alone); lines plugins consume without tokens (reference-link /
   abbr definitions) are swept into opaque atoms via line-coverage
   accounting; unmapped `@end-section` terminators are recovered
   explicitly. Opaque atoms DISPLAY through the real renderer
   (`/__galley/fragment`) and edit as source via the block overlay. The
   corpus gate holds all of this at zero lost words.

4. **Untouched blocks keep their bytes.** Source slices are recorded per
   node identity at build; ProseMirror's persistent tree keeps untouched
   nodes identical across transactions, so an unedited paragraph re-emits
   its original bytes (hard-wraps, `--` spellings, brace placement intact)
   while edited blocks serialize canonically. The reverse-typographer maps
   pipeline glyphs back to authored spellings.

5. **Saves are whole-file proposals through the existing write path.**
   `galleyContent {chapter, markdown, expected}` commits as ONE whole-file
   range patch via the unchanged commit engine — safe-chapter, generation,
   expected-slice, conflict reconciliation, and `origin:"inline-edit"`
   rebuild suppression all intact. A failed gate is surfaced, never
   retried blindly.

6. **Protocol v8.** `setEditMode` / `getSelectionState` /
   `applyInlineFormat` keep their v7 shapes; `galleyInsertMarkdown` /
   `galleySetOpaqueSource` / `galleySaveNow` / `galleyTargetAt` are new;
   the patch/ack/drift lifecycle is gone. Snippets and the media gallery
   keep their markdown-text insertion contract, now landing at the caret
   in the page.

7. **Published output carries no editor.** `gutterpress-galley.js` is a
   separate preview-only bundle (the old edit bundle's slot), injected only
   by the preview server; builds ship the viewer bundle alone, and the
   published-output guard asserts it.

## Consequences

- ~4,300 bespoke lines (serializer, edit module, drift/patch machinery and
  their tests) are replaced by ~1,600 lines of codec+editor riding on
  Tiptap/ProseMirror (MIT), plus the corpus gate.
- Tables become inline-editable for the first time; typing gains markdown
  input rules; undo/IME are ProseMirror's (model-level, relayout-proof).
- Editing works across chapter boundaries in one surface (one caret, one
  history); each chapter still saves to its own file.
- The frame bundle grows to ~580 KB minified (preview-only; never in
  published books or the SPA).
- Canonicalization is scoped to edited blocks; the one deliberate
  normalization is structural (`@end-section` emitted for every section,
  blank-run collapse at block boundaries).
- CLI browser preview stays read-only (no bridge host → readonly mount);
  the desktop kill switch (`preview.inlineEditing`) survives, now flipping
  the frame between readonly and editing mounts.

## Rules preserved

CLAUDE.md §1 (no runtime bundlers — Tiptap/PM are libraries, bundled at
build time into a committed asset), §5 (plugins stay plain markdown-it —
their tokens flow through the single pipeline; unknown output degrades to
rendered-but-opaque, never lost), §8 (the SPA gains zero dependencies; all
editor code lives in the frame bundle).
