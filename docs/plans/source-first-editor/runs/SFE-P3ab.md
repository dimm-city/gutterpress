# SFE-P3ab — Desktop rich mode and authoring parity

> Combines the plan's **P3a** (desktop source/rich integration) and **P3b**
> (authoring parity). They share one surface and one set of consumers;
> splitting them would mean mounting a rich editor with no commands, then
> reviewing the same files twice. Both runs' exit criteria apply in full.

## Objective

Put the shared editor into the desktop over the existing authoritative
document session: a thin Svelte wrapper, source/rich mode selection with
exactly one surface mounted at a time, lazy loading that leaves the
CodeMirror path untouched — and enough authoring capability that rich mode is
a credible primary surface (the precondition P4 deletion depends on).

## Allowed behavior changes

- New rich-editor Svelte component + workspace mode controller in
  `packages/desktop/src/lib`.
- `+page.svelte` gains mode wiring (composition only — no workflow logic; P6
  slims this file further).
- The existing CodeMirror `MarkdownEditor` path is **unchanged**; rich mode is
  additive and off by default this run.

## Behavior that must remain unchanged

- Every existing desktop test passes UNMODIFIED (the characterization net).
- Source mode, autosave, recovery, external-change handling, file switching,
  preview, build, publish — all byte-identical in behavior.
- `$effect` stays banned (CLAUDE.md §8); use `onMount`, event handlers,
  `$derived`, `{#key}`, or the settings-store channel.

## Binding decisions

- **D7** — one editing surface mounted per document. Source and rich share
  source and persistence but not an undo stack; switching establishes an
  explicit undo epoch and must never alter source.
- **D8** — the desktop has exactly three surfaces: CodeMirror source, shared
  rich editor, read-only paginated preview. Preview stays the print authority;
  this run does not touch it.
- **D4/§8** — the renderer stays PWA-clean: the rich editor reaches the host
  through the existing seams. `packages/editor` is browser-safe already;
  projection input comes from the host (`gutterpress/render` runs host-side
  where Node is needed, or browser-safe where it is not — the P2b/P2c contract).
- **G-10** — the active surface owns the authoring workflow: while rich mode is
  active, its commands are reachable there; controls that only target another
  surface are hidden or disabled.
- **G-09** — one implementation per authoring concept: rich mode consumes the
  P2a shared command layer, not a second copy.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Rich shell | A Svelte component wraps `mountGutterpressEditor`; the host owns container creation, CSS injection, and the presentation input; dispose on unmount is clean (no leaked listeners across mode switches) | A |
| Mode selection | A workspace controller selects source or rich per document; exactly ONE surface is mounted at a time (asserted, not assumed) | A |
| Session sharing | Both modes drive the SAME document session: dirty state, autosave, recovery, external-change banner, and file switching behave identically in either mode | A |
| Undo epoch | Switching modes establishes a documented undo boundary; source is byte-identical across a switch with no edits (assert bytes before/after) | A |
| Lazy loading | Rich-editor code loads dynamically (mirroring the existing `MarkdownEditor` lazy-import pattern in `+page.svelte`); with rich mode never used, the CodeMirror path loads exactly what it does today | A |
| Bundle hygiene | The client bundle stays host-code-free (`tools/check-render-purity.mjs --strict` green after a real desktop build) | A |
| Command surface | Rich mode exposes the P2a command vocabulary through toolbar/keyboard; commands route through the shared `applyCommand`, not a desktop reimplementation | B |
| Images and links | Image/link insertion and property editing are reachable **from rich mode** (G-10/AP-17 — the PR 158 failure was image controls living only in preview); asset resolution goes through the host | B |
| Layout markers | Marker insertion/manipulation is available in rich mode via explicit source edits (the desktop already has `applyPageBreak`/`applyLayoutBlock` — reuse, do not duplicate) | B |
| Block movement | Move-block up/down as explicit source-range replacement preserving marker and plugin boundaries | B |
| Source reveal | An explicit "edit in source" path from rich mode for any unsupported/refused region | B |
| Unsupported messaging | Diagnostics from the projection (P2c wires them to `onDiagnostic`) surface in the desktop UI with the safe next action | B |

