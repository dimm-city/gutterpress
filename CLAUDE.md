# CLAUDE.md — guidance for AI coding sessions on this repo

## Monorepo layout

This repo is a Bun workspace with two packages:

- **`packages/cli/`** (`@dimm-city/print-md`) — the single published package:
  ALL runtime logic (markdown rendering, preview HTTP server, PDF generation via
  puppeteer-core, lint, validation — under `src/`) **and** the CLI entry
  (`src/cli.ts`). It exposes a library (`exports` → `dist/index.js`) and a CLI
  (`bin` → `dist/cli.js`). Built the standard way: `bun build` (the Node
  entrypoints, `--target=node --packages=external --splitting`; `src/render.ts`
  is compiled as a SEPARATE non-split invocation so the node-free
  `/render` subpath never shares a chunk with Node code — enforced by
  `scripts/check-render-pure.mjs`) + `tsc` for
  `.d.ts` — see the package.json `build` script; deps are normal `dependencies`,
  not bundled. Also ships as a standalone single-file binary via `bun build
  --compile`, run inline by the `build-cli` job in `.github/workflows/release.yml`
  (`bun build src/cli.ts --compile --target=<target> --outfile=…`) — there is
  no separate `compile` package.json script or `scripts/compile.ts`. The
  no-bundlers-at-runtime rule (§1 below) applies to this package.
- **`packages/viewer/`** (`@dimm-city/print-md-viewer`) — Electron desktop
  app with a SvelteKit SPA frontend. The SPA is built with
  `@sveltejs/adapter-node`, which emits a Node HTTP handler (`build/handler.js`).
  In production the Electron main process starts that handler on a local
  `127.0.0.1` server (OS-assigned port) and serves the SPA to the window via a
  custom `app://` protocol handler that proxies every request to the local
  server with `fetch`. Host capabilities are exposed as ~85
  `src/routes/api/**/+server.ts` HTTP routes (status, fs, dialog, theme, plugin,
  remote/sync, vcs, recovery, …) — NOT a handful of `ipcMain.handle()`
  endpoints. The `ipcMain`/preload bridge is deliberately narrow: it carries
  only the push-event streams (build progress, folder-changed, sync status,
  updater events) and the build/preview pipeline calls that need a live
  BrowserWindow. The Electron main + preload are
  built by **electron-vite** to `out/main/main.js` + `out/preload/`; the main
  is ESM and loads the lib with a plain dynamic `import("@dimm-city/print-md")`
  (no CJS→ESM `new Function` bridge — that was removed when the build moved to
  electron-vite + asar, commit `c5e75ae`). No afterPack hook; electron-builder
  packages the lib + its transitive deps from the workspace `node_modules` via
  its standard dep walker (puppeteer-core is `asarUnpack`ed; PDF export itself
  uses Electron's own Chromium via `webContents.printToPDF` — see
  `docs/adr/0002-pdf-rendering-and-pure-js-tooling.md`).
  See [project_viewer_architecture] memory + `packages/viewer/README.md` for the
  full picture.

The lib's runtime is Node.js-compatible — no `Bun.serve`/`Bun.file`/
runtime Bun APIs. `with { type: "file" }` is used as a build-time syntax
only; bun build compiles it to plain string constants in the dist output.
This is what enables the viewer to run with Electron's bundled Node.
Bun is required for development (workspace install, lib build, CLI
compile, tests) but NOT for end users of the packaged viewer.

## What print-md ships

A standalone binary built with `bun build --compile`, via the inline compile
step in the release workflow's `build-cli` job (`.github/workflows/release.yml`:
`bun build src/cli.ts --compile --target=<target> --outfile=…`, one matrix leg
per platform). Users download a single executable from GitHub Releases —
no Node, no Bun, no `node_modules` on the host. The CLI also runs from source
via `bun packages/cli/src/cli.ts` during development.

