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

**print-md** is a markdown-to-PDF converter for professional print layout. It uses Prince XML for PDF generation and Vivliostyle for live preview. It's designed as a single-user local application optimized for creating print-ready documents like books, game manuals, and professional reports.

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
├── cli.ts                  # CLI entry point (Commander.js)
├── types.ts                # Central type definitions
├── constants.ts            # Application constants
│
├── build/                  # Build orchestration
│   ├── build.ts            # Main build function
│   ├── watch.ts            # File watching for auto-rebuild
│   ├── asset-copier.ts     # Asset management
│   ├── build-validator.ts # Input validation
│   └── formats/            # Format strategies
│       ├── pdf-format.ts   # PDF generation via pagedjs-cli
│       ├── html-format.ts  # Standalone HTML output
│       └── preview-format.ts # Offline viewer bundle
│
├── markdown/               # Markdown processing
│   ├── markdown.ts         # Main processor
│   ├── core/               # Core functionality
│   │   ├── core-directives-plugin.ts
│   │   └── assets.ts       # Default CSS bundling
│   └── plugins/            # Extension plugins
│       ├── ttrpg-directives-plugin.ts
│       ├── dimm-city-plugin.ts
│       └── ...
│
├── preview/                # Preview server
│   ├── routes.ts           # API route handlers
│   └── ...
│
├── config/                 # Configuration management
│   └── config-state.ts     # ConfigurationManager class
│
├── server.ts               # Preview server (Vite + Bun)
│
└── utils/                  # Shared utilities
    ├── logger.ts           # Logging utility
    ├── errors.ts           # Custom error classes
    ├── file-utils.ts       # File operations
    ├── config.ts           # Config loading/validation
    ├── path-validation.ts  # Security validation
    └── ...
```

### Data Flow

```
User Input (CLI/Preview UI)
    ↓
Configuration Manager (loads manifest.yaml)
    ↓
Build Orchestrator (build.ts)
    ↓
Markdown Processor (markdown.ts)
    ├── Core Directives Plugin
    ├── TTRPG Plugin (optional)
    └── Dimm City Plugin (optional)
    ↓
HTML Generation
    ↓
Format Strategy (PDF/HTML/Preview)
    ↓
Output File(s)
```

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
   - Spawns `pagedjs-cli` subprocess
   - Passes HTML via stdin
   - Monitors for timeout/errors

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

# Page format
format:
  size: "6in 9in"
  margins: "0.75in"
  bleed: "0.125in"

# Styles (processed in order)
styles:
  - themes/classic.css
  - custom-overrides.css

# File ordering (optional)
files:
  - intro.md
  - chapter-01.md
  - chapter-02.md

# Extensions (optional)
extensions:
  - ttrpg
  - dimm-city
```

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

### 2. Why Vite for Preview?

**Chosen over**: Custom server, webpack-dev-server

**Reasons**:
- Best-in-class HMR experience
- Fast rebuild times
- Minimal configuration
- Strong TypeScript support
- Battle-tested in production

### 3. Why Strategy Pattern for Formats?

**Chosen over**: Switch statements, Factory pattern

**Reasons**:
- Easy to add new formats
- Each format is self-contained
- Testable in isolation
- Clear interface contract

### 4. Why Global Markdown Engine?

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
