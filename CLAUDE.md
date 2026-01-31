# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**print-md** is a markdown-to-PDF converter for professional print layout. It converts markdown files to HTML using markdown-it with hardcoded container directives, then renders to PDF using **Chromium + Paged.js**. Optional PDF/X conversion (CMYK) is available via Ghostscript with the `--pdfx` flag. The preview mode uses Vite with HMR for live development.

## Architecture

### Build Pipeline

The pipeline is: **Markdown -> HTML -> Chromium+Paged.js -> PDF** (optionally -> Ghostscript -> PDF/X CMYK).

1. **Markdown Processing** (`src/lib/markdown/index.ts`)
   - Converts markdown to HTML using markdown-it
   - Hardcoded container types via `markdown-it-container`: `page`, `sidebar`, `wrapper`, `ability`, `ability-continued`, `specialty`, `learning-path`, `container`, `aug`
   - Image path fixing and styled image conversion (`src/lib/markdown/images.ts`)
   - Container rendering helpers (`src/lib/markdown/containers.ts`)
   - Key functions: `createMarkdownRenderer()`, `renderChapters()`, `renderChaptersToFile()`

2. **PDF Generation** (`src/commands/build.ts`)
   - Serves HTML via local Bun server
   - Launches Chromium via Playwright
   - Injects Paged.js polyfill (`src/lib/pagedjs.ts`) for CSS Paged Media support
   - Waits for `window.__PAGED_RENDERED__` marker before capturing PDF
   - Uses `page.pdf()` for output

3. **PDF/X Conversion** (optional, `src/lib/ghostscript.ts`)
   - Triggered by `--pdfx x1a|x3` flag
   - Strips PDF annotations via `qpdf`
   - Converts to CMYK via Ghostscript with ICC profile (`profiles/CGATS21_CRPC1.icc`)
   - Applies Total Area Coverage (TAC) limiting via UCR/BG functions

4. **PDF Validation** (`src/commands/validate.ts`)
   - Page size verification
   - Font embedding checks
   - CMYK color space validation
   - TAC (Total Area Coverage) analysis
   - Rasterized page detection

5. **CSS Linting** (`src/commands/lint.ts`)
   - Print-safety checks via stylelint custom plugin (`src/stylelint/printsafe-plugin.cjs`)
   - Detects remote URLs, risky CSS properties (filter, blend-mode, etc.)

### CLI Commands

The CLI uses **citty** framework (`src/cli.ts`):

```bash
# Full pipeline: lint -> convert -> assets -> build -> validate
bun src/cli.ts run --input ./my-book

# Individual commands
bun src/cli.ts convert --input ./my-book --out ./dist    # Markdown -> HTML
bun src/cli.ts build --input ./dist/book.html --out book.pdf  # HTML -> PDF
bun src/cli.ts build --input ./book.html --out book.pdf --pdfx x1a  # PDF/X CMYK
bun src/cli.ts validate --pdf book.pdf                    # PDF compliance
bun src/cli.ts lint --dir ./my-book/css                   # CSS print-safety
bun src/cli.ts assets --input ./my-book --out ./dist      # Copy static assets

# Preview mode (live dev server with HMR)
bun src/cli.ts preview [input] --port 3000
bun src/cli.ts preview --no-watch
bun src/cli.ts preview --open false
```

### Preview Mode

**Vite-based Architecture** (`src/server.ts`, `src/preview/`):
- Vite dev server with custom API middleware
- Hot Module Replacement (HMR) for instant updates
- File watching via chokidar with debounced rebuild
- Toolbar UI with folder navigation, page controls, view modes

**Preview Modules:**
- `src/server.ts` - Entry point, orchestrates server startup
- `src/preview/server-context.ts` - Server state and client tracker
- `src/preview/file-watcher.ts` - File watching and HTML regeneration
- `src/preview/lifecycle.ts` - Preview restart and shutdown
- `src/preview/vite-setup.ts` - Vite server configuration
- `src/preview/routes.ts` - API route handlers (directory listing, folder change, GitHub clone)
- `src/preview/api-middleware.ts` - Vite middleware integration

**API Endpoints:**
- `GET /api/directories?path={path}` - List subdirectories (restricted to home directory)
- `POST /api/change-folder` - Switch preview to different directory
- `POST /api/clone-repo` - Clone GitHub repository
- `GET /api/current-folder` - Get current working directory
- `GET /api/metadata` - Get project metadata

**Preview Client** (`src/assets/preview/`):
- `scripts/preview.js` - Toolbar UI, folder modal, page navigation
- `scripts/interface.js` - Paged.js integration, `window.previewAPI`
- `styles/` - Preview CSS
- `index.html` - Preview UI shell

### Configuration System

**Manifest file** (`manifest.yaml`), loaded by `src/lib/manifest.ts`:
- Project metadata (title, authors, description)
- Page format (size, margins, bleed, cropMarks)
- Styles array - CSS file paths
- Files array - explicit markdown file ordering (optional, defaults to alphabetical `chapter-*.md`)
- Preset support (e.g., DTRPG preset from `src/lib/presets.ts`)

**Configuration Resolution** (`src/lib/manifest.ts`):
- `loadManifest(dir)` - Loads and parses YAML manifest
- `resolveConfig(manifest, cliOverrides)` - Merges manifest + CLI + preset defaults
- Precedence: CLI options > manifest.yaml > preset > defaults

