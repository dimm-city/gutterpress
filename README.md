# print-md

A CLI tool and desktop app for creating professional print-ready PDFs from markdown. Write your content in markdown and let print-md handle the complex CSS Paged Media layout. Uses Chromium + Paged.js for PDF generation.

## Features

- **Markdown to PDF** - Convert markdown files to professional print layouts
- **Live Preview** - Headless preview server with WebSocket-driven full-reload on file changes
- **HTML static-site output** - `print-md build --format html` produces a deployable directory whose `index.html` is the same viewer the preview server uses. Ideal for [companion design guides](./docs/design-guides.md).
- **Desktop App** - Electron + SvelteKit viewer with toolbar UI, page navigation, and PDF export
- **Custom Styling** - Full control over typography, layout, and print design with CSS
- **Page Control** - Fine-grained control over page breaks, spreads, and multi-column layouts
- **Extensible** - Plugin system for custom markdown syntax and directives
- **Print-Ready** - Proper bleed, margins, running headers/footers, and page numbering

## Installation

**Package Status:** print-md is currently in development and not yet published to npm.

### Non-technical users: desktop app

Download the desktop app from [GitHub Releases](https://github.com/dimm-city/print-md/releases):

- **Linux** — `print-md-X.Y.Z.AppImage` (requires a system `bun` binary — see [bun.sh](https://bun.sh))
- **Windows** — `print-md-X.Y.Z-win32-x64.zip` (extract and run `electron.exe`)
- **macOS** — `print-md-X.Y.Z.dmg`

The desktop app opens a project directory, shows a paginated preview, and saves a PDF — no terminal required.

### CLI power users

Install the `print-md` binary from [GitHub Releases](https://github.com/dimm-city/print-md/releases) and place it on your `PATH`, or run from source:

```bash
# Clone the repository
git clone https://github.com/dimm-city/print-md.git
cd print-md

# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install workspace dependencies
bun install

# Run CLI from source
bun packages/cli/src/cli.ts build
bun packages/cli/src/cli.ts preview

# Or use the root-level workspace script
bun run cli -- preview ./my-book
```

### Future: Published Package Installation

Once `@dimm-city/print-md` is published to npm, you'll be able to install it with:

```bash
npm install -g @dimm-city/print-md
```

## Documentation

For comprehensive guides and references, see the [/docs](./docs) directory:

- **[Getting Started](./docs/getting-started.md)** - Project setup and basic workflow
- **[Core Directives](./docs/core-directives.md)** - Page control and layout directives
- **[Typography](./docs/typography.md)** - Text formatting and styling
- **[Callouts](./docs/callouts.md)** - Professional admonition boxes
- **[Images](./docs/images.md)** - Image handling and print optimization
- **[TTRPG Extensions](./docs/ttrpg-extensions.md)** - Tabletop RPG features
- **[Styling & Theming](./docs/styling-theming.md)** - Customization and CSS
- **[Best Practices](./docs/best-practices.md)** - Professional print guidelines
- **[Complete Guide](./docs/authoring-guide.md)** - All-in-one reference
- **[Design Guides](./docs/design-guides.md)** - Author and publish a companion HTML styleguide
- **[Plugins](./docs/plugins.md)** - Extend markdown syntax with custom plugins

## Quick Start

### Build a PDF

```bash
# Build a plain PDF from current directory
print-md build .

# Build from specific directory
print-md build ./my-book

# Build with custom output
print-md build ./my-book --out dist/

# Print-ready PDF/X (lint + pre/post validation enabled by default)
print-md build ./my-book --format pdfx --icc ./profiles/CGATS21_CRPC1.icc
```

### Live Preview (headless)

```bash
# Start preview server with live reload
print-md preview

# Custom port
print-md preview --port 5000

# Don't auto-open browser
print-md preview --open false
```

`print-md preview` starts a headless HTML preview server. It serves the rendered `book.html` at `http://localhost:3579` and broadcasts a `full-reload` WebSocket message whenever source files change. There is no toolbar or navigation chrome in the browser — those features live in the desktop app (`packages/viewer`).

## Configuration

Create a `manifest.yaml` in your project directory:

```yaml
title: My Book Title
authors:
  - Author Name

page:
  width: 612        # page width in points (612pt = 8.5in)
  height: 792       # page height in points (792pt = 11in)
  tolerance: 0.5    # page dimension tolerance in points

styles:
  - themes/my-theme.css
  - custom-styles.css

source:
  files:              # Optional - control file order
    - chapter-01.md
    - chapter-02.md
    - chapter-03.md

plugins:
  - ttrpg                      # Built-in TTRPG plugin
  - ./plugins/my-plugin.js     # Local custom plugin
  - name: print-md-plugin-name  # npm package plugin
    version: "^1.0.0"
    options:
      customOption: true
```

## Markdown Directives

print-md extends markdown with special directives for layout control.

### Layout Markers

The primary page layout system uses `@` markers (provided by [`markdown-it-paged`](https://github.com/itlackey/markdown-it-paged)):

```markdown
@page              Start a new page
@page chapter      New page with "chapter" CSS class
@page-break        Force a page break (no wrapper)
@spread            Start a two-page spread group
@section           Group content (avoid page breaks within)
@column-break      Force a column break in multi-column layouts
```

### Example Usage

```markdown
# Chapter One

This is the first paragraph.

@page

# Chapter Two

This chapter starts on a new page.

@section .two-column
This content flows in two columns until the section ends.
@end-section

@section
Content in here avoids breaking across pages.
@end-section
```

## Plugin System

print-md supports a powerful plugin system that lets you extend markdown syntax with custom features. Plugins can add new markdown syntax, modify rendering, and inject CSS styles.

### Built-in Plugins

```yaml
plugins:
  - ttrpg      # TTRPG features (stat blocks, dice notation, cross-refs)
  - dimmCity   # Dimm City game syntax (district badges, roll prompts)
```

### Local Plugins

Create your own plugins as JavaScript files:

```yaml
plugins:
  - ./plugins/my-plugin.js     # Local plugin file
  - path: ./plugins/callouts.js
    priority: 200               # Higher priority = loads first
    options:
      types: ["note", "warning"]
```

**Example plugin** (`plugins/my-plugin.js`):

```javascript
// Plugin function — standard markdown-it signature
export default function myPlugin(md, options) {
  md.renderer.rules.heading_open = function(tokens, idx) {
    return `<h${tokens[idx].tag.slice(1)} class="custom">`;
  };
}

// Plugin metadata (optional)
export const metadata = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Custom heading styles'
};

// Plugin CSS (automatically injected)
export const css = `
.custom { color: blue; }
`;
```

See [docs/plugins.md](./docs/plugins.md) for the full plugin authoring guide.

### npm Package Plugins

Install and use plugins from npm (print-md does not auto-install — install first):

```bash
bun add markdown-it-footnote
# or: npm install markdown-it-footnote
```

```yaml
plugins:
  - name: markdown-it-footnote
    options:
      footnoteMarker: true
```

### Plugin Priority

Control load order with priority (higher = earlier):

```yaml
plugins:
  - path: ./plugins/preprocessor.js
    priority: 500  # Runs first
  - ttrpg          # Default priority (100)
  - path: ./plugins/postprocessor.js
    priority: 50   # Runs last
```

## Styling

### CSS Cascade

Styles are applied in order:

1. **Default Styles** - Base typography and layout (optional)
2. **Theme Styles** - Your custom themes from `manifest.yaml`
3. **CSS @import** - All imports are resolved and inlined

### CSS Paged Media

Use standard CSS Paged Media features:

```css
@page {
  size: 6in 9in;
  margin: 0.75in;
}

@page :left {
  margin-left: 1in;
}

@page :right {
  margin-right: 1in;
}

h1 {
  page-break-before: always;
  page-break-after: avoid;
}
```

## CLI Reference

### Build Command (unified pipeline)

```bash
print-md build [input-dir] [--format <html|pdf|pdfx>] [options]
```

`build` produces a single artifact end-to-end: it renders the markdown, copies user assets, and emits the print-md viewer chrome (`index.html` + `preview/`) into the output directory.

The `--format` flag controls how far the pipeline runs and what validation phases are enabled by default:

| Format | Pipeline                              | Lint | Pre-validate | Post-validate |
|--------|---------------------------------------|------|--------------|---------------|
| `html` | Markdown → HTML viewer site           | off  | off          | off           |
| `pdf`  | Above → Chromium + Paged.js → `book.pdf` | on   | on           | off           |
| `pdfx` | Above → Ghostscript CMYK + PDF/X      | on   | on           | on            |

Use `--skip-lint`, `--skip-pre-validate`, `--skip-post-validate` to disable individual phases. Manifest fields `lint.enabled` / `validate.enabled` can also force them off.

**Options:**
- `--format <html|pdf|pdfx>` - Output format (default: `pdf`)
- `--out <path>` - Output directory (or `.pdf` file path with `--format pdf|pdfx`)
- `--title <title>` - Document title (overrides manifest)
- `--pdfx-flavor <x1a|x3>` - PDF/X flavor (`--format pdfx` only); defaults to manifest `pdfx.flavor` (preset: `x1a`)
- `--icc <path>` - ICC color profile path (required with `--format pdfx`)
- `--manifest <path>` - Path to manifest.yaml
- `--strip-annotations` - Strip PDF annotations (default: true with `--format pdfx`)
- `--skip-lint` - Skip CSS linting (otherwise runs for `pdf`/`pdfx`)
- `--skip-pre-validate` - Skip pre-build validation (otherwise runs for `pdf`/`pdfx`)
- `--skip-post-validate` - Skip post-build PDF/X validation (otherwise runs for `pdfx`)

**Examples:**

```bash
# Build a deployable HTML site (with viewer chrome)
print-md build ./my-book --format html --out ./_site

# Quick PDF for review (lint + pre-validate run; post-validate skipped)
print-md build ./my-book --out ./dist

# Print-ready PDF/X-1a (full validated pipeline)
print-md build ./my-book --format pdfx --icc ./profiles/CGATS21_CRPC1.icc

# PDF/X-3 with explicit flavor
print-md build ./my-book --format pdfx --pdfx-flavor x3 --icc ./profiles/Coated_GRACoL_2006.icc
```

### Build Fingerprint Artifact

Every successful `print-md build` writes a deterministic fingerprint artifact to the output directory:

- `build-fingerprint.json`

The fingerprint includes command args, key PDF/X config (flavor/profile path), tool versions, and git source revision metadata when available.

### Preview Command

```bash
print-md preview [input] [options]
```

Starts a headless HTML preview server. The server renders `book.html`, serves it at `http://localhost:<port>`, and pushes a `full-reload` WebSocket message to connected clients whenever source files change. There is no toolbar, page navigation, or folder picker in the browser — those are desktop app features.

**Options:**
- `--port <number>` - Server port (default: 3579)
- `--open <boolean>` - Auto-open browser (default: true)
- `--no-watch` - Disable file watching

**Examples:**

```bash
# Start preview on default port (3579)
print-md preview

# Custom port
print-md preview --port 8080

# Don't open browser automatically
print-md preview --open false

# Preview without file watching
print-md preview --no-watch
```

## Architecture

### Build Pipeline

1. **Markdown Processing** - Converts markdown to HTML with markdown-it
2. **Plugin System** - Extensible directives and custom syntax
3. **CSS Resolution** - Resolves and inlines all @import statements
4. **Format Strategy** - Delegates to PDF or HTML output strategy

### Preview Mode

- **Single Bun.serve instance** - Static files, `/api/*` routes, and a
  `/__print-md-hmr` WebSocket are all served by one `Bun.serve` process
  (see `packages/cli/src/preview/http-server.ts`). No bundler runs at preview time.
- **Live Reload** - File changes regenerate `book.html` and broadcast a
  `{ type: "full-reload" }` message over the WebSocket; a tiny client
  snippet injected into served HTML reloads the page on receipt.
- **No bundler at runtime** - See `docs/adr/0001-no-bundlers-at-runtime.md`
  for the full rationale.

### Output Formats

- **PDF** - Renders via Chromium + Paged.js typesetter for professional print quality. Use `build --format pdf` for a quick PDF or `build --format pdfx` for a print-ready PDF/X-1a/X-3 with the full validated pipeline.
- **HTML static site** - `build --format html` produces a directory whose `index.html` is the print-md viewer chrome wrapping the rendered book. Drop it on GitHub Pages or any static host. See [docs/design-guides.md](./docs/design-guides.md).

## Project layout

This repo is a Bun workspace monorepo.

```
print-md/
├── packages/
│   ├── cli/                     # @dimm-city/print-md — CLI + library
│   │   ├── src/
│   │   │   ├── cli.ts           # CLI entry point (citty)
│   │   │   ├── api/index.ts     # Library API (runBuild, startPreviewServer, …)
│   │   │   ├── commands/        # Command implementations
│   │   │   ├── lib/             # Core libraries (markdown, manifest, chromium, …)
│   │   │   ├── checks/          # Validation check system
│   │   │   ├── preview/         # Headless preview server (Bun.serve + chokidar)
│   │   │   ├── schema/          # Type definitions
│   │   │   └── assets/          # Embedded static assets (Paged.js, pagedjs-interface)
│   │   ├── scripts/compile.ts   # bun build --compile wrapper
│   │   ├── profiles/            # ICC colour profiles
│   │   └── tests/               # Bun test suite
│   └── viewer/                  # @dimm-city/print-md-viewer — Electron + SvelteKit desktop app
│       ├── electron/            # Electron main process (TypeScript → CJS)
│       ├── src/                 # SvelteKit app (toolbar UI, +server.ts API routes)
│       └── electron-builder.yml # Packaging config
├── examples/                    # Sample projects (dc-design-guide, template, …)
├── docs/                        # Authoring guides, ADRs, architecture docs
└── package.json                 # Workspace root (private)
```

## Desktop viewer

`packages/viewer` is an Electron + SvelteKit desktop app. It imports
`@dimm-city/print-md` directly as a workspace dependency — no subprocess, no
JSON IPC. The SvelteKit server runs under Bun because print-md uses Bun-specific
APIs (`Bun.serve`, `Bun.file`, `with { type: "file" }` imports).

The desktop app provides the toolbar UI, page navigation, view modes, zoom
controls, folder picker, and PDF export that are absent from the headless
`print-md preview` server.

See [`packages/viewer/README.md`](./packages/viewer/README.md) for dev and
packaging instructions.

## Development

### Prerequisites

This project uses [Bun](https://bun.com) runtime v1.3.1 or later.

### Setup

```bash
# Clone the repository
git clone https://github.com/dimm-city/print-md.git
cd print-md

# Install all workspace dependencies (run at repo root)
bun install

# Run CLI from source
bun run cli -- build ./my-book
bun run cli -- preview ./my-book

# Run CLI tests
bun --filter @dimm-city/print-md test

# Type-check all packages
bun run typecheck

# Launch desktop viewer (browser-based SvelteKit UI, no Electron)
bun run viewer:dev

# Launch desktop viewer with Electron
bun run viewer:electron
```

### Troubleshooting

#### Installation Issues

**Problem: Command Not Found After Installation**

If `print-md` command isn't found after global installation:

```bash
# Check if bun's global bin directory is in PATH
echo $PATH | grep -q ".bun/bin" || echo "Bun bin not in PATH"

# Add to your shell profile (.bashrc, .zshrc, etc.)
export PATH="$HOME/.bun/bin:$PATH"

# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc
```

#### Build Issues

**Problem: PDF Generation Fails**

Ensure Chromium is installed and accessible. print-md uses Playwright to manage Chromium:

```bash
# Install Playwright browsers (Chromium)
bunx playwright install chromium

# If issues persist, verify Chromium is available:
bunx playwright install --dry-run
```

**Problem: Build Fails with "manifest.yaml not found"**

Create a minimal manifest.yaml in your project directory:

```yaml
title: "My Book"
authors:
  - "Your Name"
```

**Problem: CSS Import Not Resolving**

CSS imports are resolved relative to the file containing the @import. Check paths:

```css
/* If your CSS is in styles/theme.css */
@import "variables.css";        /* Looks for styles/variables.css */
@import "../common/base.css";   /* Looks for common/base.css */
```

**Problem: Build Hangs or Takes Very Long**

Large images or complex CSS can slow down PDF generation:

1. **Optimize images:**
   ```bash
   # Resize large images (requires ImageMagick)
   mogrify -resize 1920x1080\> -quality 85 images/*.jpg
   ```

2. **Use `--verbose` to see where it's stuck:**
   ```bash
   print-md build --verbose
   ```

3. **Check for circular CSS imports:**
   - A imports B
   - B imports A
   - Result: infinite loop

#### Preview Mode Issues

**Problem: Preview Server Won't Start**

Port might be in use:

```bash
# Check what's using the default port (3579)
lsof -i :3579          # Linux/macOS
netstat -ano | findstr :3579  # Windows

# Use a different port
print-md preview --port 8080
```

**Problem: Changes Not Reflecting in Preview**

File watching might have failed:

1. **Check file system limits (Linux):**
   ```bash
   # Increase inotify watchers
   echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```

2. **Restart preview server:**
   ```bash
   # Ctrl+C to stop
   print-md preview
   ```

3. **Hard refresh browser:**
   - Chrome/Edge: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (macOS)
   - Firefox: Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (macOS)

**Problem: Preview Won't Connect or Live Reload Doesn't Fire**

The preview server is a single `Bun.serve` instance handling HTTP, the
`/api/*` routes, and the `/__print-md-hmr` WebSocket on one port.

1. **Check if the port is available:**
   ```bash
   # Default preview port: 3579 (auto-increments if in use)
   lsof -i :3579          # Linux/macOS
   ```

2. **Check firewall settings:**
   - Ensure localhost connections are allowed
   - Try disabling firewall temporarily to test

3. **Check the live-reload WebSocket:**
   - In DevTools → Network → WS, you should see a connection to
     `ws://localhost:<port>/__print-md-hmr`. If it's missing or 4xx,
     a proxy or extension is likely interfering.

4. **Check logs for errors:**
   ```bash
   print-md preview --verbose
   ```

#### Content Issues

**Problem: Page Breaks Not Working**

Ensure directives are on their own line:

```markdown
<!-- Not Working -->
Some text @page More text

<!-- Correct -->
Some text

@page

More text
```

**Problem: Images Not Showing in PDF**

1. **Check image paths are relative to markdown file:**
   ```markdown
   <!-- If markdown is in chapters/chapter1.md -->
   ![Image](../images/photo.jpg)  <!-- Looks for images/photo.jpg -->
   ```

2. **Verify image file exists:**
   ```bash
   ls -la images/photo.jpg
   ```

3. **Check image format is supported:**
   - Supported: JPG, PNG, GIF, SVG, WebP
   - Not supported: TIFF, BMP (convert first)

**Problem: Styles Not Applied**

Check CSS cascade order in manifest.yaml:

```yaml
# Styles are applied in order (last wins)
styles:
  - "themes/base.css"      # Applied first
  - "themes/theme.css"     # Overrides base
  - "custom.css"           # Overrides everything
```

Verify CSS files exist:
```bash
ls -la themes/theme.css custom.css
```

#### Performance Issues

**Problem: Preview Uses Too Much Memory**

1. **Close other browser tabs**

2. **Reduce image sizes in your content**

3. **Disable file watching if not needed:**
   ```bash
   print-md preview --no-watch
   ```

#### Common Error Messages

**"Cannot find module 'zod'"**

Dependencies not installed:
```bash
bun install
```

**"ENOENT: no such file or directory"**

Check paths in manifest.yaml are relative to project root:
```yaml
# If manifest.yaml is in /home/user/project/
source:
  files:
    - "chapters/intro.md"  # Looks for /home/user/project/chapters/intro.md
```

**"Invalid manifest.yaml: unknown field"**

Check that your manifest only uses valid top-level fields:
```yaml
# Valid top-level fields: title, authors, preset, styles, plugins,
# source, output, pdfx, page, ink, lint, validate
title: "Your Title"
authors:
  - "Your Name"
```

**"Failed to parse markdown"**

Check for syntax errors in your markdown:
- Unclosed code blocks (```)
- Invalid YAML frontmatter
- Malformed HTML tags

#### Getting Help

If you're still stuck:

1. **Check existing issues:** https://github.com/dimm-city/print-md/issues
2. **Enable verbose output:**
   ```bash
   print-md build --verbose
   print-md preview --verbose
   ```
3. **Create a minimal reproduction:**
   - Single markdown file
   - Minimal manifest.yaml
   - No custom CSS
4. **Open an issue:** Include:
   - Operating system and version
   - Bun version (`bun --version`)
   - print-md version (`print-md --version`)
   - Full error message
   - Steps to reproduce

**Note**: PDF generation uses Chromium + Paged.js (automatically installed with Playwright).

### Contributing

This project uses:
- [Bun](https://bun.com) - Fast all-in-one JavaScript runtime
- [Playwright](https://playwright.dev/) - Browser automation for PDF rendering
- [Paged.js](https://pagedjs.org/) - CSS Paged Media polyfill and layout engine
- [markdown-it](https://github.com/markdown-it/markdown-it) - Markdown parser
- [Electron](https://www.electronjs.org/) - Desktop app shell for the viewer
- [SvelteKit](https://kit.svelte.dev/) - Web framework for the viewer UI

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full contribution guidelines.

## License

This project is licensed under the [Creative Commons Attribution 4.0 International License (CC BY 4.0)](http://creativecommons.org/licenses/by/4.0/).

You are free to share and adapt this work for any purpose, even commercially, as long as you provide appropriate attribution.
