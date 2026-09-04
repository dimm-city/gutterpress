# Architecture Documentation

This document describes the architecture, design decisions, and implementation details of Gutterpress.

## Table of Contents

- [Overview](#overview)
- [Monorepo packages](#monorepo-packages)
- [Design Principles](#design-principles)
- [Core Architecture](#core-architecture)
- [Build Pipeline](#build-pipeline)
- [Preview Server](#preview-server)
- [Desktop Application Architecture](#desktop-application-architecture)
- [Configuration System](#configuration-system)
- [Extension System (markdown-it plugins)](#extension-system-markdown-it-plugins)
- [Public Package Exports](#public-package-exports)
- [Key Design Decisions](#key-design-decisions)

## Overview

**Gutterpress** is a markdown-to-PDF converter for professional print layout. It uses its native Chromium print engine for PDF generation and the same engine's viewer for live preview. It is designed as a single-user local application optimized for creating print-ready documents like books, game manuals, and professional reports. Since the 0.11 source-first editor work, it also ships a shared rich-editing surface reused by the desktop app and an Experimental VS Code extension — see [Monorepo packages](#monorepo-packages) and `docs/adr/0012-source-first-editor-sparse-projection.md` onward.

### Monorepo packages

The repo is a Bun workspace (`packages/*`) with six packages. `packages/cli` and `packages/desktop` are the original two and remain the primary published/shipped surfaces; the other four exist to support the source-first rich editor (`docs/plans/source-first-editor-enterprise-refactor.md`) and are Experimental for 0.11.0. See `docs/OWNERSHIP.md` for the four architectural review boundaries these packages map onto.

- **`packages/cli/`** (`gutterpress`) — the single published package: all runtime logic (markdown rendering, preview HTTP server, PDF generation, lint, validation, project scaffolding, Git/VCS, plugin loading) under `src/`, exposed both as a library and a CLI (`bin` → `dist/cli.js`). Public subpath exports are `.` (the full library), `./api` (manifest/style config mutation), `./render` (the browser-safe, Node-free rendering + projection boundary — ADR 0012), and `./plugins` (the plugin loader — D11's one narrower subpath with a real external consumer today; see [Public Package Exports](#public-package-exports)). The standard build compiles `src/index.ts` + `src/api/index.ts` + `src/plugins.ts` together, the node-free `src/render.ts` subpath as its own non-split graph (render purity enforced by `scripts/check-render-pure.mjs`), and `src/cli.ts` separately; `tsc` then emits declarations. It is also distributed as a standalone compiled binary via `bun build --compile`.
- **`packages/desktop/`** (`@dimm-city/gutterpress-desktop`) — Electron + SvelteKit desktop app. Depends on `gutterpress` (workspace) and loads its library entry in the Electron main process via a dynamic `import("gutterpress")`. See [Desktop Application Architecture](#desktop-application-architecture) below.
- **`packages/editor/`** (`@dimm-city/gutterpress-editor`, Experimental) — the framework-free, browser-safe shared source-first rich editor. Imports `@vscode/markdown-editor` (via the fork below) and `gutterpress/render`; no Svelte, Electron, `vscode`, or `node:*` imports. Mounted by both the desktop app and the VS Code extension so there is one editor implementation, not two. See `docs/adr/0012-source-first-editor-sparse-projection.md` and `docs/adr/0014-shared-editor-package-and-fork.md`.
- **`packages/vscode-markdown-editor/`** (`@dimm-city/vscode-markdown-editor`, internal only — never a public Gutterpress export) — a minimal, bounded internal fork of `@vscode/markdown-editor@0.0.2-85`, adding exactly one generic custom-block rendering hook the upstream package does not expose. `PATCHES.md` records the complete diff against the pinned upstream version and the removal trigger (an equivalent upstream hook shipping natively). See `docs/adr/0014-shared-editor-package-and-fork.md`.
- **`packages/vscode-extension/`** (`@dimm-city/gutterpress-vscode`, Experimental) — the VS Code custom text editor extension built on `packages/editor`. See `docs/vscode-extension.md` for what it does, its trust model, and how to build/test it.
- **`packages/open-design-plugin/`** — an independent markdown-it plugin package, unrelated to the source-first editor work; unchanged by it.

### Key Features

- **Multi-format output**: PDF, HTML, and preview bundles
- **Live preview server**: Node-compatible `node:http` + WebSocket, with
  automatic full-document swaps after source changes
- **Extensible markdown**: Plugin system for custom syntax
- **CSS Paged Media**: Full control over print layout
- **Bun-native**: Fast runtime with native TypeScript support
- **Desktop app**: Electron desktop app with toolbar UI, page navigation, and PDF export

## Design Principles

### 1. **Simplicity Over Complexity**

As a personal/single-user tool, we prioritize:
- Clear, readable code over clever abstractions
- Explicit configuration over magic
- Helpful error messages over silent failures

### 2. **Type Safety**

- Strict TypeScript configuration
- No `any` types in production code
- Comprehensive type definitions in `types.ts`
- Runtime validation for external inputs

### 3. **Performance**

- Bun runtime for fast startup and execution
- Minimal dependencies
- Efficient file operations
- Lazy loading where appropriate

### 4. **Extensibility**

- Plugin system for markdown extensions
- Manifest-driven configuration with preset defaults
- Modular architecture for easy maintenance

## Core Architecture

### Module Structure

```
packages/cli/src/
├── cli.ts                  # CLI entry point (citty framework)
├── types.ts                # Central type definitions
├── constants.ts            # Application constants
├── commands/               # CLI command implementations (thin citty wrappers)
│   ├── new.ts              # Scaffold a project from a built-in template
│   ├── build.ts            # Unified pipeline: html | pdf | pdfx
│   ├── preview.ts          # Headless preview server launcher
│   ├── publish.ts          # Push built output to distribution platforms
│   ├── validate.ts         # Print validation
│   ├── lint.ts             # CSS linting
│   ├── audit.ts            # Asset-only validation
│   ├── preflight.ts        # Structured CI preflight payload
│   ├── doctor.ts           # Check system tools used by Gutterpress
│   └── plugin.ts           # Manage project markdown-it plugins
├── checks/                 # Validation check system
│   ├── types.ts            # Check interfaces
│   ├── registry.ts         # Self-registration + getChecks()
│   ├── runner.ts           # Check execution + filtering
│   ├── formatter.ts        # Text/JSON output
│   ├── tool-check.ts       # Tool availability detection
│   ├── source/             # Pre-build checks
│   ├── pdf/                # Post-build PDF checks
│   ├── asset/              # Pre-build asset checks
│   └── heuristic/          # Post-build quality checks
├── lib/                    # Core libraries
│   ├── exec.ts             # Process execution
│   ├── manifest.ts         # Manifest loading + config resolution
│   ├── presets.ts          # Vendor presets (DTRPG)
│   ├── pdf-parse.ts        # PDF parsing utilities
│   ├── ghostscript.ts      # PDF/X CMYK conversion
│   ├── chromium.ts         # Chromium executable resolution
│   ├── asset-inline.ts     # Inlines CSS/fonts, plans image copies from references
│   ├── output-paths.ts     # dist/<title-slug>/ + <slug>-<format> artifact naming
│   └── markdown/           # Markdown processing
│       ├── index.ts        # Main renderer (createMarkdownRenderer)
│       ├── plugins.ts      # Plugin loader
│       ├── images.ts       # Records every image reference the render emits
│       └── markers.js       # Built-in @marker parser and structural CSS
├── schema/
│   └── manifest.types.ts   # GutterpressManifest + ResolvedConfig
├── preview/                # Preview server modules
│   ├── http-server.ts      # node:http + ws WebSocket dev server (static
│   │                       #   files, the inlined /api/status route, HMR)
│   ├── server-context.ts   # Server state shape
│   ├── file-watcher.ts     # File/dependency watching + full-document rebuild
│   └── lifecycle.ts        # Server startup/shutdown, orphan temp-dir cleanup
├── utils/                  # Shared utilities
│   ├── file-utils.ts       # File operations
│   └── logger.ts           # Leveled logger + command-facing log facade
└── assets/                 # Static assets
    ├── manifest.schema.json # JSON schema
    └── preview/            # Embedded native viewer and preview-interface assets
```

### Data Flow

```
User Input (CLI)
    ↓
Configuration Manager (loads manifest.yaml + resolveConfig)
    ↓
Pipeline Orchestrator (build-runner.ts — 6 steps)
    │
    ├── 1. CSS Linting (print-safety / postcss)
    ├── 2. Pre-build Validation (source + asset checks)
    ├── 3. Markdown → HTML Conversion (records every image reference as it renders)
    ├── 4. Asset Inlining + Copying (lib/asset-inline.ts: stylesheets read and
    │      inlined, fonts embedded as data: URIs, referenced images copied —
    │      nothing is copied that the book doesn't actually reference)
    ├── 5. HTML → PDF Build (native Chromium print engine)
    └── 6. Post-build Validation (PDF + heuristic checks)
    ↓
Output (PDF + validation report)
```

### Validation Architecture

The check system uses a **self-registering pattern**: each check module calls `registerCheck()` at import time. Barrel index files in each category directory trigger registration on import.

```
Check Registry ← registerCheck() at import time
    ↓
Tool Check (tool-check.ts)
    ├── Collect requiredTools from active checks
    ├── Filter out disabled checks (manifest + source tool config)
    ├── Probe system for each tool via `which`
    ├── Warn about missing tools → list affected check IDs
    └── Pass skipped check IDs to runner
    ↓
Runner (runner.ts)
    ├── Get checks from registry (filtered by category/phase/IDs)
    ├── Apply manifest enable/disable (validate.checks map)
    ├── Apply CLI --only/--skip filters
    ├── Skip checks with missing tools (from tool-check)
    ├── Execute each check → CheckResult[]
    ├── Apply severity overrides from manifest
    └── Build RunnerReport (errors/warnings/infos/passed)
    ↓
Formatter (formatter.ts)
    ├── Text format (human-readable, default)
    └── JSON format (structured, for CI)
```

**34 checks across 4 categories:**
- **Source (8)**: markdownlint + htmlhint wrappers, print-safety CSS checks
  (PostCSS), local link/ref checks, layout-marker diagnostics, alt-text and
  heading-order accessibility checks, and leftover sync-merge-marker detection
- **PDF (15)**: Structure, page size, color spaces, fonts, ink coverage, transparency, bleed, bookmarks, etc.
- **Asset (7)**: Image size/DPI/color space/alpha/TAC and font approval/license checks
- **Heuristic (4)**: Text density, section density, layer count, placement variance

## Build Pipeline

### 1. Configuration Resolution

**Location**: `packages/cli/src/lib/manifest.ts`

Configuration is resolved through standalone functions (not a class). Three exported functions handle manifest loading and config merging:

1. **`loadManifest(pathOrDir?)`** - Load manifest.yaml from a path or CWD
2. **`loadManifestWithPath(pathOrDir?)`** - Load manifest and return its directory
3. **`resolveConfig(cliOverrides, manifest)`** - Merge CLI > manifest > preset defaults

Precedence order (highest to lowest):

1. **CLI arguments** (highest priority)
2. **manifest.yaml** (project configuration)
3. **Vendor preset defaults** (fallback, e.g. DTRPG)

```typescript
// resolveConfig merges CLI overrides > manifest > preset defaults
function resolveConfig(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest
): ResolvedConfig {
  const presetName = cliOverrides.preset ?? manifest.preset ?? "dtrpg";
  const preset = PRESETS[presetName] ?? DTRPG_PRESET;
  return {
    title: c.title ?? m.title ?? "Document",
    styles: c.styles ?? m.styles ?? preset.styles,
    // ... each field follows the same CLI > manifest > preset pattern
  };
}
```

**Design Rationale**:
- Simple functions instead of class reduces complexity
- Clear precedence order prevents confusion
- Each field explicitly follows the same override chain

### 2. Markdown Processing

**Location**: `packages/cli/src/lib/markdown/index.ts`

#### Plugin Architecture

The `createMarkdownRenderer()` factory function creates a fully configured
MarkdownIt instance with Gutterpress's built-in marker plugin and attribute
support. Custom plugins from the manifest are applied at creation time via
`applyPlugins()` from `packages/cli/src/lib/markdown/plugins.ts`:

```typescript
// Creates a new MarkdownIt instance with all built-in plugins
function createMarkdownRenderer(customPlugins?: LoadedPlugin[]): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  md.use(markdownItAttrs);
  md.use(gutterpressMarkers); // Local markers.js plugin: @spread, @page, @section, @end-section, @page-break, @column-break

  // markdown-it-container removed 2026-05-17; @-marker family is canonical.

  // Apply custom plugins from manifest
  if (customPlugins && customPlugins.length > 0) {
    applyPlugins(md, customPlugins);
  }

  return md;
}
```

**Design Rationale**:
- Factory function creates fresh instance per render call
- Gutterpress's built-in `markers.js` registered early as the primary layout plugin (`@spread`, `@page`, `@section`, `@end-section`, `@page-break`, `@column-break`)
- Plugin loading is separate (`plugins.ts`) from renderer creation (`index.ts`)

#### CSS Cascade

All CSS ships as ONE inlined `<style data-project-css>` block in `book.html` —
never a `<link>` — in a fixed cascade order (`markdown/assemble.ts`):

1. **Marker primitives** — `MARKER_CSS`, exported by `markers.js`
   (page/section/spread mechanics). Always present.
2. **Core utilities** — `GUTTERPRESS_CSS`, exported by
   `gutterpress-css.ts` (`gp-*` image, positioning, and column vocabulary).
3. **Plugin CSS** - the `css` export of any loaded markdown-it plugin, in
   plugin order.
4. **Project CSS** - the manifest's `styles:` list, resolved and inlined last
   (so project rules win at equal specificity) by `lib/asset-inline.ts`: each
   file is *read*, not linked — local `@import`s are followed and inlined in
   place, and every CSS `url()` resolves relative to the stylesheet that
   references it. Fonts become `data:` URIs; small images inline; images too
   large to inline **and** outside the project are content-addressed under
   `assets/`. Because a stylesheet's own location no longer affects the
   output, a `styles:` entry can point anywhere — a bundled theme
   (`themes/<id>/theme.css`), a project stylesheet, or a shared design system
   in a sibling directory (`../design-guide/styles/guide.css`) — with no
   copying and no destination indirection.

**Design Rationale**:
- Self-contained HTML output (no external dependencies, no `<link>` that can 404)
- Predictable cascade order: layout, then plugins, then the author's own styles
- A missing stylesheet or font is a build error naming the file, instead of a
  silent 404 during pagination that would ship an unstyled artifact

### 3. HTML-to-PDF Build

**Location**: `packages/cli/src/lib/engine.ts` (`buildNativePdf`) and
`packages/cli/src/engine/compiler/build.ts` (`build`).

`buildNativePdf` attaches the engine's CDP client to the pooled Chromium used by
the CLI. The desktop may instead inject an engine browser backed by Electron's
own Chromium. The compiler reads the author's CSS, pins the viewport and print
media to the resolved sheet, synthesizes the CSS Paged Media features Chromium
does not provide directly, prints to a fixpoint when generated page references
require it, runs computed-DOM print-quality audits, and postprocesses the final
bytes.

```typescript
const engineBrowser = await connectChromium((await getBrowser()).wsEndpoint());
const result = await build({ input: htmlFile, browser: engineBrowser, title, author });
await writeFile(outPdf, result.bytes);
return result.diagnostics;
```

**Optional PDF/X conversion**: When `--format pdfx` is specified, the build command runs Ghostscript (`packages/cli/src/lib/ghostscript.ts`) to convert the Chromium PDF to CMYK PDF/X-1a or PDF/X-3, with optional annotation stripping for compliance.

**Design Rationale**:
- An injectable engine `Browser` lets the CLI and packaged Electron desktop
  share one compiler while using pooled external Chromium or Electron's own
  Chromium respectively
- The engine controls printing through its raw-CDP session (`printToPDF`) while
  Puppeteer is limited to launching and pooling the CLI browser
- Ghostscript post-processing handles CMYK conversion separately from rendering

## Preview Server

### Node-compatible HTTP + WebSocket

**Location**: `packages/cli/src/preview/http-server.ts`

Preview mode runs a single `node:http` server (plus a `ws` `WebSocketServer`)
that handles static files, the one `/api/status` route, and a
`/__gutterpress-hmr` WebSocket. A single Markdown edit may use the focused
`content-update` notification, while wider changes use `full-reload`; the
preview shell deliberately handles both by swapping the complete regenerated
book so pagination never depends on per-source isolation wrappers. It does
**not** use `Bun.serve`: the lib runtime must stay Node-compatible so the
Electron desktop can run it in-process on Electron's bundled Node (see
`CLAUDE.md`, Monorepo layout section, and §1). There is no toolbar, page
navigation, or folder picker — those live in the Electron desktop
(`packages/desktop`).

```
User Browser / Electron Desktop → http://127.0.0.1:{port}
    ↓
http.createServer (packages/cli/src/preview/http-server.ts) + ws WebSocketServer
    ├─→ /__gutterpress-hmr  WebSocket upgrade → broadcastReload()
    │    (subscribers receive a content update or {type:"full-reload"};
    │     both replace the complete generated book)
    ├─→ GET /api/status  inlined handler — reports hasInput + currentPath
    │    (the only API route; a separate route-table module was removed as
    │    unneeded scaffolding for one hard-coded endpoint)
    ├─→ /vendor/*, /preview/scripts/*, /favicon.ico
    │                    the process-wide embedded-assets dir, with a
    │                    version ETag (the native viewer bundle is never
    │                    copied per project)
    ├─→ assets/<hash>.*  the inliner's CSS asset plan (state.cssAssets) —
    │                    an exact URL→source map for images too large to
    │                    embed that live OUTSIDE the book (art referenced
    │                    from a repo-root shared stylesheet). Served from
    │                    their real location; nothing is copied.
    └─→ /*               SERVE-IN-PLACE:
         · /book.html (and "/")  → state.tempDir, the ONE generated file
         · everything else       → state.currentInputPath, the REAL project
                                   directory
         HTML responses get a tiny inline HMR client injected before </body>.
         `..` traversal returns 404 (resolveStaticPath), and so does any
         dot-segment request — `/.env`, `/.git/config`, their percent-encoded
         spellings, and `%5C`-separated ones, which `path.resolve` honors on
         Windows (hasDotSegment, lib/static-serve.ts).
```

Serving the project in place — instead of copying the whole tree into `tempDir`
at startup — is what makes preview asset resolution identical to the build's BY
CONSTRUCTION: both read straight off the same real project tree, so a reference
that works in one works in the other. The temp dir holds only generated output.
The dotfile guard is load-bearing precisely because of that: the old whole-tree
copy leaked a project's `.env` into a throwaway directory nobody could name,
while this reads the real thing.

**Design Rationale**:
- The previous Vite-based dev server was the wrong shape: Gutterpress doesn't
  bundle anything at preview time, it serves a pre-rendered `book.html`. Vite's
  CSS-as-JS-module pipeline and module-graph HMR were actively bypassed by
  custom plugins.
- `node:http` + `ws` provides static serving, WebSockets, and request routing
  natively — exactly the surface Gutterpress needs, with no native bindings to
  extract under `bun build --compile`, **and** it runs unmodified under
  Electron's bundled Node (the reason it replaced an earlier `Bun.serve`
  implementation — `Bun.serve` is not available outside the Bun runtime).
- See the "No bundlers at runtime" rule in `CLAUDE.md` §1 for the full rationale
  and links to the upstream Bun issues that motivated the change.

### File Watching

**Location**: `packages/cli/src/preview/file-watcher.ts`

Uses **Chokidar**, in TWO instances:

1. **The book root** (`state.currentInputPath`), recursively. Its `ignored`
   matcher is `isIgnoredWatchPath`, which applies the dotfile rule only to the
   path RELATIVE to the watch root. Chokidar tests matchers against the
   fully-qualified absolute path, so the older `ignored: /(^|[\/\\])\../` also
   matched every dot-prefixed ANCESTOR — a project under `~/.local/share/...`
   had every event rejected, silently disabling the watcher with no error.
2. **Declared external dependencies**, watched PER FILE (never per directory, so
   the set stays exact and cannot pull in a large sibling tree). This is what a
   multi-book repo needs: a book's `styles:` entry may point at
   `../../shared/styles/components.css`, and an authored plugin `path:` at
   `../../shared/plugins/components.js`.

The external set is the stylesheets' full DEPENDENCY CLOSURE, not just the
declared entries: `collectStyleDependencies` follows every active stylesheet's
`@import` chain and each local `url()` it references, over ALL active
stylesheets (a book-local sheet can reference a shared font just as easily), and
only the results that land outside the book are added. A shared theme's
`url("../../fonts/Publisher.woff2")` is a file a design tool can replace without
touching one line of CSS; watching only `theme.css` would leave the preview stale
after that swap with nothing downstream to correct it. Targets that do not exist
yet are watched via their nearest existing ancestor, so declaring a file before
creating it recovers on creation instead of requiring a restart.

**Rebuild path**: every burst — including a CSS-only one — re-renders
`book.html`, because CSS is INLINED into it at render time, so skipping the
re-render would serve stale styles until some later markdown edit. The manifest
is reloaded first and the external subscriptions are re-synced BEFORE rendering,
so a newly declared shared file that does not exist yet is already being watched
when its creation fixes the render. Nothing is copied anywhere: the project is
served in place and stylesheets are inlined, so an external dependency needs
watching, not staging.

**Features**:
- Debounced rebuilds (configurable via `DEBOUNCE.FILE_WATCH` constant),
  coalescing a multi-file rewrite into one full-document rebuild
- Prevents overlapping builds via `isRebuilding`; changes that arrive DURING a
  rebuild stay pending and re-arm the timer rather than being orphaned
- Watches the book recursively plus each declared external dependency's closure

**Design Rationale**:
- Chokidar handles platform differences
- Debouncing prevents excessive rebuilds
- Stability threshold waits for file writes to complete
- Two watchers, not one: watching a missing external target's nearest existing
  ancestor must never unwatch or duplicate the book root

### Client Connection Tracking

**Location**: `packages/cli/src/preview/http-server.ts`, `packages/cli/src/preview/lifecycle.ts`

The WebSocket server keeps a `Set<WebSocket>` of connected HMR clients purely
to broadcast reload messages and `terminate()` them on shutdown — there is no
idle-timeout auto-shutdown. Instead, `lifecycle.ts` writes the process PID to
`<tempDir>/.gutterpress.pid` on startup and, on the *next* preview startup, walks
the shared temp-dir base and removes any leftover dir whose recorded PID is no
longer alive — cleanup for orphaned temp dirs left by a previous run that
didn't shut down cleanly (crash, SIGKILL, terminal hangup), not a live
connection-count timer.

**Design Rationale**:
- Orphan-dir cleanup runs at the next startup rather than a background timer —
  simpler, and it can't shut down a preview that's still in active use
- A PID liveness check avoids deleting a temp dir a still-running instance owns
- Graceful shutdown has its own per-step timeout so a wedged watcher/server
  close can't block process exit indefinitely

## Desktop Application Architecture

**Location**: `packages/desktop/`

The desktop app is an Electron shell hosting a SvelteKit single-page app.
Full detail lives in `packages/desktop/README.md`, root `CLAUDE.md` §8, and
ADRs 0015–0017; this section is the short version for readers of this
document.

### Renderer: a static build, zero host code

`packages/desktop/src/` builds statically via `@sveltejs/adapter-static`
(`build/index.html`, `build/_app/**`, no server bundle) and contains no
platform/host code by architectural requirement: no runtime `gutterpress`
value-import, no `node:*`/`fs`/`path`/`url`/`child_process`/`postcss`
import. `tools/check-render-purity.mjs` enforces this over the whole
`build/` tree in CI and in `npm run build --strict`. Every host capability
the renderer needs is reached through exactly one seam: typed IPC, exposed
to feature code as plain-function **capability modules**
(`src/lib/*/*-capability.ts`, e.g. `src/lib/update/updater-capability.ts`,
`src/lib/remote/remote-capability.ts`,
`src/lib/export/build-preview-capability.ts`,
`src/lib/editor-host/editor-projection-capability.ts`,
`src/lib/app-lifecycle/app-lifecycle-capability.ts`) over the one shared
accessor `src/lib/platform/bridge.ts`. There is no broad `Platform`/
`HostServices` locator and no `getPlatform()` — see ADR 0017 for why that
locator was deleted rather than trimmed.

### Host: Electron main, `app://`, and typed IPC

In production, `electron/app-protocol.ts` registers a custom `app://`
protocol handler that reads the static build tree straight off disk —
including out of the packaged asar — and returns file bytes directly: no
local HTTP server, no proxy, no bearer token (ADR 0016). Every host
capability is a runtime-validated `secureHandle(...)` IPC channel
(~120 registrations) built by the one shared wrapper
`electron/server-bridge/secure-handle.ts`'s `createSecureHandle(...)`
(constructed once in `main.ts`, then handed identically to every
registrar), organized by bounded context into `electron/api/*.ts` (fs,
fs-watch, dialog, shell, log, app, project, manifest, tpl, snip, media,
plugin, theme, vcs, style, updater, recovery, doctor, lint, remote,
publish — one registrar function per file) plus a handful of bespoke
registrars colocated with handler logic that needs a live object
(`electron/export/controller.ts`, `electron/preview/controller.ts`,
`electron/editor-projection.ts`, `electron/pdf-export.ts`,
`electron/github-device-flow-registrar.ts`). A narrow separate set of
`ipcMain`/preload **push channels** — build progress, folder-changed, sync
status, updater events — covers what request/reply cannot: streams the
renderer subscribes to rather than calls.

`electron/main.ts` is a **composition root**: lifecycle (single-instance
lock, second-instance/open-file handling, close gate), window management
(`createWindow()`, security policy — CSP, navigation policy, the `app://`
scheme registration), and OS integration (the folder watcher, prefs/settings
stores) stay inline; it constructs the live objects each registrar needs
(hook implementations, controller instances) and calls each
`register*Handlers(...)` function once, but does not itself own per-context
request handling logic (plan D10/P6b; ADR 0017's "the parallel split").

### The desktop's Svelte composition root

`src/routes/+page.svelte` is the renderer's own composition root: it
instantiates the ~16 feature controllers (project/document/preview/build/
export/media/publishing/remote-sync/settings/diagnostics — one
`*-controller.svelte.ts` per feature boundary, e.g. `ExportController`,
`ProjectSessionController`, `EditorFileSession`, `RichModeController`,
`ContextMenuController`) plus the twelve capability modules above, coordinates
top-level selection and pane layout, and renders the shell. Cross-feature
coordination (global keyboard routing, the rich/source command router,
markdown-file-launch handling) stays explicit in the root by design — the
plan forbids an event bus — rather than being smuggled into a feature
controller that would then own logic outside its named responsibility.

### Design Rationale

- One typed-IPC transport (not typed-IPC-plus-HTTP) means one DTO shape and
  one validation point per capability, and no local network listener in the
  packaged app at all (ADR 0016).
- Narrow, feature-owned capability modules over one shared bridge accessor
  mean a caller's import list states exactly which host capability it
  depends on, instead of a broad locator granting access to everything
  through one import (ADR 0017).
- Both composition roots stay small on purpose: extraction happens only
  where a responsibility and its owner are clear (an established
  `*-controller`/`*-capability` pattern), not as a blanket "smaller files"
  goal — genuinely cross-feature logic is left in the root rather than
  forced into an artificial owner.

## Configuration System

### manifest.yaml Structure

```yaml
# Metadata
title: My Book Title
authors:
  - Author Name

# Styles (processed in order)
styles:
  - css/print.css
  - css/custom.css

# Source files (optional)
source:
  files:                    # If specified, only these files are included in order
    - intro.md
    - chapter-01.md
    - chapter-02.md

# No `output:` block — every build writes to `<manifestDir>/dist/<title-slug>/`,
# and artifacts are named `<title-slug>-<format>.<ext>` (lib/output-paths.ts).
# `--out <path>` overrides this per invocation. There is also no `source.assets`
# list: CSS is read and inlined (fonts embedded as data: URIs), and images are
# copied because the book's own markdown/CSS references them, not because a
# directory was declared (lib/asset-inline.ts).

# Page dimensions
page:
  width: 621
  height: 810
  tolerance: 0.5

# PDF/X settings
pdfx:
  flavor: x1a
  icc: profiles/color-profile.icc
  stripAnnotations: true

# Validation settings
validate:
  enabled: true
  checks:                   # Per-check overrides
    pdf.structure.qpdf: false
  source:
    markdownlint: ".markdownlint.yaml"
  assets:
    maxImageSize: 10000000
    minImageDpi: 300
  pdf:
    forbidTransparency: true
  heuristics:
    textDensityRange: { min: 200, max: 5000 }
```

See the [`with-validation` example](../examples/with-validation/README.md) for a
worked validation configuration.

### Validation

**Location**: `packages/cli/src/lib/manifest.ts`

Manifest loading uses `loadManifest()` and `loadManifestWithPath()` which parse YAML and return typed objects. Configuration merging in `resolveConfig()` applies the CLI > manifest > preset cascade for every field, with the preset providing safe defaults for any unspecified values:

```typescript
// loadManifest searches for manifest.yaml/manifest.yml
export async function loadManifest(pathOrDir?: string): Promise<GutterpressManifest> {
  // Checks path candidates: exact path, then manifest.yaml, then manifest.yml
  // Returns empty object if no manifest found
}

// resolveConfig fills configured/defaulted fields via the cascade; styles stays optional
export function resolveConfig(
  cliOverrides: Partial<GutterpressManifest>,
  manifest: GutterpressManifest
): ResolvedConfig {
  const preset = PRESETS[presetName] ?? DTRPG_PRESET;
  return {
    title: c.title ?? m.title ?? "Document",
    // ... each field follows CLI > manifest > preset
  };
}
```

**Design Rationale**:
- YAML syntax is checked while parsing; TypeScript describes the internal shape
  but does not validate user data at runtime. `resolveConfig()` applies presets,
  defaults, and explicit field checks. The bundled JSON schema supports editors
  and tooling rather than acting as blanket runtime enforcement.
- Preset defaults fill the required resolved fields even with empty manifests;
  `styles` deliberately remains optional so active-style discovery can choose it
- Preview static-file serving performs its own path containment check (`resolveStaticPath` in `packages/cli/src/lib/static-serve.ts`, used by `packages/cli/src/preview/http-server.ts`)

## Extension System (markdown-it plugins)

> Not to be confused with the VS Code extension (`packages/vscode-extension`,
> `docs/vscode-extension.md`) — this section is about author-configured
> markdown-it plugins loaded into the render pipeline, a distinct and older
> concept that shares the word "extension."

### Plugin Loading

**Location**: `packages/cli/src/lib/markdown/plugins.ts`

Plugins are declared in `manifest.yaml` as either local file paths or npm package names. The `loadPlugins()` function resolves and loads them, while `applyPlugins()` registers them with the MarkdownIt instance inside `createMarkdownRenderer()`:

```typescript
// manifest.yaml plugin declaration
plugins:
  - ./plugins/my-custom-plugin.js     # Local file path
  - markdown-it-footnote               # npm package name
  - name: my-scoped-plugin
    path: ./plugins/scoped.js
    priority: 200
    options:
      featureX: true

// Plugin loading from packages/cli/src/lib/markdown/plugins.ts
export async function loadPlugins(
  configs: ResolvedPluginConfig[],
  baseDir: string
): Promise<LoadedPlugin[]>

export function applyPlugins(md: MarkdownIt, plugins: LoadedPlugin[]): void {
  for (const { name, plugin, options } of plugins) {
    md.use(plugin, options);
  }
}
```

### Plugin Interface

A plugin is a function that receives a MarkdownIt instance and optional options. Plugins can also export `metadata` and `css`:

```typescript
// Example custom plugin (ESM default export)
export default function myPlugin(
  md: MarkdownIt,
  options?: Record<string, unknown>
): void {
  md.inline.ruler.push('my_rule', myRuleFunction);
}

// Optional metadata and CSS exports
export const metadata = { name: 'my-plugin', version: '1.0.0' };
export const css = '.my-plugin-class { color: red; }';
```

### Plugin Resolution

Plugins are resolved in this order:
1. **Receipt-verified project-local package graph** (`plugins/npm/`, selected by manifest `name` + exact `version`)
2. **User's project** (`node_modules`, for legacy unpinned manifests)
3. **Gutterpress's own dependencies** (bundled optional features and legacy entries)
4. **Fail fast** — if a plugin can't be found, the build identifies the manifest entry and points to the explicit installer

The loader does **not** install or access the network. Installation is an
explicit desktop action or `gutterpress plugin add` command. Registry metadata is
resolved to an exact root and dependency graph, each tarball integrity is
verified, and a bounded nested `node_modules` tree is safely vendored before an
atomic manifest update. A schema-v2 receipt records provenance, dependency
edges, import/require entries, skipped optional dependencies, and a SHA-256
whole-tree digest. Before loading, the loader snapshots the vendor tree and
verifies that private copy, including each package's declared dependency edges
and export entries. It then copies packages separately into a digest-addressed
process-local tree with no `node_modules` links. Literal ESM imports and
CommonJS requires in the reachable module graph are resolved through the
receipt and rewritten to those private copies; unresolved or nonliteral module
requests fail closed instead of substituting project or ancestor packages.
(Full rationale was ADR 0007, removed in the 2026-07-29 docs cleanup.)

Plugin modules normally expose a default function. A manifest entry may set
`export` to explicitly select a named function when a package exposes several
plugin variants instead.

**Design Rationale**:
- Manifest-driven plugin declaration keeps configuration explicit
- Exact versions, complete project-local dependency trees, and receipts make installs reproducible
- Priority sorting controls plugin load order
- Fail-fast on missing plugins surfaces misconfiguration immediately rather than silently skipping
- CSS export support allows plugins to inject styles into rendered output

See [User Guide: Chapter 5 — Plugins](../examples/gutterpress-user-guide/05-plugins.md) for the full authoring guide.

## Public Package Exports

**Location**: `packages/cli/package.json`'s `exports` map.

| Subpath | Ships | Real consumer today |
|---|---|---|
| `.` | The full library (`dist/index.js`) | The CLI itself; the desktop's every `electron/api/*.ts` registrar via a shared cached `import("gutterpress")` (`electron/api/lib-loader.ts`) — `electron/main.ts` reaches the same package through its own private, identically-shaped `loadLib()`/`libPromise` cache, not through `lib-loader.ts` (each caches its own `import("gutterpress")` once per process); `packages/vscode-extension` |
| `./api` | Manifest/style config mutation surface (`dist/api/index.js`) | Desktop `electron/api/*.ts` handlers, via the same shared-cache pattern (`loadApiLib()`) |
| `./render` | The browser-safe, Node-free rendering + Gutterpress projection boundary (`dist/render.js`) — ADR 0012 | `packages/editor` (projection types/consumers), `packages/vscode-extension` (projection types, protocol messages), the desktop's `electron/editor-projection.ts` |
| `./plugins` | The plugin loader (`loadPlugins`/`loadPluginsWithCss`, `dist/plugins.js`) | The desktop's `electron/editor-projection.ts` (its host-side rich-editor projection builder — this subpath's original motivating consumer, added in SFE-P3e) and `packages/vscode-extension`'s `src/project/projection.ts`, both loading a project's real (receipt-verified, degrade-and-report) plugins outside the CLI's own build/preview path |

`gutterpress`, `gutterpress/api`, and `gutterpress/render` predate the
source-first editor plan and remain supported through 0.11.0 unchanged
(plan D11). `gutterpress/plugins` was added specifically to give
non-CLI hosts the SAME plugin loader the CLI's build/preview path uses,
rather than each host reimplementing a narrower duplicate — the desktop
originally carried exactly such a duplicate (a local-file-only loader) and
was switched to the real export when it was added (deletion ledger,
"SFE-P3e"/"SFE-P6c" entries).

**Declined**: D11 names five further candidate subpaths —
`gutterpress/project`, `gutterpress/build`, `gutterpress/preview`,
`gutterpress/publish`, `gutterpress/vcs`. None has a current consumer: every
existing host (the desktop's Electron main process, the VS Code extension)
reaches those areas of the library through the bare `gutterpress` import —
`electron/api/lib-loader.ts`'s shared `loadLib()` cache for the
`electron/api/*.ts` registrars, `electron/main.ts`'s own private,
identically-shaped `loadLib()` for itself — each a deliberate
one-import-for-the-whole-library design, not an oversight, and a
repository-wide search finds zero import sites for any of the five narrower
specifiers. Per D11's own rule ("add narrower subpath exports only where
current consumers justify them") and the plan's lane discipline against
speculative additions, none of the five is added. Re-evaluate if and when a
real external consumer needs one area of the library without the rest.

**Export tests**: `packages/cli/tests/integration/package-exports.test.ts`
resolves every declared subpath under both Node and Bun (via the package's
own self-reference resolution — no fixture symlink needed), asserts
`gutterpress/render` stays node-free by invoking the existing
`scripts/check-render-pure.mjs` gate directly rather than duplicating its
logic, and asserts every subpath's declared `types`/`default` file is
actually shipped by `npm pack --dry-run`.

## Key Design Decisions

### 1. Why Bun?

**Chosen over**: Node.js, Deno

**Reasons**:
- Native TypeScript support (no build step needed)
- Faster startup and execution
- Built-in test runner
- Modern APIs (fetch, WebSocket)
- Better DX for single-user tools

### 2. Why puppeteer-core + Chromium for PDF?

**Chosen over**: Prince XML, Playwright

**Reasons**:
- Open-source and cross-platform (macOS, Linux, Windows)
- Chromium supplies native paged layout and PDF printing; the Gutterpress
  engine synthesizes the CSS Paged Media features Chromium does not implement
- puppeteer-core ships no bundled browser (we resolve a system/bundled Chromium ourselves)
- Direct page rendering eliminates subprocess overhead
- Direct raw-CDP `printToPDF` generation
- Better TypeScript support
- One native engine shared by CLI export, desktop export, and browser preview

### 3. Why node:http + ws for Preview (not Vite, not Bun.serve)?

**Chosen over**: Vite, webpack-dev-server, `Bun.serve`.

**Reasons**:
- Gutterpress does not bundle code at preview time — it serves rendered HTML
  and swaps the complete regenerated document after an update notification.
  A bundler-based dev server is the wrong tool.
- `node:http` + the `ws` package provides everything needed (static files,
  WebSocket pub/sub, request routing) without the transitive native bindings
  (rollup, lightningcss, fsevents) that break under `bun build --compile`.
- Unlike `Bun.serve` (an earlier implementation), `node:http` + `ws` also runs
  unmodified under Electron's bundled Node, so the same preview server module
  works both in the compiled CLI binary (under Bun) and in-process inside the
  packaged desktop (under Node) — see `packages/cli/src/preview/http-server.ts`.
- The previous Vite setup required two custom plugins solely to *bypass*
  Vite's CSS pipeline and module graph, plus a compile-time regex plugin to
  rewrite `package.json` reads in `node_modules/vite`. Removing Vite
  removed both layers of workarounds.
- See the "No bundlers at runtime" rule in `CLAUDE.md` §1.

### 4. Why Electron + SvelteKit for the Desktop App?

**Chosen over**: extending the CLI preview server with a toolbar

**Reasons**:
- Non-technical users need a native-feeling app with folder picker, page
  navigation, and PDF export — not a browser tab.
- SvelteKit is built with `@sveltejs/adapter-static`, which emits a plain
  static file tree to `build/` (`index.html`, `_app/**`, …) — no server
  bundle. Electron main registers a custom `app://` protocol handler
  (`electron/app-protocol.ts`) that reads that tree straight off disk — out
  of the asar in a packaged build — and returns file bytes directly: no
  local HTTP server, no proxy (SFE-P5d). Host capabilities are exposed
  entirely as typed, runtime-validated IPC channels — `secureHandle(...)`
  request/reply channels (`electron/api/*.ts`) for everything a `+server.ts`
  route used to cover, plus a narrow `ipcMain`/preload push-channel set for
  build progress, folder-changed, sync status, updater events, and calls
  that must drive a live `BrowserWindow` (see `CLAUDE.md` §8). There is no
  `src/routes/api/**` route tree.
- The lib (`gutterpress`) is Node.js-compatible at runtime
  (`node:http` + `ws` instead of `Bun.serve`, `node:fs` instead of
  `Bun.file`). Electron's bundled Node runs it directly via a dynamic
  `import()` from main.js — no subprocess required.
- Vite/Rollup in the desktop app is intentional (web app build) and does not
  conflict with the no-bundlers-at-runtime rule, which applies only to
  `packages/cli/src/`.

### 5. Why Direct Build Pipeline (Not Strategy Pattern)?

**Chosen over**: Strategy pattern with separate format classes

**Reasons**:
- PDF is the primary (and effectively only) build output
- HTML output is a byproduct of the convert step, not a separate strategy
- Preview is handled by a separate server, not the build command
- Simple linear flow is easier to understand and debug

### 6. Why Factory Function for Markdown Renderer?

**Chosen over**: Global singleton with enable/disable

**Reasons**:
- Fresh instance per render avoids state leakage
- Custom plugins applied at creation time via manifest config
- Built-in markers and attributes always registered in predictable order
- Factory pattern allows different plugin sets per render

### 7. Why Custom Error Classes?

**Chosen over**: Generic Error

**Reasons**:
- Type-safe error handling
- Semantic error types
- Better error messages
- Easier debugging

## Security Considerations

### Path Validation

Static-file serving paths are confined to their root directory by shared
guards in `packages/cli/src/lib/static-serve.ts`, which return `null` (turned
into a 403/404 by the caller) rather than throwing:

```typescript
export function resolveWithinRoot(relPath: string, root: string): string | null {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(
    resolvedRoot,
    "." + (relPath.startsWith("/") ? relPath : "/" + relPath)
  );
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return candidate;
}
```

`resolveStaticPath` decodes a URL pathname and delegates to
`resolveWithinRoot`; the preview server (`preview/http-server.ts`) uses both to
confine author assets and chapter-update requests to the selected project.

### Input Sanitization

- File paths normalized and validated
- Manifest fields type-checked
- CLI arguments validated
- No eval() or dynamic code execution

## Performance Considerations

### Build Performance

- **Asset Bundling**: CSS inlined at build time (no runtime resolution)
- **File Operations**: Bun's native APIs are faster than Node.js
- **Lazy Loading**: Modules loaded only when needed

### Preview Performance

- **Debouncing**: File changes debounced (100ms) to prevent excessive rebuilds
- **Full-document swap over WebSocket**: every update — a single Markdown edit
  or a wider CSS/manifest/multi-file/structural change — republishes the
  complete regenerated book; incremental per-chapter splicing was tried and
  removed (2026-08-08 review) because a full swap measured faster end-to-end
- **Orphan cleanup**: leftover preview temp dirs from a run that didn't shut
  down cleanly are removed on the next startup via a PID-liveness check, not
  an idle-connection timer

## Testing Strategy

### Unit Tests

- Located alongside source files
- Test individual functions/classes
- Fast, isolated, deterministic

### Integration Tests

- Located in `packages/cli/tests/integration/`
- Test complete workflows
- Use real files and temp directories

### Test Coverage Goals

- **Critical paths**: 100% (build, config, validation)
- **Overall**: 80%+
- **Edge cases**: Explicit tests for error conditions

---

**Last Updated**: 2026-09-01 (SFE-P6c — monorepo packages, desktop composition
roots, and public exports sections rewritten against the post-P6 tree)
**Version**: packages/cli + packages/desktop 0.10.2 (0.11.0 release pending
final P7 acceptance); packages/editor 0.11.0-experimental.0 (Experimental,
D1/D11)