## Lane ownership (Lane A FIRST; then Lane B; Lane C added by round-1 repair, see Review log)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/desktop/src/lib/components/RichEditor.svelte`, `packages/desktop/src/lib/editor/rich-mode.svelte.ts` (or similarly-named controller), `packages/desktop/src/routes/+page.svelte` (mode wiring only), new tests under `packages/desktop/tests/editor/` | existing tests, `MarkdownEditor.svelte`, buffer-state, document-session, editor-host, packages/editor, packages/cli | Rich shell + mode controller + lazy loading + bundle proof |
| B | `packages/desktop/src/lib/editor/toolbar-actions.ts`, rich-mode command wiring, `packages/desktop/src/lib/components/EditorToolbar.svelte`, new tests | Lane A's shell/controller files, existing tests, other packages | Command/chrome parity + images/links/markers/movement + diagnostics surfacing |
| C | `packages/editor/src/vscode-adapter/adapter.ts`, `packages/editor/src/web/mount.ts`, `packages/editor/src/gutterpress/mount.ts`, and their existing tests `packages/editor/tests/web/mount.btest.ts`, `packages/editor/tests/web/support/entry.ts`, `packages/editor/tests/gutterpress/gutterpress.btest.ts`, `packages/editor/tests/gutterpress/support/entry.ts` | other `packages/editor` files, `packages/cli`, `packages/desktop` | The `getSelection()` selection accessor (`EditorMount`/`GutterpressEditorMount`/`VscodeEditorAdapter`) rich mode's command surface depends on — a public-contract co-update (both mount implementations + the one adapter they delegate to, landed together per "A public contract change lands with types, runtime validation, tests, documentation, and compatibility notes") |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

Lane C was originally shipped unreviewed under an in-code "Lane D" label this
table never defined (a round-1 review finding, CONFIRMED — see Review log).
The work itself was re-verified sound (the contract co-update is complete:
both `EditorMount`/`GutterpressEditorMount` implementations delegate to the
one adapter, no other implementer exists, and every existing
`applyChapterBlock`/`applySectionBlock`/`applyTwoColumnBlock`/
`applySpreadBlock`/`applyPageBreak` consumer of the pre-existing shape is
unaffected); this amendment gives it the named, explicit lane ownership the
Lane rules require, retroactively. Every in-code "SFE-P3ab (Lane D)"
attribution was rewritten to "SFE-P3ab (Lane C)" as part of the same repair
round.

## Test plan

- Unit: mode controller (mount/unmount exclusivity, undo epoch, session
  sharing), command routing (desktop actions → shared `applyCommand`).
- Existing desktop suites unmodified and green — the real regression net.
- Browser/interaction proofs stay in P3d (packaged); this run proves wiring
  and unit-level behavior.

## Review dimensions

- Can both surfaces ever be mounted simultaneously (construct the race:
  rapid mode toggle, file switch mid-switch)?
- Does a mode switch alter source under ANY path (assert bytes)?
- Does rich mode duplicate any command logic the shared layer already owns?
- Is `$effect` used anywhere (lint enforces; verify it actually runs on the
  new files)?
