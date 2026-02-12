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

### Key Features

- **Multi-format output**: PDF, HTML, and preview bundles
- **Live preview server**: Hot reload with Vite
- **Extensible markdown**: Plugin system for custom syntax
- **CSS Paged Media**: Full control over print layout
- **Bun-native**: Fast runtime with native TypeScript support

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
- Strategy pattern for output formats
- Modular architecture for easy maintenance

## Core Architecture

### Module Structure

```
src/
├── cli.ts                  # CLI entry point (citty framework)
├── types.ts                # Central type definitions
├── constants.ts            # Application constants
│
├── commands/               # CLI command implementations
│   ├── run.ts              # Full pipeline orchestration (6 steps)
│   ├── validate.ts         # Print validation command
│   ├── convert.ts          # Markdown → HTML
│   ├── build.ts            # HTML → PDF via Chromium + Paged.js
│   ├── lint.ts             # CSS linting
│   ├── assets.ts           # Asset copying
│   └── preview.ts          # Live preview server
│
├── checks/                 # Validation check system
│   ├── types.ts            # Check, CheckResult, CheckContext interfaces
│   ├── registry.ts         # Self-registration pattern + getChecks()
│   ├── runner.ts           # Orchestrates check execution + filtering
│   ├── formatter.ts        # Text/JSON output formatting
│   ├── tool-check.ts       # Pre-run tool availability detection
│   ├── source/             # Pre-build: tool wrappers (markdownlint, etc.)
│   ├── pdf/                # Post-build: PDF structural/print checks
│   ├── asset/              # Pre-build: image/font validation
│   └── heuristic/          # Post-build: quality proxy checks
│
├── lib/                    # Core libraries
│   ├── exec.ts             # Process execution (run, execCapture)
│   ├── manifest.ts         # Manifest loading + config resolution
│   ├── presets.ts           # Vendor presets (DTRPG)
│   ├── pdf-parse.ts        # PDF parsing utilities
│   ├── ghostscript.ts      # PDF/X CMYK conversion
│   ├── logger.ts           # Colored console output
│   └── markdown/           # Markdown processing + plugins
│
├── schema/                 # Type definitions
│   └── manifest.types.ts   # PrintMdManifest + ResolvedConfig
│
├── preview/                # Preview server
│   ├── routes.ts           # API route handlers
│   └── ...
│
└── utils/                  # Shared utilities
    ├── logger.ts           # Preview logger
    ├── file-utils.ts       # File operations
    └── path-security.ts    # Path security validation
```

### Data Flow

```
User Input (CLI)
    ↓
Configuration Manager (loads manifest.yaml + resolveConfig)
    ↓
Pipeline Orchestrator (run.ts — 6 steps)
    │
    ├── 1. CSS Linting (stylelint)
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
- **Source (4)**: Tool wrappers for markdownlint, htmlhint, stylelint + callout validation
- **PDF (15)**: Structure, page size, color spaces, fonts, ink coverage, transparency, bleed, bookmarks, etc.
- **Asset (8)**: Image size/DPI/color space/alpha, font references/licenses
- **Heuristic (4)**: Text density, section density, layer count, placement variance

## Build Pipeline

### 1. Configuration Resolution

**Location**: `src/config/config-state.ts`

The `ConfigurationManager` class merges configuration from multiple sources:

1. **CLI arguments** (highest priority)
2. **manifest.yaml** (project configuration)
3. **Default values** (fallback)

```typescript
class ConfigurationManager {
  async initialize() {
    this.manifest = await loadManifest(this.inputDir);
    this.mergedConfig = this.mergeConfiguration();
  }

