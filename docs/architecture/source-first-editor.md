# Source-first editor architecture

> Plan: [`docs/plans/source-first-editor-enterprise-refactor.md`](../plans/source-first-editor-enterprise-refactor.md)
> Decision records: [ADR 0012](../adr/0012-source-first-editor-sparse-projection.md)–[0017](../adr/0017-narrow-feature-owned-capabilities.md)
> VS Code extension detail: [`docs/vscode-extension.md`](../vscode-extension.md)

This document describes the source-first rich-editing architecture as it
stands in Gutterpress `0.11.0`: the document model, the Gutterpress
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

The rich-editing surface itself is `@vscode/markdown-editor@0.0.2-85`
consumed through one adapter (`packages/editor/src/vscode-adapter/`), plus
a minimal internal fork, `packages/vscode-markdown-editor/`
(`@dimm-city/vscode-markdown-editor`, never a public Gutterpress export).
The fork exists because the upstream package has no generic hook for a
custom block view; `packages/vscode-markdown-editor/PATCHES.md` records the
complete diff against the pinned upstream version — two patches, ten hunks
total — the `CustomBlockRendering`/`renderCustomBlock` seam Gutterpress's
projection layer uses (Patch 1) and a measurement-path fix for large
documents (Patch 2, `SFE-P3f`), plus each patch's own upstreaming/removal
trigger. See [ADR 0014](../adr/0014-shared-editor-package-and-fork.md) for
why direct consumption was insufficient and why the fork stays narrow.

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

The Electron shell is a single process talking to itself over one
validated boundary — no local HTTP server, no proxy, no bearer token
([ADR 0016](../adr/0016-electron-single-ipc-transport.md)):

- **Renderer** — `packages/desktop/src/` is a SvelteKit SPA built statically
  via `@sveltejs/adapter-static` (`build/index.html`, `build/_app/**`, no
  server bundle). It contains no Node/platform code; `tools/check-render-purity.mjs`
  enforces that over the whole `build/` tree in CI. Every host capability it
  needs is reached through exactly one seam — typed IPC — surfaced as
  plain-function **capability modules**, one per bounded context, each
  going through the single shared accessor
  `packages/desktop/src/lib/platform/bridge.ts`:
  `app-lifecycle/app-lifecycle-capability.ts`,
  `doctor/doctor-capability.ts`, `editor-host/editor-projection-capability.ts`,
  `export/build-preview-capability.ts`, `files/files-capability.ts`,
  `lint/lint-capability.ts`, `project-config/project-config-capability.ts`,
  `publish/publish-capability.ts`, `recovery/recovery-capability.ts`,
  `remote/remote-capability.ts`, `update/updater-capability.ts`, and
  `vcs/vcs-capability.ts`. There is no broad `Platform`/`HostServices`
  locator and no `getPlatform()` — see
  [ADR 0017](../adr/0017-narrow-feature-owned-capabilities.md) for why the
  locator was deleted rather than trimmed, and
  [ADR 0015](../adr/0015-future-web-product-is-a-separate-package.md) for
  why no PWA/browser host lives here either.
- **Host** — `packages/desktop/electron/app-protocol.ts` registers a
  custom `app://` protocol handler that reads the static build tree
  straight off disk — including out of the packaged asar — and returns
  file bytes directly. Every request/reply host capability is a
  runtime-validated `secureHandle(...)` IPC channel (~120 registrations),
  built by the one shared wrapper
  `packages/desktop/electron/server-bridge/secure-handle.ts`'s
  `createSecureHandle(...)` and organized into 26 registrar modules: 21
  under `electron/api/*.ts` (fs, fs-watch, dialog, shell, log, app,
  project, manifest, tpl, snip, media, plugin, theme, vcs, style, updater,
  recovery, doctor, lint, remote, publish) plus five bespoke registrars
  colocated with handler logic that needs a live object
  (`electron/export/controller.ts`, `electron/preview/controller.ts`,
  `electron/editor-projection.ts`, `electron/pdf-export.ts`,
  `electron/github-device-flow-registrar.ts`). A narrow separate set of
  `ipcMain`/preload push channels (build progress, folder-changed, sync
  status, updater events) covers what request/reply cannot.
  `electron/main.ts` is the composition root: lifecycle, window
  management, security policy, and OS integration stay inline; it
  constructs the objects each registrar needs and calls every
  `register*Handlers(...)` function once.

### Rich-mode wiring on the desktop

- `packages/desktop/src/lib/components/RichEditor.svelte` — the thin Svelte
  shell around `mountGutterpressEditor`/`mountEditor`; the host owns
  iframe/document creation, CSP, and project CSS injection.
- `packages/desktop/src/lib/editor/rich-mode.svelte.ts` — source/rich mode
  selection; only one editing surface is mounted per document.
- `packages/desktop/src/lib/editor/rich-doc-host-controller.svelte.ts` —
  keeps the rich mount's `DocumentHost` in step with the desktop document
  session across file switches and external replacements.
- `packages/desktop/src/lib/editor/rich-commands.ts` — the desktop's
  binding from toolbar/context actions to the shared `EditorCommand`
  vocabulary (`packages/editor/src/core/commands.ts`); there is no
  desktop-private command implementation.

See the full detail (module counts, registration-liveness proof, IPC
byte-identity across the P6 refactor) in the deletion ledger's P6
Checkpoint D section.

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

## Read-only preview and the parity gate

The paginated preview is the print/layout authority and carries no editing
affordances after `0.11.0` (ADR 0013). Preview navigation, selection/copy,
open link/image, diagnostics, and page controls remain; in-flow
`contenteditable`, block-edit commands, and preview-specific source
rewriting were deleted in P4 (protocol v8→v9) — see the deletion ledger's
`SFE-P4` section for the search proofs.

Preview↔print agreement is CI-wired to be proven by
`packages/cli/scripts/native-parity-gate.ts` (`bun run parity:gate` in
`packages/cli`), which compares the live viewer's rendering against the
same document's printed output with an empty allowlist — the preview may
re-present the author's document, but per the project's architecture rules
(`CLAUDE.md`) it may never re-decide what the document means. It must stay
green there; it could not be run in this program's sandbox (Chromium 148+
required, sandbox has 141.0.7390.37 — see `p7-sweeps.md` §1.1), so no green
run of this script is recorded in this program's own evidence. This is a
distinct gate from `tools/check-parity.mjs`, which proved a different
property (that every preview mutation action reachable before P4 had a
replacement editor command) and was deleted in `SFE-P3e`, before P4 removed
the mutation surface it audited, once that run's replacement parity
evidence landed (acceptance.md's SFE-P3e record: "tools/check-parity.mjs +
check-parity.test.mjs + root script + 2 CI steps deleted (-2,142 LOC)").

## Where each binding decision is recorded

| Decision | ADR |
|---|---|
| Exact source + sparse projection is the document model | [0012](../adr/0012-source-first-editor-sparse-projection.md) |
| The paginated preview is read-only | [0013](../adr/0013-preview-read-only.md) |
| One shared, framework-free editor package (and the fork) | [0014](../adr/0014-shared-editor-package-and-fork.md) |
| A future web product is a separate package | [0015](../adr/0015-future-web-product-is-a-separate-package.md) |
| Electron converges on one transport: typed IPC | [0016](../adr/0016-electron-single-ipc-transport.md) |
| Narrow, feature-owned capabilities replace the `Platform` locator | [0017](../adr/0017-narrow-feature-owned-capabilities.md) |