- Does the lazy split actually keep rich code out of the initial chunk
  (inspect the build output, do not trust the import syntax)?

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/desktop && bun run test && bun run check && bun run lint`
- `cd packages/desktop && bun run build` (runs the renderer-purity gate)
- `cd packages/editor && bun run test && bun run test:browser`
- `cd packages/cli && bun run test`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

<!-- Appended by the review stage. -->

### Round 1 — repair (8 CONFIRMED findings)

All eight CONFIRMED findings from the round-1 adversarial batch review were
fixed:

1. **Rich mode was a second, never-refreshed document owner** — preview
   commits (`commit-engine.ts`) bypassed `richDocHost` entirely while rich
   mode was active, and the next rich command silently reverted them.
   Fixed: `+page.svelte`'s `CommitEngine` construction now routes
   `editorHasFile`/`applyRangeEdit` through `richDocHost.applyEdit` when the
   rich surface is live, so the buffer and the rich host can never diverge.
   `rich-mode.svelte.ts`'s header claims were corrected to describe this
   explicit convergence instead of an inaccurate "one host, automatic
   sharing" framing. New integration test:
   `packages/desktop/tests/editor/rich-mode-commit-integration.test.ts`.
2. **Block movement corrupted fenced code, misclassified prose as markers,
   and crossed marker/plugin boundaries** — `splitIntoBlocks`/`moveBlock`
   (`rich-commands.ts`) are now fence-aware (a fenced region is always one
   indivisible block), `MARKER_LINE_RE` was narrowed to Gutterpress's own
   `KNOWN_KINDS` plus the generic `@end-*` closer convention, and
   `moveBlock` refuses (typed `"boundary"` reason) any swap touching a
   scope-affecting marker (`chapter`/`spread`/`page`/`section`/
   `end-section`/`continue`/any `@end-*`) — only `page-break`/`column-break`
   stay freely movable. Tests updated/added in `rich-commands.test.ts`.
3. **Rich mode mounted over non-Markdown files with no way back** —
   `showEditorContent`/`setRichMode` (`+page.svelte`) now gate on
   `isMarkdownPath`; a non-markdown file falls back to the source surface
   (the `richMode.mode` PREFERENCE is preserved, so returning to a markdown
   file resumes rich mode) and surfaces an `EDITOR_UNSUPPORTED_PROJECTION`
   diagnostic. A new `richSurfaceActive` derived is now the single source of
   truth for "which surface is actually live", replacing the raw
   `richMode.mode === "rich"` check at every write-path call site.
4. **Rich-mode "Link" destroyed a non-collapsed selection** —
   `applyRichCommand` (`rich-commands.ts`) now special-cases
   `insert-link` after resolving the live selection: a non-collapsed
   selection clears the toolbar's fixed `"link text"` override so
   `computeInsertLink` wraps the SELECTED words instead of discarding them
   for the literal placeholder, matching source mode's `applyLink`
   (`const overrideText = from === to ? "link text" : undefined;`). A
   collapsed selection (or none) keeps the existing placeholder behavior
   unchanged. `routeToolbarAction`'s own output is intentionally unchanged
   (it stays selection-agnostic by design; the correction lives in
   `applyRichCommand`, where the live selection is actually resolved), so
   `rich-commands.test.ts:431` needed no change — it still accurately
   describes `routeToolbarAction`'s own behavior.
5. **Async-dialog selections were re-applied with no document identity** —
   `openRichImageProperties` and the snippet picker's `onInsert` now capture
   `{ host, version, selection }` (`captureRichSelection`/
   `isRichSelectionCaptureFresh`, `+page.svelte`) and refuse with
   `EDITOR_STALE_EDIT` if the document identity or version moved while the
   dialog was open, instead of silently applying stale offsets.
6. **`getSelection()`'s "never focused" contract was false, and the
   consumer failed open** — `adapter.ts`'s doc comment (and the mirrored
   ones in `RichEditor.svelte`/`rich-commands.ts`) now state that
   `undefined` means "no caret at this instant" and can recur after
   interaction; a new browser case in `mount.btest.ts` proves it (a real
   caret cleared by clicking the mount's own gutter). The desktop's
   explicit, caret-relative callers (`handleRichToolbarAction`, the snippet
   picker) now refuse with `NO_LIVE_CARET_DIAGNOSTIC` instead of silently
   falling back to `documentEndSelection`; that fallback remains for the
   genuinely anchorless image-insert path (drag-and-drop).
7. **The desktop never built a D6 projection** — so `mountGutterpressEditor`
   was unreachable and its diagnostics unexercisable. `+page.svelte` now
   builds one via the browser-safe `gutterpress/render` subpath
   (`createEditorProjection`) in lockstep with `richDocHost`
   (`rebuildRichDocHost`), passed to `RichEditorComponent` as `projection`.
   It is not project-plugin-aware (that needs host-side plugin loading, out
   of this repair's scope) and is not live-refreshed on every keystroke,
   matching `mountGutterpressEditor`'s own documented "caller rebuilds and
   remounts" contract.
8. **Lane-ownership violation** — this table now names Lane C explicitly
   (above) for the seven `packages/editor` files a prior round touched
   under an undefined "Lane D" label; every in-code attribution was
   rewritten to match.
