# Source-first editor architecture

> Plan: [`docs/plans/source-first-editor-enterprise-refactor.md`](../plans/source-first-editor-enterprise-refactor.md)
> Decision records: [ADR 0012](../adr/0012-source-first-editor-sparse-projection.md), [0014](../adr/0014-shared-editor-package-and-fork.md), [0015](../adr/0015-future-web-product-is-a-separate-package.md)
> VS Code extension detail: [`docs/vscode-extension.md`](../vscode-extension.md)

This document describes the source-first rich-editing architecture as it
stands in Gutterpress `0.12.0`: the document model, the Gutterpress
projection, the desktop and VS Code hosts, and the preview's boundary with
all of it. It is current-state, not a change history — see the plan's
`docs/plans/source-first-editor/runs/` for how each piece was built and
`docs/plans/source-first-editor/deletion-ledger.md` for what it replaced.
Each section below names the ADR that made the binding call; read this
document for where the code lives and how the pieces fit, the ADR for why.

## The document session

Exact Markdown source is the only authoritative document (ADR 0012). Every
other representation — CodeMirror's buffer, the rich editor's DOM, the
Gutterpress projection, the read-only preview, the outline, diagnostics —
is derived from it and may be discarded and rebuilt at any time. No
ordinary edit serializes a semantic tree back into Markdown; opening and
closing a document without an explicit edit changes zero bytes.

The shared contract lives in `packages/editor/src/core/`:

- `contracts.ts` — `DocumentSnapshot` (`text` + monotonic `version`),
  `SourceEdit` (`[from, to)` plus `insert` and `expectedVersion`), and
  `ApplyEditResult` (`ok: true` with the new snapshot, or `ok: false` with a
  `"stale" | "readonly" | "invalid-range"` reason and the current snapshot
  unchanged).
- `hosts.ts` — the `EditorDocumentHost` and `EditorProjectHost` interfaces
  every concrete host implements.
- `apply-edit.ts` / `validate.ts` — the edit-acceptance logic and runtime
  validators shared by every host, so `0 <= from <= to <= text.length` and
  version-staleness checks are not each host's own responsibility to get
  right.
- `diagnostics.ts` — the stable `EDITOR_*` diagnostic categories (stale
  edit, invalid range, readonly, file too large, unsupported projection,
  projection limit, plugin untrusted/load-failed, custom-view unavailable,
  host disconnected, external replacement).
- `memory-host.ts` — an in-memory `EditorDocumentHost` used by the shared
  contract-test suite (`contract-tests.ts`) and by both real hosts' own
  test suites, so desktop and VS Code prove the same acceptance behavior
  against the same assertions rather than each inventing their own.

Two concrete document hosts implement this contract today:

- **Desktop** — `packages/desktop/src/lib/editor-host/desktop-document-host.ts`,
  adapting `packages/desktop/src/lib/document-session/session.ts`'s pure
  state machine (snapshot version, dirty/clean/saving/error state, external
  replacement, file switch) to `EditorDocumentHost`. Filesystem access,
  autosave, and crash recovery stay outside `packages/editor` (D7);
  `EditorBuffer` is a thin reactive Svelte adapter over the same session.
- **VS Code** — `packages/vscode-extension/src/webview-host/proxy-document-host.ts`,
  a webview-side `EditorDocumentHost` whose accepted edits round-trip
  through `packages/vscode-extension/src/host/document-gateway.ts` to the
  extension host's own `TextDocument`/`WorkspaceEdit`, which owns
  persistence and native undo/redo (D7, D9).

Both hosts mount the identical framework-free editor: `mountEditor` from
`packages/editor/src/web/mount.ts` for plain Markdown, and
`mountGutterpressEditor` from `packages/editor/src/gutterpress/mount.ts`
where a Gutterpress projection is available. Neither desktop nor VS Code
defines its own editing surface or command vocabulary — see
[ADR 0014](../adr/0014-shared-editor-package-and-fork.md).

### The `@vscode/markdown-editor` fork

The rich-editing surface itself is `@vscode/markdown-editor@0.0.2-87`
(re-pinned 2026-09-03) consumed through one adapter
(`packages/editor/src/vscode-adapter/`), plus an internal fork,
`packages/vscode-markdown-editor/` (`@dimm-city/vscode-markdown-editor`,
never a public Gutterpress export). The fork began because the upstream
package has no generic hook for a custom block view;
`packages/vscode-markdown-editor/PATCHES.md` records the complete diff
against the pinned upstream version - nine additive patches, 29 hunks (25
in `dist/index.js`, 4 in `dist/index.d.ts`), still only those two files -
the `CustomBlockRendering`/`renderCustomBlock` seam Gutterpress's
projection layer uses (Patches 1 and 6), a measurement-path fix for large
documents (Patch 2, `SFE-P3f`), container mounting for Gutterpress scopes
(Patches 3 and 9), a per-block decoration hook (4), a pre-measurement hook
the page engine paginates through (5), a render epoch that rebuilds every
block view without remounting (7) and point-in-block hit testing for
multi-column pages (8), plus each patch's own upstreaming/removal trigger
and a re-pin trigger for the pin itself. See
[ADR 0014](../adr/0014-shared-editor-package-and-fork.md) (and its
2026-09-28 addendum) for why direct consumption was insufficient and how
the fork's character changed from a display seam to mounting and
pagination hooks.

