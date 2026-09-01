# Code ownership boundaries

This repository has no `CODEOWNERS` file and no GitHub teams configured
against it — confirmed by search before writing this document (no
`CODEOWNERS` anywhere in the tree, `.github/` holds only `actions/` and
`workflows/`). Per the source-first editor plan (D11/P6c: "CODEOWNERS or
documented ownership"), this file is the documented-ownership form of that
requirement: it names the boundaries a reviewer should reason about and
what a change crossing one implies, without inventing team handles that do
not exist in this GitHub organization. If real GitHub teams are created
later, a `CODEOWNERS` file mapping these same four boundaries to those teams
can replace this document without changing the boundaries themselves.

## The four boundaries

### 1. The shared editor package — `packages/editor/`

The framework-free, browser-safe source-first rich editor
(`@dimm-city/gutterpress-editor`, Experimental — ADR 0013). Imports
`@vscode/markdown-editor` (via the internal fork,
`packages/vscode-markdown-editor/`) and `gutterpress/render` only; no
Svelte, Electron, `vscode`, or `node:*` imports (plan D4).

**Review expectation:** a change here has exactly two real consumers today
— `packages/desktop` and `packages/vscode-extension` — and must be
reasoned about against both, not just whichever host the change was
motivated by. A behavior change to the source-edit contract
(`DocumentSnapshot`/`SourceEdit`/`ApplyEditResult`, ADR 0011) or the
projection consumption surface is a public-contract change per the plan's
lane rules ("a public contract change lands with types, runtime validation,
tests, documentation, and compatibility notes") even though the package is
Experimental — Experimental means the *version* carries no stability
promise yet, not that a breaking change is unreviewed. Changes confined to
`packages/vscode-markdown-editor/` (the fork) must stay within
`PATCHES.md`'s documented hunks — see ADR 0013's fork discipline.

### 2. The VS Code extension — `packages/vscode-extension/`

The custom text editor host (`@dimm-city/gutterpress-vscode`, Experimental —
`docs/vscode-extension.md`). Owns `TextDocument`/`WorkspaceEdit`/undo
integration, workspace-trust gating, and the build/preview/open-source
commands; the webview it hosts is a consumer of boundary 1, not a second
implementation of it.

**Review expectation:** changes to the extension-host/webview message
protocol (`src/protocol/`) or the workspace-trust gating (D9,
`docs/vscode-extension.md`'s "Trust model") need security-minded review —
an untrusted-workspace regression here means plugin code or unsafe HTML
executing where it shouldn't. Changes to the build/preview/open-source
commands should be checked against the CLI's own equivalent behavior
(`packages/cli/src/commands/`), since they call the same `gutterpress`
library functions and must not silently diverge from what the CLI or
desktop does for the same operation.

### 3. The desktop renderer (the SPA) — `packages/desktop/src/`

The Svelte/SvelteKit single-page app, built statically via
`@sveltejs/adapter-static` (ADR 0015). Contains zero host/platform code by
architectural requirement (root `CLAUDE.md` §8): no runtime `gutterpress`
value-imports, no `node:*`/`fs`/`path`/`url`/`child_process`/`postcss`
imports, and every host capability is reached through exactly one seam —
the typed IPC capability modules under `src/lib/*/*-capability.ts` over the
shared `src/lib/platform/bridge.ts` accessor (ADR 0016).

**Review expectation:** the one non-negotiable check for any change here is
the renderer-purity boundary — does this PR add a value import that pulls
Node-oriented code into the browser bundle? `tools/check-render-purity.mjs`
enforces this in CI and in `npm run build --strict`, but a reviewer should
still ask the question directly, since the gate catches the *symptom*
(a Node builtin or `createRequire` reaching `build/`) after the fact. A new
host capability should arrive as a typed IPC channel plus a capability
module (see boundary 4's "Adding a new host capability" walkthrough in
`CLAUDE.md` §8), never as a new runtime import of `gutterpress` or a
`node:*` module directly in `src/`.

### 4. The Electron host — `packages/desktop/electron/`

The main process and preload bridge: lifecycle, windows, OS integration,
security policy (CSP, origin/navigation policy, the `app://` protocol
handler), and typed IPC registration (`electron/api/*.ts` plus a handful of
bespoke per-context registrars — ADR 0015, ADR 0016). `main.ts` is a
composition root — it constructs services and registers handlers, and
should not grow new domain workflow logic of its own (plan D10/P6b).

**Review expectation:** changes to `electron/main.ts`,
`electron/app-protocol.ts`, or `electron/preload.ts` touch the app's
security boundary directly (CSP, navigation policy, what `app://` will
serve, what the renderer can reach through `window.electron`) and should be
reviewed with that lens specifically, not just for correctness of the
immediate feature. A new IPC channel should be a `secureHandle(...)`
registration with runtime-validated arguments in a per-context registrar
module (matching the existing `electron/api/*.ts` pattern), not an inline
addition to `main.ts` itself — see `docs/ARCHITECTURE.md`'s composition-root
section for the current registrar list.

## Cross-boundary changes

A change that touches more than one boundary (for example: a new editor
command that needs a matching desktop toolbar action and a matching VS Code
command) should be reviewed against every boundary it touches, not just the
one the PR's description names first — this is the practical reason the
four boundaries are enumerated here rather than left implicit. `packages/cli`
(the Node-capable library, build/preview/publish/VCS, and its public
subpath exports) is not one of the four editor-architecture boundaries this
document exists to name — it predates this plan and has its own long-
standing review norms (see root `CLAUDE.md`'s primary architectural rules,
§0 "Author-first primitive layering" in particular for where a change to
author-facing markdown/CSS behavior belongs).
