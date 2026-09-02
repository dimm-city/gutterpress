# The Gutterpress VS Code extension

`packages/vscode-extension` (published as `@dimm-city/gutterpress-vscode`)
is a VS Code extension that opens Markdown files in the same source-first
rich editor the desktop app uses. It exists to prove — continuously, not as
a one-off demo — that the shared editor package
(`@dimm-city/gutterpress-editor`, ADR 0014) is a real, host-portable
component, and to give Gutterpress authors a rich-editing option inside an
existing editor they may already use for the rest of a project's files.

## Status: Experimental (0.11.0)

Both `@dimm-city/gutterpress-editor` and this extension are Experimental for
the 0.11.0 release (plan D1/D11). Concretely:

- The extension is **not** the default editor for Markdown files. It
  registers `gutterpress.markdownEditor` as an *optional* custom text
  editor (`"priority": "option"` in `package.json`'s `customEditors`
  contribution) — a `.md` file still opens in VS Code's built-in Markdown
  editor unless the user explicitly picks "Reopen With… → Gutterpress
  Markdown Editor," or a future setting opts a workspace in.
- Extension identifiers, commands, and settings may change without the
  deprecation cycle a stable VS Code extension would owe its users.
- The extension operates correctly with **no Gutterpress project present** —
  opening a plain Markdown file with no `manifest.yaml` nearby still gets
  standard rich Markdown editing (headings, lists, links, images, tables,
  formatting). Gutterpress-specific behavior (layout markers, plugin
  regions, build/preview commands) activates only when a project is
  detected.

## What it does

- **`gutterpress.markdownEditor`** — a custom text editor
  (`src/provider.ts`) that mounts the shared editor package in a webview,
  backed by VS Code's own `TextDocument` and `WorkspaceEdit` (not a second
  buffer implementation — see "Host ownership" below).
- **`Gutterpress: Build`**, **`Gutterpress: Preview`**, **`Gutterpress: Open
  Source`** — commands (`src/commands/`) that call straight into the same
  `gutterpress` library functions the CLI and desktop use
  (`runBuild`/`startPreviewServer` from the bare `gutterpress` import,
  `hasProjectManifest` for project detection) — no reimplementation of
  build or preview logic inside the extension.
- **Project awareness** (`src/project/`) — detects a Gutterpress manifest in
  the open workspace, resolves its config and plugins under workspace
  trust, and builds a plugin-aware editor projection
  (`gutterpress/render`'s `createEditorProjection` +
  `gutterpress/plugins`'s `loadPluginsWithCss` — the same D11 subpath
  exports the desktop host uses for the identical job, see ADR 0012).

## Host ownership (D9)

The extension host and the webview have a hard, one-directional boundary,
matching the desktop's IPC boundary in spirit (ADR 0016/0017) even though
the transport here is VS Code's own webview messaging, not Electron IPC:

- **The extension host owns**: the real `TextDocument`, `WorkspaceEdit`
  application, VS Code's native undo/redo stack, file and workspace change
  events, project/manifest discovery, trusted plugin loading, and the
  build/preview/open-source commands.
- **The webview owns**: the editor model/view/controller (the shared
  package from ADR 0014), selection, local view state, and toolbar/chrome —
  and nothing else. It has **no filesystem or Node access**; every message
  it sends is runtime-validated at the boundary (`src/protocol/validate.ts`,
  `src/protocol/messages.ts`) before the host acts on it.
- A source edit made in the webview crosses the boundary as an explicit
  `[from, to)` replacement against an expected document version (ADR
  0012's source-edit contract) — never a semantic document the host has to
  reconcile.

## Trust model

VS Code's workspace-trust API (`vscode.workspace.isTrusted`) gates
Gutterpress-specific execution, checked at the same three call sites that
decide what a document can do: `src/provider.ts` (mounting the editor),
`src/project/projection.ts` (building a projection with plugins applied),
and `src/protocol/messages.ts` (validating what the webview is allowed to
ask for). In an **untrusted** workspace:

- Standard Markdown rich editing remains fully available — untrusted does
  not mean read-only.
- Project plugins do not execute at all (no `loadPluginsWithCss` call with
  real plugin code in an untrusted workspace).
- Unsafe raw HTML is not executed.
- Plugin regions render as source or a safe placeholder, with an explicit
  trust explanation shown to the author rather than a silent
  degradation — matching D9's "no arbitrary extension API" and D12's CSP/
  sanitization requirements from the desktop side.

Trusting the workspace (VS Code's own "Trust" prompt) is what re-enables
plugin execution and full projection fidelity — the extension adds no
Gutterpress-specific trust prompt of its own.

## The fork dependency, and its removal trigger

The webview mounts `@dimm-city/gutterpress-editor`, which in turn depends
on `@dimm-city/vscode-markdown-editor` — a minimal internal fork of
`@vscode/markdown-editor@0.0.2-85` (ADR 0014 has the full compatibility-gate
record). The fork carries **two** independent patches
(`packages/vscode-markdown-editor/PATCHES.md`):

- **`renderCustomBlock`** (SFE-P1b/P1b2) — one generic hook, gated
  identically to the package's own pre-existing
  `renderCustomCodeBlock`/`renderMath` hooks, that the upstream package does
  not expose today.
- **`measurement`** (SFE-P3f) — a performance fix to the package's own
  render loop (`_publishMeasurements`/`_renderAutorun`) that skips
  re-measuring a block's DOM geometry when its rendered subtree is provably
  unchanged, closing the D13 250 KiB p95 budget miss the unpatched package's
  unconditional per-keystroke remeasurement caused.

**Removal trigger — both conditions, not one:** unforking
`packages/vscode-markdown-editor` and re-pointing `packages/editor`'s
adapter at the upstream package directly requires a future
`@vscode/markdown-editor` release to ship BOTH an equivalent generic
custom-block rendering hook AND a way to skip remeasuring an unchanged
block — solving only one leaves the other patch (and the fork) in place.
`packages/vscode-markdown-editor/PATCHES.md` is the complete, bounded diff
against the pinned upstream version for both patches, so removing either
one (once upstream ships its equivalent) is a small, provable change, not a
re-audit of the whole dependency. This extension never imports the fork (or
the unforked upstream package) directly; it only ever sees
`@dimm-city/gutterpress-editor`'s own public surface, so the fork's removal
is invisible to this package's own code.

## Build and test

From `packages/vscode-extension/`:

```sh
bun run typecheck   # host program + the webview's own tsconfig
bun run test         # bun:test — host-side logic, protocol validation, project detection
bun run test:browser # real-browser webview suites (mount, disposal, CSP inertness,
                      # projection upgrade, edit-version reconciliation, production
                      # shell, protocol rejection, trust explanation)
bun run build        # bun scripts/build.mjs -> dist/extension.js + the webview bundle
```

There is no separate packaging (`.vsix`) step documented here yet — the
extension is not published to the Marketplace for 0.11.0; `bun run build`
produces the `dist/` the `main` field in `package.json` points at, which is
enough to load the extension unpacked (VS Code's "Install from VSIX" is not
required for local development — see VS Code's own extension-development
host documentation for running an unpacked extension).

## Where this fits in the wider architecture

See `docs/ARCHITECTURE.md`'s "Monorepo packages" section for how
`packages/vscode-extension` relates to `packages/editor`, `packages/cli`,
and `packages/desktop`, and `docs/adr/0014-shared-editor-package-and-fork.md`
for why one editor package serves both hosts instead of two independent
implementations.