## The sparse Gutterpress projection

The editor does not maintain a second Markdown AST. It projects only the
Gutterpress-specific information the base Markdown editor cannot derive —
layout markers, generated views, plugin regions, raw HTML — as source
ranges layered on top of the same source-first model (ADR 0012). Projection
output can be discarded and rebuilt at any time; there is no projection
state an editing session depends on surviving.

- **Browser-safe projection builder** —
  `packages/cli/src/lib/markdown/editor-projection.ts`'s
  `createEditorProjection()`, reachable from the Node-free
  `gutterpress/render` subpath (`packages/cli/src/render.ts`) so it can run
  inside the desktop's renderer and the VS Code webview, not just the CLI's
  Node process. It derives every projected block's source range from the
  configured Gutterpress Markdown-it pipeline's own token maps and marker
  metadata — never from rendered DOM, tag gaps, or text equality — and
  produces a typed diagnostic with a source-mode fallback wherever origin
  is ambiguous.
- **Plugin transform origin** — `packages/cli/src/lib/markdown/plugin-origin.ts`
  recovers authored source ranges for plugin-generated regions from token
  object identity across a tightly-bracketed plugin boundary. Six distinct
  ambiguous shapes (documented in the SFE-P2c run result) refuse by rule
  name rather than guess; a refused region falls back to plain source
  editing with a diagnostic.