**Types** (`src/schema/manifest.types.ts`):
- `PrintMdManifest` - Partial manifest as loaded from YAML
- `ResolvedConfig` - Fully resolved config with all defaults applied

### Key Modules

**Core Library (`src/lib/`):**
- `manifest.ts` - Manifest loading and config resolution
- `markdown/index.ts` - Markdown-to-HTML pipeline
- `markdown/containers.ts` - Container directive rendering
- `markdown/images.ts` - Image path and style handling
- `chromium.ts` - Chromium executable discovery
- `pagedjs.ts` - Paged.js polyfill injection
- `ghostscript.ts` - CMYK conversion and PDF/X
- `pdf-parse.ts` - PDF introspection (fonts, ink coverage, page size)
- `presets.ts` - Vendor presets (DTRPG)
- `exec.ts` - Subprocess utilities (`run()`, `execCapture()`, `copyDir()`)
- `logger.ts` - Colored console logger

**Commands (`src/commands/`):**
- `build.ts` - HTML -> PDF via Chromium+Paged.js
- `convert.ts` - Markdown -> HTML
- `validate.ts` - PDF compliance checks
- `lint.ts` - CSS print-safety linting
- `assets.ts` - Static file copying
- `run.ts` - Full pipeline orchestration
- `preview.ts` - Preview server wrapper

**Utilities (`src/utils/`):**
- `file-utils.ts` - Bun-native file operations
- `errors.ts` - Custom error classes (BuildError, ConfigError)
- `logger.ts` - Legacy logging (used by preview)
- `path-security.ts` - Path validation and security
- `gh-cli-utils.ts` - GitHub CLI integration (auth, clone, user info)

**Schema (`src/schema/`):**
- `manifest.types.ts` - TypeScript interfaces for manifest/config

**Stylelint (`src/stylelint/`):**
- `printsafe-plugin.cjs` - Custom print-safety rules
- `stylelint.config.cjs` - Stylelint configuration

**Other:**
- `src/types.ts` - Preview-related TypeScript interfaces
- `src/constants.ts` - Application constants (DEFAULT_PORT, DEBOUNCE, MANIFEST filename)
- `profiles/CGATS21_CRPC1.icc` - ICC color profile for CMYK conversion

### Assets Directory

`src/assets/` structure:
- `fonts/` - Web fonts
- `preview/` - Preview mode assets (scripts, styles, index.html)
- `favicon.ico` - Favicon
- `index.html` - Preview shell

## Common Commands

```bash
# Install dependencies
bun install

# Install Playwright Chromium (required for PDF generation)
bunx playwright install chromium

# Full pipeline (lint, convert, build, validate)
bun src/cli.ts run --input ./my-book

# Convert markdown to HTML
bun src/cli.ts convert --input ./my-book --out ./dist

# Build PDF from HTML
bun src/cli.ts build --input ./dist/book.html --out book.pdf

# Build PDF/X CMYK (requires ghostscript, qpdf)
bun src/cli.ts build --input ./book.html --out book.pdf --pdfx x1a

# Validate PDF
bun src/cli.ts validate --pdf book.pdf

# Lint CSS for print safety
bun src/cli.ts lint --dir ./my-book/css

# Copy static assets
bun src/cli.ts assets --input ./my-book --out ./dist

# Preview mode
bun src/cli.ts preview ./my-book
bun src/cli.ts preview --port 5000

# Run all tests
bun test

# Run specific test file
bun test src/utils/file-utils.test.ts

# Run tests in watch mode
bun test --watch
```

## Development Workflow

### Testing

Tests use Bun's built-in test runner:

```typescript
import { describe, test, expect } from "bun:test";

test("description", () => {
  expect(value).toBe(expected);
});
```

Test files:
- `src/utils/file-utils.test.ts` - File system operations
- `src/utils/logger.test.ts` - Logger functionality
- `src/preview/routes.test.ts` - API route handlers
- `src/preview/server-context.test.ts` - Server state management
- `src/preview/file-watcher.test.ts` - File watching and HTML regeneration
- `src/preview/vite-setup.test.ts` - Vite server configuration

### Adding New Container Types

To add a new markdown container directive:

1. Edit `src/lib/markdown/containers.ts` to add container rendering logic
2. Register the container in `createMarkdownRenderer()` in `src/lib/markdown/index.ts`
3. Add CSS for the container type in your project's stylesheets

### Code Patterns

**Configuration Cascade**: CLI > Manifest > Preset > Defaults

**Bun-Native APIs**: Prefer `Bun.file()`, `Bun.write()` over Node.js equivalents

**Error Handling**: Use custom error classes (`BuildError`, `ConfigError`) from `src/utils/errors.ts`

**Subprocess Execution**: Use `run()` and `execCapture()` from `src/lib/exec.ts`

## External Dependencies

**Required for PDF generation:**
- Chromium (installed via `bunx playwright install chromium`)

**Optional for PDF/X CMYK conversion:**
- Ghostscript (`gs`) - CMYK color conversion
- qpdf - PDF annotation stripping

**Optional for GitHub integration:**
- GitHub CLI (`gh`) - Repository cloning and authentication

## Notes

- This project uses CC-BY license
- You have to restart the server to see changes in the src/assets folder
- Markdown files must follow the `chapter-*.md` naming convention for automatic discovery
- The Paged.js polyfill handles CSS Paged Media in Chromium (which lacks native support)
