# Architecture Documentation

This document describes the architecture, design decisions, and implementation details of print-md.

## Table of Contents

- [Overview](#overview)
- [Design Principles](#design-principles)
- [Core Architecture](#core-architecture)
- [Build Pipeline](#build-pipeline)
- [Preview Server](#preview-server)
- [Configuration System](#configuration-system)
- [Extension System](#extension-system)
- [Key Design Decisions](#key-design-decisions)

## Overview

**print-md** is a markdown-to-PDF converter for professional print layout. It uses Chromium + Paged.js for PDF generation and Paged.js for live preview. It's designed as a single-user local application optimized for creating print-ready documents like books, game manuals, and professional reports.

### Monorepo structure

The repo is a Bun workspace with three packages:

- **`packages/cli/`** (`@dimm-city/print-md`) — CLI binary. Thin shell over `@dimm-city/print-md-lib`. Distributed as a standalone compiled binary via `bun build --compile`.
- **`packages/lib/`** (`@dimm-city/print-md-lib`, private) — all runtime logic: markdown rendering, preview HTTP server, PDF generation, lint, validation. Pure ESM. Consumed by both the CLI and the viewer as a workspace dependency.
- **`packages/viewer/`** (`@dimm-city/print-md-viewer`) — Electron + SvelteKit desktop app. Imports `@dimm-city/print-md-lib` as a workspace dependency.

### Key Features

- **Multi-format output**: PDF, HTML, and preview bundles
- **Live preview server**: Bun-native HTTP+WebSocket with full-reload on file change
- **Extensible markdown**: Plugin system for custom syntax
- **CSS Paged Media**: Full control over print layout
- **Bun-native**: Fast runtime with native TypeScript support
- **Desktop app**: Electron viewer with toolbar UI, page navigation, and PDF export

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
│   ├── build.ts            # Unified pipeline: html | pdf | pdfx
│   ├── preview.ts          # Headless preview server launcher
│   ├── validate.ts         # Print validation
│   ├── lint.ts             # CSS linting
│   ├── audit.ts            # Asset-only validation
│   └── preflight.ts        # Structured CI preflight payload
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
│   ├── pagedjs.ts          # Paged.js HTML patching
│   ├── assets.ts           # Asset handling
│   ├── logger.ts           # Colored console output
│   └── markdown/           # Markdown processing
│       ├── index.ts        # Main renderer (createMarkdownRenderer)
│       ├── plugins.ts      # Plugin loader
│       ├── images.ts       # Image path processing
│       └── markdown-it-paged.js  # Inlined paged layout plugin
├── schema/
│   └── manifest.types.ts   # PrintMdManifest + ResolvedConfig
├── preview/                # Preview server modules
│   ├── routes.ts           # API route handlers
│   ├── server-context.ts   # Server context
│   ├── http-server.ts      # Bun.serve + WebSocket dev server
│   ├── file-watcher.ts     # File change detection
│   ├── api-middleware.ts   # API middleware
│   └── lifecycle.ts        # Server lifecycle
├── utils/                  # Shared utilities
│   ├── file-utils.ts       # File operations
│   ├── logger.ts           # Preview logger
│   ├── errors.ts           # Error definitions
│   └── path-security.ts    # Path security
└── assets/                 # Static assets
    ├── manifest.schema.json # JSON schema
    └── preview/            # Embedded viewer chrome (Paged.js, pagedjs-interface)
```

### Data Flow

```
User Input (CLI)
    ↓
Configuration Manager (loads manifest.yaml + resolveConfig)
    ↓
Pipeline Orchestrator (run.ts — 6 steps)
    │
    ├── 1. CSS Linting (print-safety / postcss)
    ├── 2. Pre-build Validation (source + asset checks)
    ├── 3. Markdown → HTML Conversion
    ├── 4. Asset Copying (css, fonts, images)
    ├── 5. HTML → PDF Build (Chromium + Paged.js)
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

**31 checks across 4 categories:**
- **Source (4)**: markdownlint + htmlhint wrappers, print-safety CSS checks (postcss), callout validation
- **PDF (15)**: Structure, page size, color spaces, fonts, ink coverage, transparency, bleed, bookmarks, etc.
- **Asset (8)**: Image size/DPI/color space/alpha, font references/licenses
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
  cliOverrides: Partial<PrintMdManifest>,
  manifest: PrintMdManifest
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

The `createMarkdownRenderer()` factory function creates a fully-configured MarkdownIt instance with the `markdown-it-paged` layout plugin and attribute support. Custom plugins from the manifest are applied at creation time via `applyPlugins()` from `packages/cli/src/lib/markdown/plugins.ts`:

```typescript
// Creates a new MarkdownIt instance with all built-in plugins
function createMarkdownRenderer(customPlugins?: LoadedPlugin[]): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  md.use(markdownItAttrs);
  md.use(markdownItPaged, { implicitPage: false }); // Primary layout: @spread, @page, @section, @end-section, @page-break, @column-break

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
- `markdown-it-paged` registered early as the primary layout plugin (`@spread`, `@page`, `@section`, `@end-section`, `@page-break`, `@column-break`)
- Plugin loading is separate (`plugins.ts`) from renderer creation (`index.ts`)

#### CSS Cascade

Styles are applied in a carefully designed cascade:

1. **Default Styles** (inlined) - Foundation layer
   - Bundled CSS from `packages/cli/src/assets/core/`
   - Can be disabled with `disableDefaultStyles: true`

2. **User Styles** (inlined with resolved @imports)
   - Two-tier resolution:
     - Check bundled themes (`packages/cli/src/assets/themes/`)
     - Fall back to user directory
   - All `@import` statements resolved and inlined

**Design Rationale**:
- Self-contained HTML output (no external dependencies)
- Predictable cascade order
- Supports both bundled themes and custom CSS

### 3. HTML-to-PDF Build

**Location**: `packages/cli/src/commands/build.ts`

The build command renders HTML to PDF directly via Playwright's Chromium integration. There are no separate format strategy classes; the build pipeline is a single linear flow:

```typescript
async function renderHtmlToPdf(inputHtml: string, outPdf: string) {
  // 1. Serve HTML via Bun.serve on a random port
  const server = Bun.serve({ port, async fetch(req) { /* serve files from stage dir */ } });

  // 2. Launch Chromium via Playwright
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();

  // 3. Navigate to HTML page, wait for Paged.js render
  await page.goto(`http://localhost:${port}/${htmlFilename}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as any).__PAGED_RENDERED__ === true);

  // 4. Generate PDF
  await page.pdf({ path: outPdf, printBackground: true, preferCSSPageSize: true });
  await browser.close();
}
```

**Optional PDF/X conversion**: When `--format pdfx` is specified, the build command runs Ghostscript (`packages/cli/src/lib/ghostscript.ts`) to convert the Chromium PDF to CMYK PDF/X-1a or PDF/X-3, with optional annotation stripping for compliance.

**Design Rationale**:
- Direct Playwright rendering eliminates subprocess overhead
- Bun.serve as local file server avoids file:// protocol issues
- Ghostscript post-processing handles CMYK conversion separately from rendering

## Preview Server

### Bun-native HTTP + WebSocket

**Location**: `packages/cli/src/preview/http-server.ts`, `packages/cli/src/preview/api-middleware.ts`,
`packages/cli/src/preview/routes.ts`

Preview mode runs a single `Bun.serve` instance that handles static files,
the `/api/*` route table, and a `/__print-md-hmr` WebSocket for full-reload
broadcasts. There is no toolbar, page navigation, or folder picker — those
live in the Electron viewer (`packages/viewer`).

```
User Browser / Electron Viewer → http://localhost:{port}
    ↓
Bun.serve (packages/cli/src/preview/http-server.ts)
    ├─→ /__print-md-hmr  WebSocket → broadcastReload()
    │    (subscribers receive {type:"full-reload"} on file change)
    ├─→ /api/*           handleApiRequest (api-middleware.ts → routes.ts)
    │    └─→ GET  /api/status            (handleStatus — reports hasInput + currentPath)
    └─→ /*               Bun.file from state.tempDir
         ("/" redirects to book.html; HTML responses get a tiny inline
          HMR client injected before </body>; `..` traversal returns 404)
```

**Design Rationale**:
- The previous Vite-based dev server was the wrong shape: print-md doesn't
  bundle anything at preview time, it serves a pre-rendered `book.html`. Vite's
  CSS-as-JS-module pipeline and module-graph HMR were actively bypassed by
  custom plugins.
- `Bun.serve` provides static serving, WebSockets (with built-in pub/sub via
  `server.publish(topic, data)`), and request routing natively — exactly the
  surface print-md needs, with no native bindings to extract under
  `bun build --compile`.
- See `docs/adr/0001-no-bundlers-at-runtime.md` for the full rationale and
  links to the upstream Bun issues that motivated the change.

### File Watching

**Location**: `packages/cli/src/preview/file-watcher.ts`

Uses **Chokidar** for cross-platform file watching:

```typescript
function createFileWatcher(state: ServerState): FSWatcher {
  const watcher = watch(state.currentInputPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /(^|[\/\\])\../,  // Ignore dot files
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  let rebuildTimer: NodeJS.Timeout | null = null;

  watcher.on('all', async (event, filePath) => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      if (state.isRebuilding) return;
      state.isRebuilding = true;
      // Re-copy changed file, reload config, regenerate HTML
      const manifest = await loadManifest(state.currentInputPath);
      state.config = resolveConfig({}, manifest);
      await generateAndWriteHtml(state.currentInputPath, state.tempDir, state.config);
      state.isRebuilding = false;
    }, DEBOUNCE.FILE_WATCH);
  });

  return watcher;
}
```

**Features**:
- Debounced rebuilds (configurable via `DEBOUNCE.FILE_WATCH` constant)
- Prevents overlapping builds via `isRebuilding` guard
- Watches markdown, CSS, and manifest.yaml
- Re-copies changed files to temp directory before regenerating

**Design Rationale**:
- Chokidar handles platform differences
- Debouncing prevents excessive rebuilds
- Stability threshold waits for file writes to complete

### Client Connection Tracking

**Auto-shutdown feature**:

```typescript
const connectedClients = new Set<string>();
const AUTO_SHUTDOWN_DELAY = 5000; // 5 seconds

function checkForAutoShutdown() {
  if (connectedClients.size === 0) {
    setTimeout(() => {
      if (connectedClients.size === 0) {
        shutdown();
      }
    }, AUTO_SHUTDOWN_DELAY);
  }
}
```

**Design Rationale**:
- Prevents resource leaks from abandoned servers
- Graceful shutdown with delay
- Cancels if client reconnects

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
  assets:                   # Directories to copy as assets
    - css
    - fonts
    - images

# Output configuration
output:
  dir: dist
  filename: book.pdf
  html: book.html

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
    allowedCallouts: ["sidebar", "ability"]
  assets:
    maxImageSize: 10000000
    minImageDpi: 300
  pdf:
    forbidTransparency: true
  heuristics:
    textDensityRange: { min: 200, max: 5000 }
```

See the [Validation Guide](validation.md) for full configuration reference.

### Validation

**Location**: `packages/cli/src/lib/manifest.ts`

Manifest loading uses `loadManifest()` and `loadManifestWithPath()` which parse YAML and return typed objects. Configuration merging in `resolveConfig()` applies the CLI > manifest > preset cascade for every field, with the preset providing safe defaults for any unspecified values:

```typescript
// loadManifest searches for manifest.yaml/manifest.yml
export async function loadManifest(pathOrDir?: string): Promise<PrintMdManifest> {
  // Checks path candidates: exact path, then manifest.yaml, then manifest.yml
  // Returns empty object if no manifest found
}

// resolveConfig ensures every field has a value via cascade
export function resolveConfig(
  cliOverrides: Partial<PrintMdManifest>,
  manifest: PrintMdManifest
): ResolvedConfig {
  const preset = PRESETS[presetName] ?? DTRPG_PRESET;
  return {
    title: c.title ?? m.title ?? "Document",
    // ... each field follows CLI > manifest > preset
  };
}
```

**Design Rationale**:
- No separate validation step needed; YAML parsing + TypeScript types handle structure
- Preset defaults ensure every field has a value even with empty manifests
- Path security handled separately in `packages/cli/src/utils/path-security.ts`

## Extension System

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
1. **User's project** (manifest directory `node_modules`)
2. **print-md's own dependencies**
3. **Fail fast** — if a plugin can't be found, the build errors with a clear message identifying the plugin and the install command to run

print-md does **not** auto-install plugins. The user must install plugins in
their project directory before running the build. This keeps builds
reproducible and prevents network access during `print-md build`.

**Design Rationale**:
- Manifest-driven plugin declaration keeps configuration explicit
- Priority sorting controls plugin load order
- Fail-fast on missing plugins surfaces misconfiguration immediately rather than silently skipping
- CSS export support allows plugins to inject styles into rendered output

See [User Guide: Chapter 6 — Plugins](../examples/print-md-user-guide/06-plugins.md) for the full authoring guide.

## Key Design Decisions

### 1. Why Bun?

**Chosen over**: Node.js, Deno

**Reasons**:
- Native TypeScript support (no build step needed)
- Faster startup and execution
- Built-in test runner
- Modern APIs (fetch, WebSocket)
- Better DX for single-user tools

### 2. Why Playwright + Chromium for PDF?

**Chosen over**: Prince XML, Puppeteer, pagedjs-cli subprocess

**Reasons**:
- Open-source and cross-platform (macOS, Linux, Windows)
- Chromium engine supports full CSS Paged Media
- Playwright API is more modern than Puppeteer
- Direct page rendering eliminates subprocess overhead
- Built-in PDF generation with `page.pdf()`
- Better TypeScript support
- Predictable rendering with Paged.js polyfill

### 3. Why Bun.serve for Preview (not Vite)?

**Chosen over**: Vite, webpack-dev-server, custom Node http server.

**Reasons**:
- print-md does not bundle code at preview time — it serves a pre-rendered
  `book.html` and triggers full-reload on file change. A bundler-based dev
  server is the wrong tool.
- `Bun.serve` provides everything needed (static files, WebSocket pub/sub,
  request routing) without the transitive native bindings (rollup,
  lightningcss, fsevents) that break under `bun build --compile`.
- The previous Vite setup required two custom plugins solely to *bypass*
  Vite's CSS pipeline and module graph, plus a compile-time regex plugin to
  rewrite `package.json` reads in `node_modules/vite`. Removing Vite
  removed both layers of workarounds.
- See `docs/adr/0001-no-bundlers-at-runtime.md`.

### 4. Why Electron + SvelteKit for the Desktop Viewer?

**Chosen over**: extending the CLI preview server with a toolbar

**Reasons**:
- Non-technical users need a native-feeling app with folder picker, page
  navigation, and PDF export — not a browser tab.
- SvelteKit is built as a static SPA via `@sveltejs/adapter-static` and
  served by Electron through a custom `app://` protocol handler. No
  in-process HTTP server, no bundled Bun runtime. The renderer reaches
  the lib through `ipcMain.handle()` rather than `fetch()`.
- The lib (`@dimm-city/print-md-lib`) is Node.js-compatible at runtime
  (`node:http` + `ws` instead of `Bun.serve`, `node:fs` instead of
  `Bun.file`). Electron's bundled Node runs it directly via a dynamic
  `import()` from main.js — no subprocess required.
- Vite/Rollup in the viewer is intentional (web app build) and does not
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
- Built-in containers always registered in predictable order
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

All user-provided paths are validated:

```typescript
export function validateSafePath(targetPath: string, basePath: string): boolean {
  const resolvedTarget = path.resolve(normalizedBase, normalizedTarget);
  const resolvedBase = path.resolve(normalizedBase);

  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal attempt detected');
  }
  return true;
}
```

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
- **Full-Reload over WebSocket**: every file change publishes one `full-reload`
  message; clients refresh and receive freshly-rendered HTML
- **Connection Tracking**: Auto-shutdown prevents resource leaks

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

**Last Updated**: 2026-06-03
**Version**: 0.2.0 (packages/cli + packages/lib + packages/viewer)