- **Projection consumers** — `packages/editor/src/gutterpress/` maps
  projected blocks and generated views into editor view data: `match.ts`
  (marker-chip matching against the live document), `provider.ts` (the
  `renderCustomBlock` seam consuming the fork's hook), `render-chip.ts`
  (inactive/active chip rendering), `plan.ts`, and
  `projection-diagnostics.ts`. Generated views (chapter openers, plugin
  labels) have an anchor and no writable source range at the type level —
  there is no code path that can turn one into a source edit.

Required projected kinds are `chapter`, `page`, `spread`, `section`,
`page-break`, `column-break`, `plugin-region`, and `raw-html` (D6). D13's
caps (10,000 projected blocks, 1 MiB per inactive-HTML payload, 8 MiB
aggregate) are enforced in the same builder and fail closed to source mode
or a safe placeholder, never to a guessed edit.

## Plugin origin and trusted rendering

Project plugins remain ordinary `markdown-it` plugins (plan §5) — the
editor adds no Gutterpress-specific plugin API. Plugin code executes only
in the host process, never in the editor webview or iframe:

- **Desktop** — `packages/desktop/electron/editor-projection.ts` builds the
  plugin-aware projection host-side, loading the opened project's plugins
  through the same `gutterpress/plugins` loader
  (`packages/cli/src/lib/markdown/plugins.ts`) the CLI's build/preview path
  uses — not a separate duplicate. The desktop's rich-mode wiring exposes
  this as one `editor-projection-capability.ts` IPC round trip
  (`electron/editor-projection.ts` is one of the 26 registrar modules under
  [`electron/`](#the-desktop-host)); the trust decision is the same
  "opened this project" decision the read-only preview already makes.
- **VS Code** — `packages/vscode-extension/src/project/projection.ts` loads
  plugins host-side under workspace trust, with plugin paths scoped to the
  workspace root (`packages/vscode-extension/src/project/path-containment.ts`
  refuses a `../` escape before the loader ever runs). In an untrusted
  workspace, standard Markdown rich editing remains available but project
  plugins do not execute and unsafe raw HTML is not executed (D9).

Inactive plugin regions render the plugin's own HTML through the same
renderer the print path uses (capped by D13, failing closed on oversize
output); active regions expose source-aware editable interiors while
retaining the plugin wrapper's safe view attributes. An interior the
projection cannot prove editable stays read-only with an explicit
"Edit source" diagnostic rather than guessing (D14, G-06/G-07 in
`docs/plans/source-first-editor/pr158-lessons.md`).

## The desktop host

The Electron shell serves the SvelteKit SPA in-process over `app://` and
exposes host capabilities as `src/routes/api/**/+server.ts` routes the SPA
calls through the typed `src/lib/api.ts` wrapper, with a narrow
`ipcMain`/preload bridge for push streams and calls that must drive a live
`BrowserWindow` (root `CLAUDE.md` §8). The editor adds four routes and
nothing to the bridge:

- `POST /api/editor/projection` — the plugin-aware projection of one
  chapter's text for the open book, built host-side by
  `packages/desktop/src/lib/server/editor-projection.ts` through the same
  `gutterpress/plugins` loader and `createMarkdownRenderer`/
  `createEditorProjection` the CLI's build and preview path use, with the
  book's stylesheets and the plugins' CSS inlined and scoped to the editor
  document (`composeEditorCss`). A chapter over the rich-mode ceiling and a
  plugin-load failure come back as `ok:false` outcomes, data the renderer
  acts on (fall back to the plugin-less local projection with a
  diagnostic), never as transport errors. `projectDir` is confined to the
  open book by the same guard every other route uses.
- `GET /api/editor/asset/[name]` — one file a book stylesheet references,
  by the hashed name `inlineStyles` gave its copy; the registry the
  projection route fills is the authorization.
- `GET /api/editor/project-file/[...path]` — one file of the open book for
  the editor document (`<base64url(projectDir)>/<relative path>`), so a
  chapter's `images/art.png` resolves the way the book does
  (`$lib/editor/project-assets`). Canonically contained in the open book
  before a byte is read.
- `POST /api/log/renderer-error` — renderer-side errors into the app log
  (`$lib/diagnostics/report`).

The SPA side reaches the projection through
`src/lib/editor-host/editor-projection-capability.ts` (`api.editor.projection`).

### Rich-mode wiring on the desktop

Read keeps the real preview — the print path's own pages — while it is
LOCKED. Unlocking (the pill over the preview pane) lays the paged editor
over that pane; the preview iframe stays mounted and visible underneath,
because the outline, the page count and the chapter order still come from
it, and a hidden cross-origin frame would be throttled. Read opens locked
every time; a reader (Settings → App) never sees the pill; Edit mode's
preview is untouched (its ADR 0009 in-place block editing remains).

- `packages/desktop/src/lib/components/RichEditor.svelte` — the thin Svelte
  shell around `mountGutterpressEditor`/`mountEditor`; the host owns
  document creation and project CSS injection.
- `packages/desktop/src/lib/components/BookSurface.svelte` — the whole book
  in an unlocked Read: one `DesktopDocumentHost` per chapter (constructed in
  its `load()`), edits routed out through `onSnapshotChange` to that file's
  `EditorBuffer` (autosave, snapshots and external-change reconciliation
  unchanged), external changes routed in through `+page.svelte`'s
  `onContentReplaced` (`bookRef?.replaceText`), chapter order from the
  preview's `getChapters()` (protocol v9) via `$lib/routes/book-order`.
- `packages/desktop/src/lib/editor/rich-commands.ts` — the desktop's
  binding from toolbar/context actions to the shared `EditorCommand`
  vocabulary; there is no desktop-private command implementation.
- `+page.svelte` — the lock pill, the paged editor's toolbar (main's
  `EditorToolbar`, routed through `rich-commands`), its context menu
  (`PopupMenuController` + the shared `ContextMenu`), the projection build
  with its diagnostics, and the lock state (`richLocked`, reset on every
  mode change).

## The VS Code extension

`packages/vscode-extension` (`@dimm-city/gutterpress-vscode`) registers
`gutterpress.markdownEditor` as an optional custom text editor — never the
Markdown default (D9). Full detail, including its trust model and
build/test commands, lives in [`docs/vscode-extension.md`](../vscode-extension.md);
this section is the map into the source:

- `src/provider.ts` — the `CustomTextEditorProvider`; owns `TextDocument`,
  `WorkspaceEdit`, and native undo/redo.
- `src/host/document-gateway.ts` — the extension-host side of the
  webview/host protocol, with stamped one-in-flight reconciliation so a
  rejected in-flight edit cannot be applied against a state that no longer
  exists.
- `src/project/discover.ts`, `src/project/projection.ts`,
  `src/project/path-containment.ts` — project detection, plugin loading
  under workspace trust, and the `../`-escape refusal.
- `src/protocol/` — the versioned webview/host message contract
  (`messages.ts`), its runtime validator (`validate.ts`), and the wire
  diagnostic shapes (`diagnostics.ts`).
- `src/webview/`, `src/webview-host/proxy-document-host.ts` — the webview
  entry (no Node or filesystem imports; a nonced CSP with fixed base and
  dist-scoped roots) and the webview-side `EditorDocumentHost` proxy.
- `src/commands/` — `build.ts`, `preview.ts`, `open-source.ts`, the
  commands the extension contributes outside the editor surface itself.

## The preview and the parity gate

The paginated preview is the print/layout authority. Its navigation,
selection/copy, open link/image, diagnostics, page controls and in-place
block editing (ADR 0009) are unchanged by the editor: the paged editor is a
second surface over the same source, offered in Read behind the lock, not a
replacement for the preview.

Preview↔print agreement is CI-wired to be proven by
`packages/cli/scripts/native-parity-gate.ts` (`bun run parity:gate` in
`packages/cli`), which compares the live viewer's rendering against the
same document's printed output with an empty allowlist — the preview may
re-present the author's document, but per the project's architecture rules
(`CLAUDE.md`) it may never re-decide what the document means. The
editor<->preview page-count check is a separate drive,
`packages/desktop/tests/integration/editor-preview-parity.mjs` (`bun run
parity:gate` in `packages/desktop`).

## Where each binding decision is recorded

| Decision | ADR |
|---|---|
| Exact source + sparse projection is the document model | [0012](../adr/0012-source-first-editor-sparse-projection.md) |
| One shared, framework-free editor package (and the fork) | [0014](../adr/0014-shared-editor-package-and-fork.md) |
| A future web product is a separate package | [0015](../adr/0015-future-web-product-is-a-separate-package.md) |