  getConfig(): ResolvedConfig {
    return { ...this.mergedConfig, ...(this.manifest || {}) };
  }
}
```

**Design Rationale**:
- Centralized configuration reduces bugs
- Clear precedence order prevents confusion
- Lazy loading improves startup time

### 2. Markdown Processing

**Location**: `src/markdown/markdown.ts`

#### Plugin Architecture

Markdown extensions use a **global singleton pattern** with dynamic rule enable/disable:

```typescript
// Create once with ALL plugins
const globalMarkdownEngine = createPagedMarkdownEngine({
  ttrpg: true,
  dimmCity: true,
  containers: true
});

// Enable/disable rules per render
function configureMarkdownRules(md: MarkdownIt, extensions?: MarkdownExtensionOptions) {
  if (enableTtrpg) {
    md.enable(ttrpgRules, true);
  } else {
    md.disable(ttrpgRules, true);
  }
}
```

**Design Rationale**:
- Avoids recreating parser for each render (performance)
- Allows per-file extension configuration
- Maintains plugin state across renders

#### CSS Cascade

Styles are applied in a carefully designed cascade:

1. **Default Styles** (inlined) - Foundation layer
   - Bundled CSS from `src/assets/core/`
   - Can be disabled with `disableDefaultStyles: true`

2. **User Styles** (inlined with resolved @imports)
   - Two-tier resolution:
     - Check bundled themes (`src/assets/themes/`)
     - Fall back to user directory
   - All `@import` statements resolved and inlined

**Design Rationale**:
- Self-contained HTML output (no external dependencies)
- Predictable cascade order
- Supports both bundled themes and custom CSS

### 3. Format Strategies

**Location**: `src/build/formats/`

Uses the **Strategy Pattern** to support multiple output formats:

```typescript
interface FormatStrategy {
  build(options: BuildOptions, htmlContent: string): Promise<string>;
  validateOutputPath(path: string, force: boolean): OutputValidation;
  cleanup(options: BuildOptions): Promise<void>;
}
```

**Implementations**:

1. **PdfFormatStrategy** (`pdf-format.ts`)
   - Launches Chromium via Playwright API
   - Serves HTML via Bun.serve on ephemeral port
   - Waits for Paged.js render lifecycle
   - Calls `page.pdf()` to generate PDF output

2. **HtmlFormatStrategy** (`html-format.ts`)
   - Writes standalone HTML file
   - Includes CDN link to Paged.js
   - Requires online access

3. **PreviewFormatStrategy** (`preview-format.ts`)
   - Injects Paged.js polyfill inline
   - Creates self-contained bundle
   - Works offline

**Design Rationale**:
- Easy to add new formats without modifying core
- Each strategy encapsulates format-specific logic
- Clear separation of concerns

## Preview Server

### Dual-Server Architecture

**Location**: `src/server.ts`

Preview mode uses **two servers** working together:

```
User Browser → http://localhost:{port}
    ↓
Vite Dev Server
    ├─→ Serves preview.html with Paged.js
    ├─→ Hot Module Replacement (HMR)
    ├─→ API Middleware (handled by Bun)
    │    ├─→ /api/directories
    │    ├─→ /api/change-folder
    │    ├─→ /api/heartbeat
    │    └─→ /api/shutdown
    └─→ Static assets
```

**Components**:

1. **Vite Server** (auto-assigned port)
   - Serves preview content
   - Provides HMR for instant updates
   - Asset bundling and transformations

2. **API Middleware** (Bun-powered)
   - Directory navigation
   - Folder switching (triggers rebuild)
   - Client connection tracking
   - Server shutdown

**Design Rationale**:
- Vite provides best-in-class HMR
- Bun handles API logic efficiently
- Single port for user (Vite auto-assigns its own)

### File Watching

**Location**: `src/build/watch.ts`

Uses **Chokidar** for cross-platform file watching:

```typescript
const watcher = watch(inputPath, {
  persistent: true,
  ignoreInitial: true,
  ignored: /(^|[\/\\])\../,  // Ignore dot files
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50
  }
});

