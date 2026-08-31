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

## Lane ownership (Lane A FIRST; then Lane B)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/desktop/src/lib/components/RichEditor.svelte`, `packages/desktop/src/lib/editor/rich-mode.svelte.ts` (or similarly-named controller), `packages/desktop/src/routes/+page.svelte` (mode wiring only), new tests under `packages/desktop/tests/editor/` | existing tests, `MarkdownEditor.svelte`, buffer-state, document-session, editor-host, packages/editor, packages/cli | Rich shell + mode controller + lazy loading + bundle proof |
| B | `packages/desktop/src/lib/editor/toolbar-actions.ts`, rich-mode command wiring, `packages/desktop/src/lib/components/EditorToolbar.svelte`, new tests | Lane A's shell/controller files, existing tests, other packages | Command/chrome parity + images/links/markers/movement + diagnostics surfacing |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

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
