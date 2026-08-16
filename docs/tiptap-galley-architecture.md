# Galley v2: Tiptap + prosemirror-markdown as the inline editing core

**Status:** implemented 2026-08-15 (ADR 0011) — kept as the design rationale. Follows
[`inline-editor-library-evaluation.md`](./inline-editor-library-evaluation.md)
(the measured spike: 0 words lost over the corpus, 95.7% of blocks richly
editable, escalation fallback proven). This document is the end-to-end
answer to: *how does the editor work with plugins, snippets, the media
gallery — and how much of the current design does it simplify?*

Anchor (product owner): **the best HTML editing UX possible.** The paginated
book is the editing surface; markdown is the storage format that keeps
direct source editing possible for advanced users. Anything that makes the
inline scenario harder must justify itself.

---

## 1. The inversion: one model, two projections

The current branch edits the *rendered DOM* and reverse-engineers markdown
from it. That forces every hard subsystem it contains: a 1,226-line closed-set
DOM→markdown serializer, block-scoped patch proposals with range-shift
bookkeeping, expected-slice commit gates, and a converge-on-drift verifier
that re-renders chapters in the background to heal the screen — because the
screen and the file are **two independent truths** that must be reconciled.

The proposed design has **one truth: the ProseMirror document.**

```
                       ┌──────────────  markdown file (storage)
   parse (load) ──────►│
                       │   PM doc  ◄── the single model; Tiptap edits it
   serialize (save) ◄──│
                       └──────────────► screen (toDOM + nodeViews, paginated by CSS)
```

- **markdown → doc**: the server parses with Gutterpress's own markdown-it
  instance (all plugins loaded) and ships the **token stream** to the frame;
  the frame runs the escalation pass (unknown token runs → one opaque atom
  carrying the verbatim source slice) and `prosemirror-markdown`'s token
  handlers. One parser, ever. Tiptap's own markdown layer (marked-based) is
  **not used** — that would be the dual-parser trap.
- **doc → markdown**: the `MarkdownSerializer` node/mark functions from the
  spike. Deterministic, pure JS, runs in the frame. Saving writes the
  **whole chapter file** — no block patches, because the model covers the
  whole file (opaque atoms round-trip their slices byte-exact).
- **doc → screen**: Tiptap's `EditorView` renders into the viewer's strip
  container; CSS multicol paginates it exactly as it paginates the current
  viewer DOM (Spike B: 200 pages before and after mount, typing median
  2.70 ms, `Gutterpress.refresh()` survives). Sheets, margin boxes, and
  running heads stay viewer chrome built *around* the editor mount.

Screen↔file drift is impossible **by construction** — both are projections
of the same doc — so the verifier, `/__chapter` revival, `editDrift`
events, repeated-drift degrade tracking, and the "heal the focused block
later" machinery all disappear rather than get maintained.

What CAN still diverge is the editor's rendering vs the print renderer's
rendering of the same markdown. That is bounded two ways:

1. **Core nodes emit the renderer's documented DOM contract** — the same
   `.page`/`.section`/`.chapter`/`gp-*` classes `markers.js` emits, computed
   by shared pure helpers extracted from `markers.js` so the two cannot
   drift silently. The book's CSS then styles both identically.
2. **Everything else is rendered BY the renderer.** Opaque atoms display via
   a read-only nodeView whose innerHTML comes from a `render-fragment`
   server route (the real pipeline, plugins included). Unknown content
   doesn't just survive — it *looks exactly right*, because the thing on
   screen is the renderer's own output.

The preview↔print parity gate stays, and a new editor-side contract test
renders core constructs through both paths and diffs DOM shape.

## 2. End-to-end flows