watcher.on('all', debounce(async (event, path) => {
  // Rebuild on change
}, 100));
```

**Features**:
- Debounced rebuilds (100ms default)
- Prevents overlapping builds
- Watches markdown, CSS, and manifest.yaml

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

**Location**: `src/utils/config.ts`

Comprehensive validation with helpful error messages:

```typescript
export function validateManifest(manifest: unknown, manifestPath: string): Manifest {
  // Type checks
  if (m.title !== undefined && typeof m.title !== 'string') {
    throw new Error(`title must be a string, got ${typeof m.title}`);
  }

  // Path validation
  if (path.isAbsolute(style)) {
    throw new Error(`styles[${index}] must be a relative path`);
  }

  // Security checks
  if (normalized.startsWith('..')) {
    throw new Error(`styles[${index}] cannot reference paths outside directory`);
  }
}
```

**Design Rationale**:
- Fail fast with clear error messages
- Prevent security issues (path traversal)
- Guide users to correct configuration

## Extension System

### Plugin Registration

```typescript
// src/markdown/markdown.ts
let markdownLib = new MarkdownIt()
  .use(imgSize)
  .use(anchors)
  .use(coreDirectivesPlugin);

if (enableDimmCity) {
  markdownLib.use(dimmCityPlugin, {
    districtBadges: true
  });
}

if (enableTtrpg) {
  markdownLib.use(ttrpgDirectivesPlugin, {
    statBlocks: true,
    diceNotation: true,
    // ... other options
  });
}
```

### Plugin Example

```typescript
// src/markdown/plugins/ttrpg-directives-plugin.ts
export default function ttrpgDirectivesPlugin(
  md: MarkdownIt,
  options?: TtrpgPluginOptions
): void {
  if (options?.statBlocks) {
    md.inline.ruler.push('stat_block', statBlockRule);
  }

  if (options?.diceNotation) {
    md.inline.ruler.push('dice_notation', diceNotationRule);
  }

  // ... register other rules
}
```

**Design Rationale**:
- Modular plugin system
- Granular feature control
- Easy to add new extensions

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

### 3. Why Vite for Preview?

**Chosen over**: Custom server, webpack-dev-server

**Reasons**:
- Best-in-class HMR experience
- Fast rebuild times
- Minimal configuration
- Strong TypeScript support
- Battle-tested in production

### 4. Why Strategy Pattern for Formats?

**Chosen over**: Switch statements, Factory pattern

**Reasons**:
- Easy to add new formats
- Each format is self-contained
- Testable in isolation
- Clear interface contract

### 5. Why Global Markdown Engine?

**Chosen over**: Create new instance per render

**Reasons**:
- Performance (avoid recreating parser)
- State preservation (rule caching)
- Enable/disable API is fast

### 5. Why Custom Error Classes?

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
- **Incremental Updates**: Vite's HMR updates only changed modules
- **Connection Tracking**: Auto-shutdown prevents resource leaks

## Testing Strategy

### Unit Tests

- Located alongside source files
- Test individual functions/classes
- Fast, isolated, deterministic

### Integration Tests

- Located in `tests/integration/`
- Test complete workflows
- Use real files and temp directories

### Test Coverage Goals

- **Critical paths**: 100% (build, config, validation)
- **Overall**: 80%+
- **Edge cases**: Explicit tests for error conditions

---

## Future Considerations

### Potential Improvements

1. **Parallel Processing**: Process multiple markdown files concurrently
2. **Caching**: Cache processed markdown to speed up rebuilds
3. **Incremental Builds**: Only rebuild changed files
4. **Plugin Marketplace**: Community-contributed plugins
5. **Visual Editor**: WYSIWYG editor with live preview

### Technical Debt

1. **Refactor `startPreviewServer()`**: Currently 466 lines, should be split
2. **Add Runtime Validation**: Consider Zod for schema validation
3. **Improve Test Coverage**: Especially for server and build modules

---

**Last Updated**: 2025-11-18
**Version**: 0.1.0
