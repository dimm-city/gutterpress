# Inline editor: library evaluation and content-loss spike

**Status:** evaluation, not a decision. Written 2026-08-15 to answer two
questions raised against the hand-written inline-editing implementation on
`claude/previewer-architecture-overhaul-l9awpz`:

1. Would an off-the-shelf editor framework make the inline editor simpler to
   build and maintain?
2. If such a framework loses content it does not understand, is that fixable —
   and is there a library that fixes it better?

The premise these are measured against is the product owner's: **the inline
WYSIWYG surface is the primary authoring experience**, and markdown is the
storage format that keeps advanced direct editing possible. Anything that
makes the inline experience worse is the thing that has to justify itself.

## Summary

- Content loss is **not** a property of the editor library. It is a property of
  the integration. A ProseMirror schema plus an automatic opaque-node fallback
  round-trips the entire example corpus with **zero words lost** (30/30 files)
  while keeping **95.7% of block nodes richly editable**.
- Lexical also loses zero words — but only because it does not model the
  constructs at all. **21.9% of its blocks show raw markdown as prose** (tables
  as pipe-text, `@section .lede` as a paragraph). Nothing signals it happened.
- The decisive difference is **detectability**, not fidelity. `prosemirror-markdown`
  *throws* on a token it has no handler for, so the integration can route it to
  a flagged fallback. Lexical's importer silently demotes the line to text.
- Everything still forcing a fallback is **tables and footnotes**. Tables have
  an off-the-shelf answer (`prosemirror-tables`, MIT, actively maintained);
  footnotes are a small custom node.

## The spike

Scripts under `packages/cli/` were not touched. The spike is standalone and
runs against the real corpus: `examples/gutterpress-user-guide`,
`examples/gutterwire-zine`, `examples/with-validation`,
`examples/with-design-guide/{book-01,book-02,design-guide}`, and
`docs/fixtures/css-authoring-spike/book` — 30 markdown files.

### What was tested

Not "write a handler for every token". The mechanism is:

> Wrap the tokenizer. For every top-level token run whose types — or whose
> inline children's types — have no schema handler, splice the run out and
> replace it with one synthetic token carrying the verbatim source slice. That
> becomes an atom node which serializes back byte-for-byte.

Loss becomes structurally impossible: anything unmodelled degrades to an
intact, non-editable block rather than vanishing.

Critically, `prosemirror-markdown`'s `MarkdownParser` accepts an **external
markdown-it instance**. Gutterpress's configured parser — markers, attrs,
footnote, deflist, and every user plugin — stays the single pipeline. There is
no second parser and no dual-parser drift.

### Results

| | RUN 1: stock CommonMark | RUN 2: + Gutterpress nodes |
|---|---|---|
| parsed + serialized | 30/30 files | 30/30 files |
| **content preserved** | 22/30 files, 39 words lost | **30/30 files, 0 words lost** |
| byte-identical | 15/30 files | 7/30 files, 133 words added |
| richly editable | 92.2% of top-level runs | **95.4%** |
| opaque fallback | 7.8% | 4.6% |

RUN 2 adds `marker_wrap` / `marker_atom` for `@chapter`/`@section`/`@page`/
`@spread`, definition lists, the `s`/`sub`/`sup`/`mark`/`abbr` marks, an
inline raw node for `html_inline`, and an attribute slot so markdown-it-attrs'
`{#id .class}` braces survive. That is roughly 120 lines of schema.

The 133 added words are canonical `@end <kind>` terminators the serializer
emits unconditionally. Markers auto-close, so the terminator is optional
syntax; emitting it always is a formatting normalization, not content change.
Recording whether the source had an explicit terminator would remove it.

### Two defects the spike found

Both are the exact class of bug that makes silent corruption, and both are
worth carrying into any implementation:

1. **Marker lines were being dropped from opaque slices.** Marker tokens
   deliberately carry no `token.map` (setting it would make
   markdown-it-source-map stamp `data-source-line` on the wrapper and break
   scroll-sync — see ADR 0009); they thread the line on `token.meta` instead.
   Deriving an opaque slice from `token.map` alone starts it *below* its own
   `@section` line. Fixed by reading `meta.line` too, and by tracking a
   line cursor so any gap a preceding run failed to cover is swept into the
   next verbatim slice rather than lost.
2. **`@end …` terminators were being dropped.** Close tokens carry neither
   `map` nor `meta`, so an opaque run stops one line short of its own
   terminator.

Neither would have been caught by a byte-diff on a small fixture. Both were
caught by a word-multiset difference over the whole corpus.

### What still forces a fallback

Complete list of causes in RUN 2 — nothing else appears:

| cause | occurrences |
|---|---|
| table tokens (`table`/`thead`/`tbody`/`tr`/`th`/`td`) | 1,296 |
| footnote tokens (`footnote_ref`/`_anchor`/`_open`/`_block_*`) | 15 |

Tables account for essentially all of it. `prosemirror-tables` (MIT, v1.8.3,
actively maintained by the ProseMirror org) is the off-the-shelf answer, and
takes the fallback rate to near zero. Footnotes are a small custom node.

The fallback is also coarser than it needs to be: a whole `@section` containing
a table becomes one opaque block, taking its paragraphs and fences with it. So
4.6% is an **upper bound**, not a floor.

## Alternatives considered

### Lexical (Meta, MIT)

Measured on the same corpus with the same metric.