**Load.** Open project → server parses chapter files → token streams → frame
builds one doc per chapter → Tiptap mounts into the strip containers →
viewer builds sheet chrome around them. (The fragmenter's "move nodes once
at mount" step is replaced by "PM renders into the strip" — same physics.)

**Type.** Keystroke → PM transaction → DOM update → CSS reflow (~3 ms
measured). No rebuild, no WebSocket, no iframe swap. Input rules fire as
you type (`**bold**`, `# `, `- `, `> `). Undo is PM history — model-level,
IME-safe, unaffected by relayout.

**Save.** Debounced on the existing ~500 ms autosave cadence: doc →
markdown string → bridge → the existing buffer/save path with
`origin: "inline-edit"` (watcher echo-suppression kept, rebuild suppression
kept). Whole file. The commit gates that survive are the ones about *files*
(buffer freshness, conflict detection); the ones about *text splicing*
(expected-slice match, range arithmetic) have nothing left to guard.

**External change** (git pull, other editor): unchanged surface — clean
session reloads (re-parse → new doc, position preserved); dirty session gets
the existing conflict prompt.

**Source view / CSS edit.** The on-demand CodeMirror pane stays fully
functional, as does the classic rebuild+swap path behind it. Its toolbar,
marker completions, and token-splicing helpers remain — they serve the
source view.

**Opaque blocks** (raw HTML, plugin structures not yet modelled): rendered
perfectly (see above), not inline-editable. Click → `BlockEditOverlay` (the
shipped source micro-editor, reused as-is) → edit the markdown slice →
re-parse through the pipeline → replace the atom. The overlay stops being a
"degrade" path and becomes the *designed* editing surface for
source-granularity content.

**Build / PDF / publish.** Untouched. They render from source through the
same pipeline they always did; the editor is not in that path.

## 3. Feature-by-feature

### Plugins (markdown-it — CLAUDE.md §5 unchanged)

Plugins stay plain markdown-it plugins with zero new API. Because parsing is
the server's markdown-it instance, **every plugin's syntax keeps working in
the editor automatically**:

- Their tokens flow into the doc build. Token types with schema handlers
  become rich nodes; everything else escalates to an opaque atom — displayed
  via the real renderer, source-editable, never lost. A plugin's content can
  *never* blank the page or vanish (the loader's degrade-and-report preview
  contract extends naturally: a broken plugin skips, the doc still builds).
- Project component markers (`@sidebar`, `@callout`) tokenize through the
  same `parseMarkerLine` machinery core markers use; whatever tokens the
  plugin transforms them into are unknown to the schema → opaque → rendered
  chrome intact. **v2 option** (not required): a generic component nodeView
  that renders the plugin's chrome around a `contentDOM`, making wrapping
  components structurally editable without any plugin-side code.
- First-party Tiptap extensions exist only for what core owns: the marker
  family, tables, footnotes, images, attrs. That is the boundary CLAUDE.md
  already draws — core owns structural markers; plugins add branded ones.

### Snippets (#29)

`SnippetPicker` already owns no editor knowledge — it resolves
`{{variables}}` and calls `onInsert(finalMarkdownText)`. That contract is
exactly right and **does not change**. The insertion target becomes a bridge
command `insertMarkdown(text)`: server tokenizes the fragment → frame builds
a slice → `insertContent` at the cursor. Snippets remain plain markdown
files in `snippets/` — portable, source-editable, nothing proprietary.

Unlocked (cheap, later): Tiptap's suggestion utility gives a `/` slash menu
in the page — type `/` and pick a snippet, marker, or image inline without
leaving the keyboard. The picker panel stays for browsing/managing.

### Media gallery (#47)

`MediaPanel` keeps its host routes (`media/import-image`, `thumbnail`), its
print-readiness guidance, and its UI. Insert paths:

- **Insert button / drag from panel**: same markdown-text contract as
  snippets (`![alt](assets/x.jpg){.gp-right}` → `insertMarkdown`), or a
  first-class `insertImage(attrs)` command — either lands as an image node.
- **Drop from OS**: Tiptap `handleDrop` → existing `import-image` route
  (copies into `assets/`, returns the relative path) → insert node.
- **Editing a placed image**: selecting an image node drives the bubble's
  image mode (position/size facets, properties dialog). Facet changes are
  `updateAttributes` on the node — **model data, not string splicing**. The
  385-line token-preserving `{…}`-suffix splicer stops being the inline
  path's dependency (it stays for the source view); the serializer emits the
  braces. Unknown classes/ids/keys ride along verbatim in the attrs slot the
  spike proved.

### Formatting bubble & toolbar verbs

`FormattingBubble.svelte` stays presentational (SPA side, over the iframe).
Its inputs upgrade from `document.queryCommandState`-era plumbing to
`editor.isActive('bold')` etc.; its verbs go from `execCommand` (deprecated,
quirky, one of the current branch's real defect sources) to
`chain().toggleBold().run()`. Headings/lists/quote toggles become available
to the bubble and context menu for free (StarterKit commands).

### Markers (insert + edit)

- **Schema**: `marker_wrap` (chapter/section/page/spread — content-bearing)
  and `marker_atom` (breaks, continuations) from the spike, grown into
  extensions whose `toDOM` uses the shared emit helpers.
- **Input rules**: typing `@section ` or `@break` on an empty line converts
  to the node as-you-type — the marker vocabulary becomes discoverable in
  the page, matching how markdown shortcuts feel.
- **Insert menu / context menu**: commands (`insertMarker(kind, attrs)`),
  replacing splice-into-text actions for the inline surface.
  `marker-completions.ts` stays with the source view.

### Tables — a new capability, not just parity

Today tables are **not inline-editable at all** (the closed-set serializer
refuses them; they were 100% of the spike's residual fallback). Tiptap's
Table extension (over `prosemirror-tables`, MIT, actively maintained) makes
them first-class: tab between cells, add/remove rows, merge — and the
serializer writes pipe tables back. This single extension converts the
largest remaining "sorry, edit the source" category into direct editing.

### Footnotes, deflists, the small stuff

`markdown-it-footnote`/`deflist`/`sub`/`sup`/`mark`/`abbr` tokens map to
small nodes/marks (spike RUN 2 already carries most). Footnotes can ship
opaque in v1 (10 occurrences in the corpus) and get a proper node pair
later.

### Find, selection, scroll-sync

The in-page find decorates the live DOM; PM's DOM is still DOM — v1 keeps
it (the `__GP_FIND_ACTIVE__` guard stays until find is ported to PM
decorations, its natural home). Scroll-sync's `data-source-line` reads keep
working: nodes know their source positions at parse; the annotation story
simplifies to node attrs rather than a markdown-it plugin threading maps
through HTML.

## 4. Where code runs (§8 / ADR 0004 map)

- **Frame bundle** (`build-engine-bundles.mjs`, alongside the viewer):
  Tiptap core + StarterKit + Table, `prosemirror-markdown`'s
  parser/serializer configs, the schema/extensions, the escalation pass.
  All MIT, all browser-target libraries — no bundler enters the runtime
  (§1 untouched), and the SPA bundle gains **zero** dependencies
  (PWA-clean, §8 untouched).
- **Server routes** (thin, pattern (A)): `parse-tokens` (chapter → token
  JSON), `render-fragment` (markdown slice → HTML for opaque nodeViews +
  overlay preview). Both are ~30-line wrappers over the existing renderer.
- **Bridge** (protocol v9, *smaller* than v7): `setEditMode`,
  `insertMarkdown`/`command`, `contentChanged(markdown)` out,
  `selectionState` out. Deleted: `editPatches`/`ackEditPatches`/
  `verifyChapter`/`editDrift`/`flushEditState` and the patch-ack lifecycle.
- **SPA**: `inline-edit-session` shrinks to: subscribe `contentChanged` →
  debounce → save through the buffer path; wire bubble/menus to commands.

## 5. Fidelity plan (what "markdown is storage" means concretely)

1. **Nothing can vanish.** The escalation invariant — any token run without
  a handler becomes a verbatim atom — is CI-gated by promoting the spike's
  corpus run to the round-trip gate (replacing the current serializer-based
  gate; same corpus, same zero-loss bar, plus the two regression cases the
  spike caught: meta-only marker lines, `@end` terminators).
2. **Untouched blocks keep their bytes.** Cheap because PM gives structural
  equality: at parse, stash each top-level node's source slice
  (`token.map`); at serialize, re-parse the stash and emit it verbatim iff
  `node.eq(parsed)` — else canonical. This recreates the hand-written
  serializer's "three tiers" at ~40 lines, and means an untouched paragraph
  never rewraps and an untouched table never reformats.
3. **Typed characters serialize like an author typed them.** The
  reverse-typographer table (already in `selection-search.ts`) runs over
  serialized text runs so `’`/`“` from the typographer parse write back as
  `'`/`"`.
4. **Canonicalization is scoped to what you touched.** Editing a block
  rewrites that block canonically (accepted product behavior since the
  Galley decision); the `node.eq` layer keeps it from spreading to the rest
  of the file.

## 6. Simplification ledger

Deleted or replaced (bespoke code, current branch):

| unit | lines | fate |
|---|---:|---|
| `serialize.ts` + testkit + tests | 1,711 | → `prosemirror-markdown` configs (~450 incl. schema) |
| `engine/edit/index.ts` + tests | 1,431 | → Tiptap mount + glue (~200) |
| `edit-live` / `edit-physics` tests | 446 | → one mount-integration test (~150) |
| converge-on-drift verifier, `/__chapter` revival, drift/degrade handling | (inside above) | deleted — impossible by construction |
| `roundtrip-gate.ts` | 261 | → spike-based PM gate (~150) |
| `inline-edit-session.ts` | 201 | → ~80 |
| commit-engine expected-slice/range machinery | ~100 | deleted; file-level gates stay |
| bridge v7 edit-patch lifecycle | ~200 | → ~60 (v8) |
| execCommand formatting path | (inside edit module) | → Tiptap commands |
| **total bespoke** | **~4,350** | **~1,100** |

Kept, unchanged: markdown-it pipeline + plugin loader + vendoring;
`markers.js` (plus small pure-helper extraction); viewer/fragmenter for
read-only surfaces; parity gate; `BlockEditOverlay` (promoted);
`SnippetPicker`; `MediaPanel`; source-view editor stack (CodeMirror,
toolbar, completions, splicers); buffer/conflict/recovery machinery;
build/PDF path.

Added dependencies (frame bundle only): `@tiptap/core`, `@tiptap/starter-kit`,
`@tiptap/extension-table`, `@tiptap/pm`, `prosemirror-markdown`. ~120 KB
gzipped in the frame; 0 KB in the SPA. All MIT.

Net: **~3,200 fewer bespoke lines**, one document model instead of two
reconciled truths, and the highest-risk subsystems (DOM→markdown inference,
drift healing, patch-range arithmetic) removed rather than hardened. UX
gained: input rules, editable tables, reliable undo/IME, slash-menu
potential, sturdier image editing.

## 7. Risks and the two spikes that remain

| risk | status / mitigation |
|---|---|
| Typing perf, refresh survival on paginated surface | **Measured GO** (Spike B: 2.70 ms median, 200 pp) |
| Content loss | **Measured zero** (Spike C + CI gate) |
| toDOM ≠ renderer DOM for core nodes | shared emit helpers + contract test + parity gate |
| Caret/selection across page (column) boundaries under PM | **spike 1**: arrow-key nav, click, and shift-select across a boundary in the real viewer chrome |
| Sheet chrome rebuild around a live PM view on growth/shrink | **spike 2**: type until a page overflows; assert sheets rebuild and view survives (Spike B's refresh() suggests yes) |
| Whole-file canonicalization surprising authors | `node.eq` byte-preservation + reverse-typographer (§5) |
| Tiptap version coupling (`@tiptap/pm` pins PM) | accepted; all PM imports go through `@tiptap/pm/*` |

## 8. Phasing

1. **Core swap (kill-switch kept).** Frame bundle (schema + escalation +
   mount), parse/render-fragment routes, whole-file save through the
   existing path, spikes 1–2, PM round-trip gate replaces the serializer
   gate. Behind `preview.inlineEditing`.
2. **Feature parity + upgrades.** Bubble/context-menu on commands; snippets
   + media `insertMarkdown`; image node attrs; Table extension; marker input
   rules + insert commands.
3. **Deletions + governance.** Remove the superseded stack (ledger above);
   ADR 0011 supersedes ADR 0010 (the Galley model stands; the mechanism
   changes from "edit the rendered DOM, infer markdown" to "edit the
   document model, project both ways"); CLAUDE.md §5/§8 notes confirming
   the boundaries this design preserves.
4. **UX dividends.** Slash menu, footnote nodes, generic component
   nodeViews for plugin markers, (later) collab via the PM ecosystem.
