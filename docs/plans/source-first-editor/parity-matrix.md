# SFE-P3d-parity — Derived parity matrix

> Produced by run SFE-P3d-parity, Lane A. This document, `tools/check-parity.mjs`,
> and `tools/check-parity.test.mjs` together are the standing gate the plan's
> P3d "parity gate before P4" requires. **This file is machine-read** by
> `check-parity.mjs` — see "Table format contract" below before editing it.

## Why this document exists

P4 may delete `InlineEditController`, `CommitEngine`, the context menu, and
the preview mutation protocol *only because* this run proves every authoring
action reachable through those paths today has a working replacement in
source mode, rich mode, or both. Nothing is deleted in this run — see the run
specification (`docs/plans/source-first-editor/runs/SFE-P3d-parity.md`).

## How the action set was derived — NOT hand-listed

The **rows below are not a hand-written list**. `tools/check-parity.mjs`
re-derives the left-hand `Action` column from the live source of
`packages/desktop/src/lib/routes/context-menu-controller.svelte.ts` and
`packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts` every time
it runs (`bun run check:parity`), and fails if:

- an action the extractor finds has no row in either table below;
- a row names a replacement command identifier that no longer exists in the
  cited source file;
- a mapped row's test evidence does not resolve to a real, named
  `test(...)`/`describe(...)` in the cited file;
- a waiver row is missing a reason or a decision owner.

The full extraction algorithm — what counts as a "mutation-capable action",
how a literal-string `id` vs. a `.map()`-fed shorthand `id` (the
`FORMAT_KINDS`-driven selection-format items) is resolved, and its stated
limitations — is documented in `tools/check-parity.mjs`'s own header comment.
In short: an item counts when its `run()` closure (or a private method it
calls, resolved by a one-hop call-graph over the class's own methods) reaches
`commitEngine.commitRangePatch(...)`; `InlineEditController`'s one free-form
block-edit path is extracted under the synthetic id `block-edit` on the same
basis (its own `commit()` method calls `commitRangePatch` directly).

At the SHA this document was written against, extraction found **13** actions
— 12 from `context-menu-controller.svelte.ts`'s items and 1
(`block-edit`) from `inline-edit-controller.svelte.ts`. That number is
reported by the gate every run, not restated here as a claim to trust — see
`check:parity`'s own "RULE 1 [extraction]" summary line.

## Table format contract (read before editing)

`check-parity.mjs` parses two `###` sections by heading text (case-insensitive
substring match): a heading containing **"mapped action"** and a heading
containing **"waiver"**. Each section's FIRST pipe-table under that heading is
parsed; its header row's cell text (lower-cased) selects columns by name — so
column ORDER doesn't matter, but the column TEXT must stay
`Action` / `Replacement command(s)` / `Surface(s)` / `Test evidence` (mapped
table) or `Action` / `Reason` / `Decision owner` (waivers table).

- **Action** — the exact extracted id, e.g. `` `format-bold` `` (backticks
  optional, stripped by the parser).
- **Replacement command(s)** — one or more `;`-separated references, each
  either:
  - `file#identifier` — `file` is one of `toolbar-actions.ts`,
    `rich-commands.ts`, `commands.ts` (resolved to their real paths by the
    checker); `identifier` must appear in that file as either an exported
    `function`/`const`/`type`/`interface` name, or a quoted string literal in
    real code (an `EditorCommand`/`LayoutBlockKind`/`ToolbarAction` `kind`
    value) — never inside a comment.
  - a sentinel — `source-editor#direct-text-edit` or
    `rich-editor#direct-text-edit` — naming the editor's own always-available
    direct-text-editing capability as the replacement (used only where no
    dedicated command exists AND none is needed — see the marker-edit rows'
    own explanation below). Sentinels always "exist"; they still require real
    test evidence.
- **Surface(s)** — free text naming where the replacement is reachable
  (source toolbar, rich toolbar, keyboard, caret-placement convention, …),
  `;`-separated to line up with Replacement command(s).
- **Test evidence** — one or more `;`-separated `path::exact test title`
  references. The path is repo-root-relative; the title must match a real
  `test(...)`/`test.each(...)(...)`/`describe(...)` literal string in that
  file byte-for-byte (the checker does not run the suite — it proves the
  citation is not fabricated, per G-01/AP-01 "exercise the replacement").

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

| Action | Reason | Decision owner |
|---|---|---|
| `image-properties` | No command in EITHER surface today edits an EXISTING image's properties in place. `toolbar-actions.ts#applyImage` and `rich-commands.ts#applyRichImageInsert` both only ever INSERT a brand-new image (rich mode's own header: "a brand-new image has no existing token set to seed from"). The one path that edits an existing image (`ImagePropertiesDialog` pre-filled with the CURRENT token's values) is wired only to `+page.svelte`'s `openInlineEdit`-adjacent preview-context-menu flow. Building a reachable replacement needs (a) UI wiring in `+page.svelte`/`EditorToolbar.svelte` to open that dialog against a selected existing image, and (b) for rich mode specifically, resolving the selected image's own source range inside `packages/editor`'s mount/projection layer so the edit can target it. Both are outside this lane's write boundary (`packages/desktop/src/lib/editor/**` only; `+page.svelte` and `packages/editor/**` are both off-limits — see the run's WRITE OWNERSHIP list). The underlying rewrite vocabulary (`image-classes.ts`'s setters, already used by the context menu) is shared and already tested — this is a UI-reachability gap, not a missing algorithm. | product owner (pending) |
| `image-unwrap` | No command in either surface removes an image's `.gp-pin`-style wrapper syntax. `context-menu-actions.ts`'s `findImageWrapper`/`spliceToken` (the pure computation the context menu uses) are shared and tested, but nothing outside the preview context menu invokes them — same UI-wiring gap and same write-boundary constraint as `image-properties` above. | product owner (pending) |
| `link-edit` | No command in either surface edits an EXISTING link's `href` in place — `toolbar-actions.ts#applyLink` and the rich `insert-link` command both only ever wrap a selection as a NEW link (this is exactly what covers `format-link`/"Make link…" above, a genuinely different operation from rewriting an existing link's target). `context-menu-actions.ts`'s `resolveLinkToken`/`rewriteLinkToken` are shared and tested but reachable only from the preview context menu today — same UI-wiring gap and write-boundary constraint. | product owner (pending) |

All three waivers above are recorded here for stakeholder attention, not
because building the replacement is believed to be hard — the computational
core already exists and is tested; only UI reachability is missing, and that
work belongs to a run whose write ownership actually covers `+page.svelte`,
`EditorToolbar.svelte`, and (for the rich-mode half) `packages/editor`'s
mount/projection layer. **This means P4 is NOT yet clear to proceed on these
three actions** — condition 5 of the parity gate ("No stakeholder-designated
blocker remains") is not satisfied until the product owner either accepts
these waivers as permanent (the context menu's "Set properties…"/"Unwrap
image"/"Edit link…" simply disappear, per D8's "or disappear" clause) or
schedules a follow-up run to close them before P4 deletes their only current
implementation.