## print-md Primary Goals
> [!ALERT]
> VERY IMPORTANT: All changes to this repo MUST comply with these goals.
> All changes must REDUCE complexity unless it can be properly justified.

- Create a way for non-technical writers to easily publish print materials using markdown and modern CSS
- Allow most authors to write and perform layout using simple markdown syntax
- Allow non-technical users to style their projects by setting CSS custom properties
- Make handling page layout trivial
- Allow authors to convert markdown and CSS into print ready PDFs
- Simplify the process of creating 


## Architectural rules

These are non-negotiable for any change that touches the runtime or build
pipeline.

### 0. Author-first primitive layering

Default, author-facing layout primitives belong in the most general reusable
layer that can own them:

1. Put generic markdown authoring behavior in core print-md / `markdown-it-paged`
2. Put project-specific component chrome and macro semantics in that project's
   plugin and component CSS layer
3. Put book-specific positioning and context-only break tuning in that book's
   override CSS layer

If a behavior is broadly useful to non-technical authors using simple markdown,
fix the default/core primitive first instead of solving it only in a project or
override layer.

### 0b. Resize review screenshots before judge runs

Before any AI visual review or three-judge design gate run, resize or otherwise
reduce screenshot payloads so they stay small enough to survive agent context
compaction.

1. Do not send large full-resolution chapter screenshots directly to judges.
2. Prefer smaller JPEGs or tighter page-range batches that remain legible.
3. Treat screenshot sizing as part of the review pipeline, not an optional
   cleanup step.

If review evidence is too large to stay in context, the judge pass is invalid
and must be re-run with resized screenshots.

### 1. No bundlers at runtime (packages/cli only)

Do **not** import `vite`, `rollup`, `esbuild`, or any other bundler at runtime
(eager or lazy) inside `packages/cli/src/`. Bundlers carry native bindings,
large transitive graphs, and `package.json`/`__dirname`-relative resolution
patterns that break under `bun build --compile`. Past attempts to ship vite
inside the binary required a compile-time regex plugin to rewrite
`JSON.parse(readFileSync(new URL("../package.json", import.meta.url)))`
patterns inside `node_modules` — a hack we are eliminating.

If you need a dev server with live reload, use **`node:http` + the `ws`
package** — not `Bun.serve`. The lib runtime must stay Bun-API-free (see the
Monorepo layout section above: no `Bun.serve`/`Bun.file`) so Electron's bundled
Node can run it in-process; `Bun.serve` would work under Bun but crash the
packaged viewer. The actual implementation
(`packages/cli/src/preview/http-server.ts`) is a `node:http` static file
server + a `ws` WebSocket server that broadcasts a "full-reload" message on
file change — Node-compatible, runs under both Bun (dev / compiled binary)
and Node.js (Electron), with no bundler involved.

### 2. Lazy-load heavy optional deps

Anything used by a single subcommand (e.g. `puppeteer-core` in `print-md build`)
should be imported with a dynamic `import()` inside the command handler, not at
top-level. This keeps `print-md --help` fast and isolates failures to the
specific command path.

### 3. Keep the binary free of deps that need filesystem resolution at runtime

The compiled binary must be fully self-contained — **there are currently zero
source rewrites** (`scripts/compile-plugin.ts` was removed when stylelint was
dropped). stylelint was the one offender: it read its own `package.json` and
`css-tree` data at runtime AND loaded its ~200 rule modules via a computed-path
dynamic `import()` that no bundler can embed. CSS print-safety checks now run on
**postcss** (`packages/cli/src/lib/printsafe.ts`), which bundles cleanly.

If a future dep breaks under `--compile` (runtime `package.json`/data reads,
`createRequire` JSON, or computed-path dynamic imports), prefer to **drop it**
(rule 1). Only if it is essential, re-introduce a narrow build-time `onLoad`
rewrite plugin — each rewrite targeting one exact `node_modules` file, guarded
by the exact source pattern. Never use `bun patch` (it needs re-patching on
every dep bump).

