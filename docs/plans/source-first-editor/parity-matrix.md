# SFE-P3d-parity — Parity matrix (point-in-time evidence record)

> **This document is a POINT-IN-TIME EVIDENCE RECORD, not a machine-read
> contract.** It has no checker. `tools/check-parity.mjs` and
> `tools/check-parity.test.mjs` — the standing gate that used to re-derive
> the `Action` column from live source and re-verify every row on each CI
> run — were deleted by product-owner ruling (SFE-P3e,
> `docs/plans/source-first-editor/runs/SFE-P3e.md`, "Product-owner ruling"):
> a standing static-analysis gate over a surface P4 is about to delete is
> machinery this program does not need. This document is not re-verified
> mechanically any more; it stands as the record that justified P4's
> deletion decision.

## Why this document exists

P4 deletes `InlineEditController`, `CommitEngine`, the context menu, and the
preview mutation protocol. It may do so only because this run proved every
authoring action reachable through those paths had a working replacement in
source mode, rich mode, or both — see the run specification
(`docs/plans/source-first-editor/runs/SFE-P3d-parity.md`).

The **13** mutation-capable preview actions listed below — 12 from
`context-menu-controller.svelte.ts`'s items and 1 (`block-edit`) from
`inline-edit-controller.svelte.ts` — were extracted and verified against the
source at the commit that closed SFE-P3d-parity (`b9ca42a9`, "fix(p3):
address review findings (round 1)"). Each row's **Replacement command(s)**
are exercised by the **Test evidence** tests named in that row. Those tests
are ordinary behavioral tests, not part of this document's own machinery:
they REMAIN in the suite and keep running in CI via the ordinary workspace
test jobs — `bun run test` in `packages/desktop` for every citation except
`tests/standard/wrap-toggles.test.ts`, which runs in `packages/editor`'s own
test job — they are
what actually proves each replacement works. This table is the map from the
deleted preview surface to that evidence, not a second proof of it.
**Exception, recorded 2026-09-01 (SFE-P4):** the `block-edit` row's first
citation was retired that run — see the "SFE-P4 status note" below the
table's introduction for the surviving evidence.

The rows and their test citations are kept exactly as SFE-P3d-parity Lane D
verified them — not renumbered or reworded — because they are the evidence
this record exists to preserve.

## SFE-P4 status note (2026-09-01)

The rows below are kept verbatim, per the note above, as the point-in-time
record SFE-P3d-parity produced. One citation in the `block-edit` row no
longer resolves: `packages/desktop/tests/editor/rich-mode-commit-integration.test.ts`
was deleted in SFE-P4 (`731aee7e`, "refactor(p4): delete the desktop side of
preview editing") along with `CommitEngine`, the mechanism it tested. This
does not weaken the `block-edit` mapping — the capability it proved
(exact-bytes/locality writes through `DesktopDocumentHost.applyEdit`, the
same D3 seam every source/rich command in this matrix uses) is still
exercised end-to-end, now by:

- `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts` — the
  exact-bytes/locality proof through the same `applyEdit` seam, and
- `packages/desktop/tests/editor/parity-replacements.test.ts` (the row's
  surviving second citation) — the multi-line block-replacement case that
  was `rich-mode-commit-integration.test.ts`'s one addition beyond the
  shared seam.

`row 44`'s text is left unedited by design (see "The rows and their test
citations are kept exactly..." above); this note is the correction of
record. `parity-replacements.test.ts` was also fixed this run so its own
header/comments cite this surviving evidence directly instead of deferring
to the deleted file.

## Mapped actions

| Action | Replacement command(s) | Surface(s) | Test evidence |
|---|---|---|---|
| `block-edit` | `source-editor#direct-text-edit`; `rich-editor#direct-text-edit` | source editor (direct text edit — CodeMirror, any selection replacement); rich editor (direct text edit — the mounted rich surface, ordinary typing/editing, P2a) | `packages/desktop/tests/editor/rich-mode-commit-integration.test.ts::an out-of-band commit-engine write reaches richDocHost, and a subsequent rich command builds on it instead of reverting it`; `packages/desktop/tests/editor/parity-replacements.test.ts::replacing a whole paragraph block's text changes exactly that block and nothing else` |
| `marker-edit` | `source-editor#direct-text-edit` | source editor (direct text edit — select the marker's own line, retype it; no rich-mode verification this run, see note below) | `packages/desktop/tests/editor/parity-replacements.test.ts::replacing a @section marker's own line changes exactly that line, byte for byte` |
| `page-marker-edit` | `source-editor#direct-text-edit` | source editor (direct text edit — select the enclosing page/spread/chapter marker's own line, retype it; no rich-mode verification this run, see note below) | `packages/desktop/tests/editor/parity-replacements.test.ts::replacing a @page marker line found through pageMarkerItems' own resolution shape changes only that line` |
| `block-break-before` | `toolbar-actions.ts#applyPageBreak`; `rich-commands.ts#page-break` | source toolbar (Page break, caret placed on the block immediately BEFORE the target — one command, positional convention); rich toolbar (`applyRichLayoutBlock('page-break')`, live caret at the target block's own start) | `packages/desktop/tests/editor/parity-replacements.test.ts::caret on the line before the target block inserts the break between them, not inside either block`; `packages/desktop/tests/editor/parity-replacements.test.ts::caret at the start of the second block inserts the break immediately before it` |
| `block-break-after` | `toolbar-actions.ts#applyPageBreak`; `rich-commands.ts#page-break` | source toolbar (Page break, caret placed on the target block's own last line); rich toolbar (`applyRichLayoutBlock('page-break')`, live caret at the target block's own end) | `packages/desktop/tests/editor/toolbar-actions.test.ts::applyPageBreak: inserts @page-break after current line`; `packages/desktop/tests/editor/rich-commands.test.ts::page-break reuses the canonical @page-break token` |
| `format-bold` | `toolbar-actions.ts#applyBold`; `commands.ts#toggle-bold` | source toolbar (Bold); rich toolbar (`routeToolbarAction("bold")` → `toggle-bold`) | `packages/desktop/tests/editor/toolbar-actions.test.ts::applyBold: wraps selection`; `packages/desktop/tests/editor/rich-commands.test.ts::toggle-bold appends a fresh **…** pair at the document end` |
| `format-italic` | `toolbar-actions.ts#applyItalic`; `commands.ts#toggle-italic` | source toolbar (Italic, underscore-canonical); rich toolbar (`routeToolbarAction("italic")` → `toggle-italic`, asterisk-canonical — a documented, deliberate rich-mode divergence, see `rich-commands.ts`) | `packages/desktop/tests/editor/toolbar-actions.test.ts::applyItalic: wraps selection with underscores`; `packages/editor/tests/standard/wrap-toggles.test.ts::partial selection: toggle-ON wraps exactly the selected text` |
| `format-strike` | `toolbar-actions.ts#applyStrikethrough`; `commands.ts#toggle-strike` | source toolbar (Strikethrough); rich toolbar (`routeToolbarAction("strikethrough")` → `toggle-strike`) | `packages/desktop/tests/editor/toolbar-actions.test.ts::applyStrikethrough: wraps selection`; `packages/editor/tests/standard/wrap-toggles.test.ts::partial selection: toggle-ON wraps exactly the selected text` |
| `format-code` | `toolbar-actions.ts#applyInlineCode`; `commands.ts#toggle-inline-code` | source toolbar (Inline code); rich toolbar (`routeToolbarAction("code")` → `toggle-inline-code`) | `packages/desktop/tests/editor/toolbar-actions.test.ts::applyInlineCode: wraps selection`; `packages/editor/tests/standard/wrap-toggles.test.ts::partial selection: toggle-ON wraps exactly the selected text` |
| `format-link` | `toolbar-actions.ts#applyLink`; `commands.ts#insert-link` | source toolbar (Link — wraps the selection as link text); rich toolbar (`routeToolbarAction("link")` → `insert-link`, same wrap-selection behavior) | `packages/desktop/tests/editor/toolbar-actions.test.ts::applyLink: selection becomes link text`; `packages/desktop/tests/editor/rich-commands.test.ts::insert-link with a NON-COLLAPSED live selection wraps the selected words instead of discarding them (SFE-P3ab review round 1, CONFIRMED finding — this used to silently replace the selection with the literal placeholder, diverging from source mode's applyLink)` |
| `image-properties` | `toolbar-actions.ts#locateImagePropertiesAtCaret`; `toolbar-actions.ts#applyImagePropertiesEdit`; `rich-commands.ts#locateRichImagePropertiesAtCaret`; `rich-commands.ts#applyRichImagePropertiesEdit` | source toolbar ("Image properties…", caret placed on an EXISTING image — `locateImagePropertiesAtCaret` resolves the target from the caret and seeds `ImagePropertiesDialog` from its current token, `applyImagePropertiesEdit` re-verifies the exact document IDENTITY (`view.state.doc` reference — see its own header, SFE-P3d-parity repair round 1) and the span's bytes, then dispatches once the dialog resolves); rich toolbar (same dialog, via `richLiveSelection()`/`richDocHost` — `locateRichImagePropertiesAtCaret`/`applyRichImagePropertiesEdit`, staleness guarded by the pre-existing `captureRichSelection`/`isRichSelectionCaptureFresh`) | `packages/desktop/tests/editor/parity-image-link-image-properties.test.ts::sees a plain image at the caret and edits its alt/size, preserving everything else`; `packages/desktop/tests/editor/parity-image-link-image-properties.test.ts::sees a wrapped image at the caret and edits its alt, leaving the link wrapper untouched`; `packages/desktop/tests/editor/parity-image-link-image-properties.test.ts::refuses with no-token when the caret is not on any image`; `packages/desktop/tests/editor/parity-image-link-image-properties.test.ts::refuses with fenced-code-block when the caret is on a markdown-shaped image inside a fenced code block`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::locates the image at the caret, applies the edit, and produces exact resulting bytes`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::an intervening edit between locate and apply refuses with EDITOR_STALE_EDIT, changing nothing`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::a FILE SWITCH between locate and apply (same EditorView, brand-new state) refuses rather than writing into the new document`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::locates the image via a real DesktopDocumentHost, applies the edit, and produces an exact resulting snapshot`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::an intervening edit before the captured version is applied refuses with EDITOR_STALE_EDIT, changing nothing` |
| `image-unwrap` | `toolbar-actions.ts#applyImageUnwrapAtCaret`; `rich-commands.ts#applyRichImageUnwrapAtCaret` | source toolbar ("Unwrap image", caret placed on a wrapped EXISTING image — single step, no dialog, so no staleness window); rich toolbar (same, via `richLiveSelection()`/`richDocHost`) | `packages/desktop/tests/editor/parity-image-link-image-unwrap.test.ts::sees a wrapped image at the caret and removes its link wrapper, leaving the image token untouched`; `packages/desktop/tests/editor/parity-image-link-image-unwrap.test.ts::refuses with no-wrapper when the caret is on a plain (unwrapped) image`; `packages/desktop/tests/editor/parity-image-link-image-unwrap.test.ts::refuses with no-token when the caret is not on any image`; `packages/desktop/tests/editor/parity-image-link-image-unwrap.test.ts::refuses with fenced-code-block when the caret is on a markdown-shaped, wrapped image inside a fenced code block`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::removes the link wrapper at the caret in one step, producing exact resulting bytes`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::refuses with EDITOR_INVALID_RANGE when the image has no wrapper to remove`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::removes the link wrapper at the caret in one step, producing an exact resulting snapshot` |
| `link-edit` | `toolbar-actions.ts#locateLinkEditAtCaret`; `toolbar-actions.ts#applyLinkEditEdit`; `rich-commands.ts#locateRichLinkEditAtCaret`; `rich-commands.ts#applyRichLinkEditEdit` | source toolbar ("Edit link…", caret placed on an EXISTING inline link — `locateLinkEditAtCaret` resolves the target and seeds the text prompt with its current href, `applyLinkEditEdit` re-verifies the exact document IDENTITY and the span's bytes, then dispatches once the prompt resolves); rich toolbar (same prompt, via `richLiveSelection()`/`richDocHost` — `locateRichLinkEditAtCaret`/`applyRichLinkEditEdit`, staleness guarded the same way as `image-properties` above) | `packages/desktop/tests/editor/parity-image-link-link-edit.test.ts::sees an inline link with a title at the caret and edits its href, preserving the title`; `packages/desktop/tests/editor/parity-image-link-link-edit.test.ts::refuses with no-token when the caret is on a reference-style link`; `packages/desktop/tests/editor/parity-image-link-link-edit.test.ts::refuses with no-token when the caret is not on any link`; `packages/desktop/tests/editor/parity-image-link-link-edit.test.ts::refuses with fenced-code-block when the caret is on a markdown-shaped link inside a fenced code block`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::locates the link at the caret, applies the new href, and produces exact resulting bytes`; `packages/desktop/tests/editor/parity-caret-token-wrappers.test.ts::locates the link via a real DesktopDocumentHost, applies the new href, and produces an exact resulting snapshot` |

### Notes on the direct-text-edit mappings (`block-edit`, `marker-edit`, `page-marker-edit`)

These three rows deliberately do **not** name a dedicated command function.
D2 states "Source mode remains available for every document, including
unsupported rich projections" as a first-class product guarantee, not a
fallback of last resort — and for these three specific actions, the ORIGINAL
preview behavior was itself nothing more than "replace this exact byte range
with author-typed text" (`InlineEditController.commit()`,
`ContextMenuController.promptEditMarkerLine()`): a whole block's prose, or one
raw `@marker` line with no internal syntax a dedicated rewrite command would
need to preserve (contrast this with `image-properties`/`image-unwrap`/
`link-edit` below, which DO need to preserve surrounding token syntax while
rewriting one part of it — exactly why those three are waived instead of
mapped this way). CodeMirror's ordinary text editing IS that replacement,
reachable today with no gap; `parity-replacements.test.ts` proves it goes
through the identical `EditorDocumentHost.applyEdit` seam every other command
in this matrix uses, with exact bytes and locality.

**Rich-mode verification gap, stated plainly:** this lane verified
`marker-edit`/`page-marker-edit`'s rich-mode reachability only as "the shared
editor's ordinary text-editing capability applies here too, by the same
general argument as `block-edit`'s rich-mode row" — it did **not** trace
whether `packages/editor/src/gutterpress/`'s marker projection (P2b) renders
a `@page`/`@section`/`@chapter` marker line as directly-retypable text in the
mounted rich view, or as some other, less directly editable widget.
`packages/editor/**` is outside this lane's write ownership and reading it in
the depth needed to verify projection behavior was judged out of scope for
this run's budget. This is flagged here rather than silently assumed; a
follow-up should confirm it directly against the mounted rich surface before
this note is removed.

## Waivers

None. The three waivers this document originally recorded —
`image-properties`, `image-unwrap`, `link-edit` — are CLOSED by
SFE-P3d-parity Lane D and now appear as mapped rows above. This section is
kept, empty and explained, rather than deleted, so a reader landing here
mid-history sees that the waivers were closed rather than finding the
section silently gone.

### How the three waivers were closed (Lane D)

Lane A's original investigation was correct: no command in either surface
edited an EXISTING image or link in place — `toolbar-actions.ts#applyImage`/
`rich-commands.ts#applyRichImageInsert` only ever INSERT a brand-new image,
and `toolbar-actions.ts#applyLink`/the rich `insert-link` command only ever
wrap a selection as a NEW link. The only path that edited an existing
image/link was the preview context menu's "Set properties…"/"Unwrap
image"/"Edit link…" (`context-menu-controller.svelte.ts`), which P4 deletes.

Lane D's closure, in one sentence per row: SOURCE MODE and RICH MODE both
now resolve the target from the CURRENT CARET/SELECTION — via
`toolbar-actions.ts`'s new `locateImagePropertiesAtCaret`/
`applyImagePropertiesEdit`/`applyImageUnwrapAtCaret`/`locateLinkEditAtCaret`/
`applyLinkEditEdit` (source) and `rich-commands.ts`'s new
`locateRichImagePropertiesAtCaret`/`applyRichImagePropertiesEdit`/
`applyRichImageUnwrapAtCaret`/`locateRichLinkEditAtCaret`/
`applyRichLinkEditEdit` (rich) — and dispatch through
`packages/desktop/src/lib/editor/caret-token-commands.ts`, a NEW shared pure
module built entirely from the tooling the original waiver already named as
sufficient: `context-menu-actions.ts`'s `findImageTokenAtOffset`/
`findLinkTokenAtOffset` (two NEW caret-based finders added alongside the
existing preview-driven `findImageToken`/`resolveLinkToken` — see that
file's header for why a caret needs a different finder than a known
rendered token) plus the PRE-EXISTING, UNCHANGED `findImageWrapper`/
`rewriteImageToken`/`rewriteLinkToken`/`spliceToken`, and
`image-classes.ts`'s setters. No new algorithm — exactly what the waiver
predicted.

**Rich mode did not need `packages/editor`.** The waiver's own text guessed
rich mode would need "resolving the selected image's own source range
inside `packages/editor`'s mount/projection layer." That turned out to be
unnecessary: `GutterpressEditorMount.getSelection()`/
`EditorMount.getSelection()` (SFE-P3ab) already report the live caret as
raw D3 SOURCE-TEXT offsets — the SAME coordinate space
`richDocHost.getSnapshot().text` uses — so the SAME `(text, offset)` pure
locate functions apply directly, with zero `packages/editor` changes
(confirmed off-limits to this lane and untouched).

**The UI-wiring half was real**, and is now three new `TOOLBAR_ITEMS`
entries (`toolbar-actions.ts`) reachable from the EditorToolbar's existing
declarative item array (no new template branch — every new item is
`kind: "action"`, rendered by the SAME generic button/More-menu code every
other action item already uses) and three new `+page.svelte` handler
functions (`handleImagePropertiesAtCaret`/`handleImageUnwrapAtCaret`/
`handleLinkEditAtCaret`) that route to whichever surface is active. Reading
the SOURCE surface's live caret from `+page.svelte` — which does not own
`MarkdownEditor.svelte` and so cannot add a getter there — uses CodeMirror's
own public `EditorView.findFromDOM(dom)` (`source-editor-access.ts`), not a
new component export; see that module's header for the full reasoning.

Each of the three refuses with a specific D14 diagnostic (never a generic
"failed") when the caret is not on an image/link: `EDITOR_INVALID_RANGE`
("no-token" — no well-formed token's span contains the caret; "no-wrapper" —
`image-unwrap` found a real image with nothing to unwrap) or
`EDITOR_UNSUPPORTED_PROJECTION` ("fenced-code-block" — markdown-shaped text
inside a fenced code span is not a real token). `image-properties`/
`link-edit` additionally refuse with `EDITOR_STALE_EDIT` if the target
document changed between locating it and applying the edit (an intervening
dialog gives real time for that) — source mode re-verifies both the exact
document IDENTITY (`view.state.doc` reference — CodeMirror's `EditorState`
is immutable, so a file switch via `switchFile()`'s `view.setState(...)` or
ANY accepted edit replaces this reference; SFE-P3d-parity repair round 1
fixed an earlier version of this guard that compared only the target span's
own bytes at the ORIGINAL offsets, which could not detect a file switch to
a document sharing the same bytes at the same offsets — see
`staleCaretTokenSpanDiagnostic`'s header in `toolbar-actions.ts`) and the
span's exact bytes; rich mode reuses the pre-existing `captureRichSelection`/
`isRichSelectionCaptureFresh` document-identity guard (SFE-P3ab review
round 1's own fix for exactly this class of bug) rather than reinventing
it. Both surfaces are now equivalent-strength document-identity guards, not
merely "guarded the same way" in name only.
