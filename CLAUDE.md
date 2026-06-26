# CLAUDE.md — guidance for AI coding sessions on this repo

## Monorepo layout

This repo is a Bun workspace with two packages:

- **`packages/cli/`** (`@dimm-city/print-md`) — the single published package:
  ALL runtime logic (markdown rendering, preview HTTP server, PDF generation via
  puppeteer-core, lint, validation — under `src/`) **and** the CLI entry
  (`src/cli.ts`). It exposes a library (`exports` → `dist/index.js`) and a CLI
  (`bin` → `dist/cli.js`). Built the standard way: `bun build` (the three
  entrypoints, `--target=node --packages=external --splitting`) + `tsc` for
  `.d.ts` — see the package.json `build` script; deps are normal `dependencies`,
  not bundled. Also ships as a standalone single-file binary via `bun build
  --compile` (the `compile` script / release `bun build … --compile`). The
  no-bundlers-at-runtime rule (§1 below) applies to this package.
- **`packages/viewer/`** (`@dimm-city/print-md-viewer`) — Electron desktop
  app with a static SvelteKit SPA frontend. The SPA is built with
  `@sveltejs/adapter-static` and served by Electron via a custom `app://`
  protocol handler. The 3 API endpoints (status, preview, build) are
  `ipcMain.handle()` calls, not HTTP routes. The Electron main + preload are
  built by **electron-vite** to `out/main/main.js` + `out/preload/`; the main
  is ESM and loads the lib with a plain dynamic `import("@dimm-city/print-md")`
  (no CJS→ESM `new Function` bridge — that was removed when the build moved to
  electron-vite + asar, commit `c5e75ae`). No afterPack hook; electron-builder
  packages the lib + its transitive deps from the workspace `node_modules` via
  its standard dep walker (puppeteer-core is `asarUnpack`ed; PDF export itself
  uses Electron's own Chromium via `webContents.printToPDF` — see ADR 0002).
  See [project_viewer_architecture] memory + `packages/viewer/README.md` for the
  full picture.

The lib's runtime is Node.js-compatible — no `Bun.serve`/`Bun.file`/
runtime Bun APIs. `with { type: "file" }` is used as a build-time syntax
only; bun build compiles it to plain string constants in the dist output.
This is what enables the viewer to run with Electron's bundled Node.
Bun is required for development (workspace install, lib build, CLI
compile, tests) but NOT for end users of the packaged viewer.

## What print-md ships

A standalone binary built with `bun build --compile` (the package.json
`compile` script: `bun build src/cli.ts --compile …`). Users download a single
executable from GitHub Releases — no Node, no Bun, no `node_modules` on the host.
The CLI also runs from source via `bun packages/cli/src/cli.ts` during development.

## print-md Primary Goals
> [!ALERT]
> VERY IMPORTANT: All changes to this repo MUST comply with these goals.
> All changes must REDUCE complexity unless it can be properly justified.

- Create a way for non-technical writes to easily publish print materials using markdown and modern CSS
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

If you need a dev server with live reload, use **`Bun.serve`** with its built-in
`websocket` upgrade. The historical use case (`packages/cli/src/preview/`) is a
static file server + a "full-reload" websocket message on file change — which is
exactly what `Bun.serve` provides natively in ~150 lines without any bundler.

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
> standard, applied by default. See ADR 0004 (platform abstraction; kept under `.docs-archive/`).

The viewer is an Electron shell hosting a **static SvelteKit SPA**. The SPA is
written so it could run unchanged in a browser PWA tomorrow. To make that true —
and to keep the desktop build correct — there is exactly **one seam** between the
UI and the host, and it is honoured absolutely:

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
- **All host work goes through the platform adapter.** App code does
  `import { getPlatform, isDesktop } from "$lib/platform"` and calls
  `platform.X(...)` — a platform-agnostic, typed, async API. It never touches
  `window.electron`/`ipcRenderer` directly (only `electron-adapter.ts` may).

**Adding a new host capability** means wiring it across the **five layers**, then
calling it via `getPlatform()`:

1. `electron/main.ts` — `ipcMain.handle("ns:op", …)` (the real Node work)
2. `electron/preload.ts` — expose it on the `contextBridge` object
3. `electron/types.d.ts` — add it to the `Window.electron` shape
4. `src/lib/platform/contract.ts` — add it to `HostServices` + `ElectronBridge`
   (and define any payload types **locally**, decoupled from the lib)
5. `ElectronAdapter` (delegate to `bridge().op`) **and** `WebAdapter` (stub:
   reject / throw / safe no-op until the PWA lands)

**The canonical fix when node code is needed by the UI:** don't bundle it into
the renderer — run it in the host and expose a narrow async method. Example:
CSS print-safety linting (`checkCss`) is postcss-based, so it runs in `main` via
a `lint:checkCss` IPC and the editor's lint gutter calls
`getPlatform().checkCss(...)` (CodeMirror accepts a `Promise` lint source).

**Verification (must pass before any viewer change is "done"):** after
`npm run build`, the SPA bundle must contain no host code —
`grep -rlE "fileURLToPath|node:module|createRequire|node:fs|node:url|isomorphic-git" build/_app/`
must output **nothing**. Treat a hit as a release-blocking regression. (The
`bun build --compile` CLI binary is the *opposite* environment — it bundles the
lib's Node code on purpose; §1/§3 govern it. This rule governs the renderer.)

Why this is the default for new Electron apps: the renderer/host split is the
only thing that keeps an Electron UI portable to web, testable without a host,
and free of the "works in `vite dev`, crashes in the packaged app" trap. Build
the typed adapter seam **first**, before the first feature adds a host call.

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