### 4. Embedded static assets are fine

`with { type: "file" }` imports and `packages/cli/src/lib/embedded-assets.ts`'s
extraction pattern are the **canonical** way to ship the viewer chrome
(HTML/CSS/JS) inside the binary. This pattern works under `bun build --compile`
and should not be rewritten.

### 5. Plugins are plain markdown-it plugins

User plugins loaded via the manifest follow the standard `(md, options) => void`
markdown-it signature. Do **not** introduce a print-md-specific plugin API
(no host-injected `ctx` arg, no required base class, no custom hooks).
Reasons:

  1. Any of the hundreds of markdown-it plugins on npm Just Works in print-md.
  2. Plugin authors cannot reliably import from `@dimm-city/print-md` because
     the compiled binary has no `node_modules` for plugin code to resolve
     against. If a plugin needs an internal helper, it must inline-copy it
     (e.g. a plugin's marker parser should be an inlined copy of
     `markdown-it-paged`'s `parseMarkerLine`, not an import).
  3. `packages/cli/src/index.ts` re-exports type-only definitions
     (`PrintMdPlugin`, `PrintMdPluginMetadata`, `PrintMdPluginExport`) for
     TypeScript plugin authors. Types only — zero runtime coupling.

Plugin loader (`packages/cli/src/lib/markdown/plugins.ts`) does NOT auto-install
missing npm packages, and has two load modes via `loadPlugins(configs, baseDir,
onError?)`:

  - **Fail-fast (no `onError`)** — build/export/validate. Any load error aborts
    the whole operation with a message identifying the offending manifest entry.
    A final artifact must never silently omit author-configured formatting.
  - **Degrade-and-report (`onError` supplied)** — the LIVE PREVIEW only. A plugin
    the author enabled but hasn't installed yet is skipped, `onError` fires
    (the preview `warn`s; the viewer Plugins panel already shows it as "Not
    installed" with fix instructions), and the rest of the document still
    renders. This is NOT the silent-skip that the loader deliberately removed —
    every skip is surfaced loudly. Rationale: one uninstalled plugin must not
    blank a non-technical author's entire preview.

Authoring guide lives in [User Guide: Chapter 6 — Plugins](./examples/print-md-user-guide/06-plugins.md).

**Block container syntax** (`:::name ... :::` via `markdown-it-container`) was
removed 2026-05-17. The DC plugin's `@marker` family (`@page`, `@section`,
`@sidebar`, `@callout`, etc.) is the canonical author surface for wrapped
blocks. Do NOT reintroduce `markdown-it-container` to core.

### 6. `markdown-it-paged` owns its full contract

The inlined `packages/cli/src/lib/markdown/markdown-it-paged.js` owns: markers
→ tokens → HTML emission → the supporting CSS (`PAGED_CSS` named export).
`index.ts` imports the CSS and injects it; it does NOT override the plugin's
renderer rules or maintain its own layout state. Per-render state lives on
`env.__colSplitDepth`, not a module-level closure, so a thrown render can't
leak depth state into the next chapter.

### 7. Git/source operations are Node-native — no external OS tools (0.4.0+)

The upcoming project-source / version-history / GitHub features (milestones
0.4.0 and 0.5.0 — see GitHub issues #12, #13, #14, #15, #16, #25) must perform
**all Git and GitHub operations with a Node-native, pure-JS implementation
(e.g. `isomorphic-git`)**. Non-negotiable:

- **Do NOT shell out to the system `git` binary.** The user must not be required
  to have Git installed, and we do **not** bundle a Git binary on any platform
  (this supersedes the original "bundle Git on Windows" framing of #16).
- **Do NOT depend on the GitHub CLI (`gh`)** or any other external CLI. GitHub
  API access uses the REST API directly (`fetch` / a JS SDK such as
  `@octokit/rest`), authenticated via the managed GitHub App / OAuth token.
- **Default new projects to a local Git repo** (`git init` + automatic
  "snapshot" commits) so non-technical users get local version control with **no
  credentials and no remote**, plus an **escape hatch** to run as a plain
  `local-folder` (no Git) when Git can't or shouldn't be used.
- **Shared lib, not duplicated.** Project scaffolding (with embedded-asset
  templates), source-type detection/capabilities, and the Git/provider layer
  live in `@dimm-city/print-md` and are consumed by **both** the CLI
  (`print-md new`, etc.) and the viewer — one implementation, two thin
  front-ends.

Rationale: this keeps the `bun build --compile` CLI binary and the packaged
viewer fully self-contained (consistent with §1/§3) and makes the features work
for users with nothing pre-installed. NOTE: the existing PDF-validation external
tools (qpdf/gs/pdf* via `execCapture`) are a separate, pre-existing concern and
are unaffected by this rule — this rule governs the new Git/source surface only.

### 8. Platform abstraction — the renderer is host-agnostic; the host runs platform code (CORE REQUIREMENT)

> [!ALERT]
> This is a **non-negotiable core architecture requirement** for the viewer and
> for **every Electron application started in this org** — it is the gold
> standard, applied by default. See `docs/adr/0004-platform-abstraction.md`.

The viewer is an Electron shell hosting a **SvelteKit SPA** (built with
`@sveltejs/adapter-node`). The SPA is written so it could run unchanged in a
browser PWA tomorrow. To make that true — and to keep the desktop build correct
— the renderer never contains host/Node code; it reaches the host through one
of two seams, chosen by capability class, and both keep the SPA "PWA-clean."

**Transport.** In production, Electron main starts the adapter-node handler
(`build/handler.js`) on a local `127.0.0.1` HTTP server and serves the window
via the `app://` protocol, which proxies each request to that server with
`fetch`. Host capabilities the renderer needs are reached two ways: the bulk
(status, fs, dialog, theme, plugin, remote/sync, vcs, recovery, …) are ordinary
`src/routes/api/**/+server.ts` HTTP routes the SPA calls with `fetch("/api/…")`;
a **narrow** `ipcMain`/preload bridge carries only the things a plain HTTP
request can't — the push-event streams (build progress, folder-changed, sync
status, updater events) and the preview/build pipeline calls that drive a live
BrowserWindow. Either way the renderer stays PWA-clean — a `+server.ts` route is
host Node code that happens to live under `src/routes/`, and it never leaks into
the client bundle.

**The renderer (the SPA, everything under `packages/viewer/src/`) MUST stay
"PWA-clean": it contains ZERO platform/host code.**

- **No runtime imports from `@dimm-city/print-md`** in the SPA. `import type`
  is fine (erased at build). A *value* import (e.g. `import { checkCss }`) drags
  the Node-target lib — and its transitive `fileURLToPath`/`node:*`/`postcss`/
  `isomorphic-git` code — into the browser bundle, which builds fine (vite shims
  `node:*`) but **crashes at runtime**. This exact mistake shipped a `500`/
  `fileURLToPath is not a function` crash in 0.4.0-beta.4.
- **No `node:*` / `fs` / `path` / `url` / `child_process` / `postcss` imports**
  in the SPA. Node-oriented libraries (postcss included) belong in the host.

**Two seams, not one.** The route-first split (server route + `fetch()`) is
the **default path** and the one most of the app actually uses today: 26+
files call `src/lib/api.ts` directly (`+page.svelte` alone has 33 `api.*`
call sites), not through `getPlatform()`. The `Platform`/`HostServices` seam
(`src/lib/platform/contract.ts` + `ElectronAdapter`/`WebAdapter`, reached via
`import { getPlatform, isDesktop } from "$lib/platform"`) is real and still
owns three narrower capability classes a plain route can't cover:

1. **Push streams** the renderer subscribes to (build progress,
   folder-changed, sync status, updater events) — an `onX(cb) => unsubscribe`
   shape needs a live event channel, not request/response.
2. **Calls that must drive a live `BrowserWindow`** — preview/build
   orchestration, PDF export via `webContents.printToPDF`.
3. **FSA-divergent fs primitives** — the handful of file operations where the
   web implementation is a genuinely different algorithm (File System Access
   API handles) rather than a thin `fetch()` wrapper.

Everything else — status, dialog, theme, plugin, remote/sync, vcs, recovery,
settings, recents/favorites, and so on — is a server route + a typed
`api.ts` wrapper, called directly as `api.<ns>.<op>(...)`. Whichever seam a
capability uses, app code never touches `window.electron`/`ipcRenderer`
directly (only `electron-adapter.ts` may).

**Adding a new host capability.**

**(A) Default: a server route.** Covers essentially everything (see the list
above).

1. `src/routes/api/<ns>/<op>/+server.ts` — the real Node work (may `import`
   `@dimm-city/print-md`, `node:*`, postcss, isomorphic-git — it runs in main,
   never in the client bundle)
2. `src/lib/api.ts` — the typed `fetch("/api/<ns>/<op>")` wrapper; components
   call `api.<ns>.<op>(...)` directly. No `contract.ts` / `HostServices` /
   adapter changes needed.

**(B) Platform adapter — only for the three capability classes above.**

1. `src/lib/platform/contract.ts` — add it to `HostServices` (define payload
   types **locally**, decoupled from the lib)
2. `ElectronAdapter` (call through the `api` wrapper, or IPC — next step) and
   `WebAdapter` (a real implementation, or an explicit reject/no-op if the
   capability has no web behavior yet — see "Dormant PWA scaffolding" below)
3. If it's a push stream or must drive a live `BrowserWindow`, also wire the
   **IPC bridge**: `electron/main.ts` — `ipcMain.handle("ns:op", …)` (or a
   `webContents.send` push channel); `electron/preload.ts` — expose it on
   `contextBridge`; `electron/types.d.ts` — add it to the `Window.electron`
   shape; `contract.ts` — add it to `ElectronBridge`

**The canonical fix when node code is needed by the UI:** don't bundle it into
the renderer — run it in the host and expose it as a server route (default) or,
for the three narrower classes, through `getPlatform()`. Example: CSS
print-safety linting (`checkCss`) is postcss-based, so it runs host-side (the
`api/lint/check-css` server route) and the editor's lint gutter calls
`getPlatform().checkCss(...)` — routed through the adapter here because
CodeMirror's lint-source contract expects one async function to hand it, not
because every route needs a `Platform` method; the route itself is still the
(A) path.

**Svelte 5 conventions: `$effect` is banned in the SPA.** Enforced by eslint
(`no-restricted-syntax` in `packages/viewer/eslint.config.*`) — the error
message lists the sanctioned alternatives (onMount for DOM setup/cleanup,
event handlers for user-triggered state, `$derived` + `class:` bindings for
reactive presentation, `{#key}` for identity re-init, `untrack()` for one-time
reads). For imperative side-effects on settings changes specifically, use the
settings store's `onSettingsChange()` channel with `settingsChangeGuard()`
(see `src/lib/settings.svelte.ts`'s header) — every state replacement flows
through one choke point, so the notify cannot be forgotten by a new setter.

**Dormant PWA scaffolding (`WebAdapter`, kept for #33).** The PWA remains a
goal, so `WebAdapter` (`src/lib/platform/web-adapter.ts`) intentionally keeps a
partial, currently-unreachable implementation of several capabilities —
IndexedDB-backed recents/favorites/viewer-prefs, a `localStorage` settings
fallback, File System Access primitives — even though today's live settings
path is `api.app.getSettings`/`setSettings` (a server route, `isDesktop()`-
gated). This is **dormant scaffolding, not dead code to delete**: it is the
starting point for the #33 PWA milestone. When #33 lands, expect the relevant
`api.ts` call sites to migrate to `getPlatform()` so the same UI code serves
both Electron (`ElectronAdapter` → the existing server routes) and the browser
(`WebAdapter`'s now-live implementation); until then, `api.ts` is the correct
call site for those capabilities on the Electron target.

**Verification (must pass before any viewer change is "done"):** the client
SPA bundle must contain no host code — adapter-node emits the browser assets
to `build/client/`, and this is now **enforced automatically** by ONE script,
`tools/check-render-purity.mjs`: CI runs it (`.github/workflows/ci.yml`) and
the viewer's `npm run build` runs it with `--strict` (absent dir or zero
scannable files = failure). It fails on host code — the named leak
identifiers (`fileURLToPath`/`createRequire`/`isomorphic-git`), any quoted
`node:*` specifier, or a bare builtin `require()` (generated from
`builtinModules`, never hand-listed) — anywhere under `build/client/`.
Two caveats keep this honest:
(1) the server side — `build/server/`, `build/handler.js`, and the
`+server.ts` routes compiled into it — is host Node code by design; the check
scopes to `build/client/` only. (2) Rollup tree-shaking can HIDE a leak from
the production scan while `vite dev` (no tree-shaking) still crashes on it —
this is exactly how a shared bun-build chunk topped with `createRequire`
leaked through `@dimm-city/print-md/render` in 2026-07. The lib side
therefore has its own gate: `packages/cli`'s build compiles `src/render.ts`
as a separate non-split `bun build` graph and runs
`scripts/check-render-pure.mjs`, which fails if the `dist/render.js` closure
contains any Node builtin or `createRequire`. Treat a hit from either gate as
a release-blocking regression. (The
`bun build --compile` CLI binary is the *opposite* environment — it bundles the
lib's Node code on purpose; §1/§3 govern it. This rule governs the renderer.)

Why this is the default for new Electron apps: the renderer/host split is the
only thing that keeps an Electron UI portable to web, testable without a host,
and free of the "works in `vite dev`, crashes in the packaged app" trap. Build
the typed route + wrapper (or, for the three narrower classes, the adapter
seam) **first**, before the first feature adds a host call.

## Design-guide / DC-brand work has moved out of this repo

The Dimm City design guide — the seven-file CSS layer contract, the
`dc-components`/`fg-overrides` ownership rules, the Contextual Cascade pattern's
DC-specific application, the specialty variant system, the frozen chapter-opener
composite, and the R1–R12 paged.js CSS anti-patterns — used to live in
`examples/dc-design-guide/` here. That example was removed (commit `db0f0fc`)
and the full design guide now lives in the **`dc-op-manual`** repo
(`dc-op-manual/dc-design-guide/`). Do that work there, against that repo's
own guidance.

What remains relevant to **this** repo:

- The general, brand-agnostic CSS architecture pattern is documented in
  [`docs/contextual-cascade-principle.md`](./docs/contextual-cascade-principle.md),
  with a worked implementation in [`examples/with-design-guide/`](./examples/with-design-guide/).
- The frozen chapter-opener's **plugin** half still lives in this repo at
  `packages/cli/src/lib/markdown/markdown-it-paged.js` (`@chapter` parsing,
  `data-chapter-label` propagation, `.chapter-opener` injection); its CSS half
  moved to dc-op-manual. The full frozen contract and the durable paged.js CSS
  anti-patterns are preserved in AKM
  (`memory:print-md-dc-design-guide-frozen-chapter-opener-historical`,
  `memory:print-css-architectural-anti-patterns`).

## Background reading

- The "No bundlers at runtime" rule (§1 above)
- `packages/viewer/README.md` — viewer dev and packaging instructions
- [Single-file executable — Bun](https://bun.com/docs/bundler/executables)
- [Embed directory in executable with `bun build --compile` (#5445)](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly (#15374)](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` (#13405)](https://github.com/oven-sh/bun/issues/13405)