| | ProseMirror + fallback | Lexical |
|---|---|---|
| block nodes | 933 | 1,165 |
| **modelled** | **95.7%** | 78.1% |
| not modelled | 4.3%, flagged as opaque | **21.9%, silently shown as prose** |
| words lost | 0 | 0 |
| unknown-construct signal | throws — routable | none |
| markdown parser | Gutterpress's own markdown-it | a second, independent one |

Lexical's zero word loss is not the win it appears to be: a no-op is also
lossless. `@lexical/markdown` is a line-oriented regex transformer list
(`MarkdownImport.ts`), and a line no transformer claims is appended as a
literal-text paragraph. Concretely, across the corpus:

- 112 marker lines rendered as prose (`@section .lede` as a paragraph)
- 86 raw-HTML blocks as prose
- 30 table rows as prose — **no table node type is produced at all**
- 27 attribute braces as prose

Its block-type census tells the same story: 644 paragraphs versus ProseMirror's
380, because unmodelled constructs get shredded into prose paragraphs.

The higher block count (1,165 vs 933) is itself part of the finding, not a
denominator artefact to correct for: ProseMirror nests content inside
`marker_wrap`, Lexical flattens everything to root children.

It is also a second markdown parser. Gutterpress's markers, attrs, deflist,
footnotes and every user plugin are markdown-it plugins; Lexical cannot consume
them, so every construct would need reimplementing as a Lexical transformer and
kept in sync forever. That is the dual-parser trap, and it is the single most
expensive thing this evaluation found.

### Milkdown

ProseMirror-based, so it inherits the same schema-and-fallback story — but its
markdown layer is **remark**, not markdown-it. Same dual-parser problem as
Lexical, with the added cost that Gutterpress's plugins are markdown-it
plugins by architectural rule (CLAUDE.md §5). Rejected on that basis alone.

### BlockNote

Built on Tiptap, built on ProseMirror — one more abstraction layer over the
thing that actually does the work, and its Notion-style block model is a
stronger opinion about document shape than a paged book wants. Its
collaboration focus is not a need here.

### Slate

Schema-less by design. The whole safety argument above depends on a schema
being the place unknown constructs are detected. Rejected.

### CKEditor 5 / TinyMCE / Quill

CKEditor 5 is GPL-or-commercial, which does not fit an MPL-2.0 project. Quill
and TinyMCE are HTML-first editors without a markdown document model; both put
us back to writing an HTML→markdown serializer, which is the thing we are
trying to stop maintaining.

### Turndown / rehype-remark

Not editors — HTML→markdown converters. They would replace only the serializer
half, and they are open-set by design (best-effort on anything), which is the
opposite of the closed-set, refuse-by-default property that makes bad writes
impossible. They cannot detect "I did not understand this".

## Does Tiptap earn its layer?

Both spikes ran on **raw ProseMirror**, not Tiptap. Measured minified+gzipped
browser bundles:

| | minified | gzipped |
|---|---|---|
| raw ProseMirror (state/view/model/markdown/commands/keymap/history) | 321 KB | 113 KB |
| Tiptap core + StarterKit | 381 KB | 121 KB |

So bundle size is not an argument either way — Tiptap costs about 8 KB gzipped
over the packages it wraps. The real question is layering. Tiptap buys an
extension ecosystem and UI conveniences; it also puts a second API between us
and the schema, which is exactly where all the Gutterpress-specific work lives.
Given CLAUDE.md's complexity-reduction mandate, raw ProseMirror is the smaller
commitment, and Tiptap can be adopted later without redoing the schema — its
extensions are ProseMirror schema definitions.

## Editing physics (Spike B, previously run)

Raw ProseMirror mounted over a live paginated `.gp-strip`, 200 pages:

```
before mount : 200 pages, 1 strip(s), 600 paragraphs
PM parsed    : 600 top-level nodes
after mount  : 200 pages, 200 sheets, 600 paragraphs, contenteditable=true
typing (PM transaction + forced reflow): median 2.70ms  p95 8.80ms  (n=40)
after Gutterpress.refresh(): 201 pages, 600 paragraphs, PM view alive=true
```

Pagination survives the mount, typing stays well inside a frame budget, and a
viewer refresh does not kill the view. ProseMirror does revert DOM mutations it
did not author, so the fragmenter's node moves have to happen outside a
transaction or be reflected into the view — but the fragmenter moves nodes
**once at mount**, after which pagination is pure CSS multicol.

## What this does not settle

This evaluation deliberately stops short of a recommendation to rewrite. It
establishes that:

- the content-loss objection to a schema-based editor is answerable, and the
  answer is measurable (0 words lost, 95.7% modelled);
- the answer is an *integration* pattern, not a library choice;
- among libraries, staying on markdown-it — which means ProseMirror — is worth
  more than any feature difference between the candidates.

Whether to adopt it in place of the hand-written serializer is a product-owner
call, and should weigh the ~2,300 lines of bespoke serializer/edit-mode code it
would replace against the cost of a schema migration on a shipped branch.

## Reproducing

The spike is standalone (`prosemirror-markdown`, `prosemirror-model`,
`@lexical/*`) and imports the repo's real
`packages/cli/src/lib/markdown/renderer.ts` so it measures the actual
configured parser:

| script | what it reports |
|---|---|
| `lossless.ts` | RUN 1 / RUN 2 content-loss and fallback rates |
| `whatlost.ts` | word-level diff of anything that vanished |
| `pm-modelled.ts` | ProseMirror block census on the shared denominator |
| `lexical-lossless.ts` | Lexical control arm, same metric |
| `lexical-modelled.ts` | Lexical block census + raw-syntax-as-prose leaks |
| `attrcensus.ts` | which authored attributes ride on which tokens |
