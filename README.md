# print-md

A powerful CLI tool and live preview UI for creating professional print-ready PDFs from markdown. Write your content in markdown and let print-md handle the complex CSS Paged Media layout. Uses Chromium + Paged.js for PDF generation and Paged.js for live preview.

## Features

- **Markdown to PDF** - Convert markdown files to professional print layouts
- **Live Preview** - Interactive browser-based preview with Hot Module Replacement
- **Custom Styling** - Full control over typography, layout, and print design with CSS
- **Page Control** - Fine-grained control over page breaks, spreads, and multi-column layouts
- **Extensible** - Plugin system for custom markdown syntax and directives
- **Print-Ready** - Proper bleed, margins, running headers/footers, and page numbering

## Installation

**Package Status:** print-md is currently in development and not yet published to npm. 

### Development Installation (From Source)

Until the package is published to npm, install from the GitHub repository:

```bash
# Clone the repository
git clone https://github.com/dimm-city/print-md.git
cd print-md

# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Link globally for development
bun link

# Now the print-md command is available globally
print-md build
print-md preview
```

### Using from Source Without Global Link

If you prefer not to link globally:

```bash
git clone https://github.com/dimm-city/print-md.git
cd print-md
bun install

# Run directly
bun src/cli.ts build
bun src/cli.ts preview
```

### Future: Published Package Installation

Once @dimm-city/print-md is published to npm, you'll be able to install it with:

```bash
# With Bun
bun install -g @dimm-city/print-md

# With npm
npm install -g @dimm-city/print-md
```

Check back soon for the published release!

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

## Quick Start

### Build a PDF

```bash
# Run full pipeline from current directory
print-md run .

# Run from specific directory
print-md run ./my-book

# Run with custom output
print-md run ./my-book --out dist/
```

### Live Preview

```bash
# Start preview server with live reload
print-md preview

# Custom port
print-md preview --port 5000

# Don't auto-open browser
print-md preview --open false
```

The preview UI provides:
- **Page navigation** - Jump to any page, navigate with prev/next
- **View modes** - Single page or two-column (spread) view
- **Zoom controls** - Fit to width or custom zoom levels
- **Debug mode** - Visualize page breaks and layout boxes
- **Folder switching** - Load different projects without restarting
- **GitHub cloning** - Clone and preview repositories directly from GitHub

### Clone from GitHub

The preview UI includes built-in support for cloning GitHub repositories:

```bash
# Start preview (no GitHub CLI installation needed yet)
print-md preview
```

In the preview UI:
1. Click the **GitHub icon** button in the toolbar
2. If not authenticated, click "Login to GitHub" to authenticate via browser
3. Enter a repository URL in any format:
   - `https://github.com/owner/repo`
   - `git@github.com:owner/repo.git`
   - `owner/repo` (shorthand)
4. Click "Clone Repository"
5. The repository is cloned to `~/.print-md/cloned-repos/owner/repo`
6. Preview automatically switches to the cloned repository

**Prerequisites:**
- GitHub CLI (`gh`) must be installed: https://cli.github.com/
- One-time authentication via `gh auth login` or use the UI's "Login to GitHub" button

**Benefits:**
- No OAuth app setup required
- Simple browser-based authentication
- Repositories stored locally for offline access
- Easy sharing of markdown projects via GitHub

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

print-md extends markdown with special directives for layout control:

### Layout Markers

The primary page layout system uses `@` markers (provided by [`markdown-it-paged`](https://github.com/itlackey/markdown-it-paged)):

```markdown
@page              Start a new page
@page chapter      New page with "chapter" CSS class
@break             Force a page break (no wrapper)
@spread            Start a two-page spread group
@section           Group content (avoid page breaks within)
```

### Container Blocks

Group content with container syntax for styling:

```markdown
::: container
Keep this content together on one page.
:::

::: two-column
This section uses two-column layout.
:::

::: sidebar
Sidebar or callout box content.
:::
```

### Page Markers (Legacy)

> **Deprecated:** Use `@page` and `@break` instead.

The older horizontal-rule syntax still works for backward compatibility:

```markdown
--- {page}                   Page break with page marker
--- {page chapter}           Page break with chapter styling
```

### Example Usage

```markdown
# Chapter One

This is the first paragraph.

@page

# Chapter Two

This chapter starts on a new page.

::: two-column
This content flows in two columns until the container ends.
:::

@section
Content in here avoids breaking across pages.
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
// Plugin function
export default function myPlugin(md, options) {
  // Extend markdown-it functionality
  md.renderer.rules.heading_open = function(tokens, idx) {
    return `<h${tokens[idx].tag.slice(1)} class="custom">`;
  };
}

// Plugin metadata
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

### npm Package Plugins

Install and use plugins from npm:

```bash
npm install markdown-it-footnote
```

```yaml
plugins:
  - name: markdown-it-footnote
    version: "^3.0.0"
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

**Learn more:** See [examples/plugins/README.md](./examples/plugins/README.md) for a complete plugin development guide and working examples.

## Styling

### CSS Cascade

Styles are applied in order:

1. **Default Styles** - Base typography and layout (optional)
2. **Theme Styles** - Your custom themes from `manifest.yaml`
3. **CSS @import** - All imports are resolved and inlined

### Disable Default Styles

```yaml
styles:
  - my-complete-theme.css
```

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

### Run Command (Full Pipeline)

```bash
print-md run <input-dir> [options]
```

**Options:**
- `--out <dir>` - Output directory path
- `--pdfx` - Enable PDF/X compliance
- `--icc` - ICC color profile path
- `--manifest` - Path to manifest.yaml
- `--skip-lint` - Skip the lint step
- `--skip-validate` - Skip post-build validation
- `--skip-pre-validate` - Skip pre-build validation

**Examples:**

```bash
# Run full pipeline from current directory
print-md run .

# Run from specific directory with custom output
print-md run ./my-book --out dist/

# Run with PDF/X compliance
print-md run ./my-book --pdfx
```

### Build Command (HTML to PDF Only)

```bash
print-md build <input-html> <output-pdf> [options]
```

**Options:**
- `--pdfx` - Enable PDF/X compliance
- `--icc` - ICC color profile path
- `--manifest` - Path to manifest.yaml
- `--strip-annotations` - Strip PDF annotations

**Examples:**

```bash
# Build PDF from HTML file
print-md build output.html book.pdf

# Build with PDF/X compliance
print-md build output.html book.pdf --pdfx
```

### Build Fingerprint Artifact

Every successful `print-md build` and `print-md run` writes a deterministic fingerprint artifact to the output directory:

- `build-fingerprint.json`

The fingerprint includes command args, key PDF/X config (flavor/profile path), tool versions, and git source revision metadata when available.

### Preview Command

```bash
print-md preview [input] [options]
```

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

- **Dual-Server Architecture**:
  - Bun server (user port) - Toolbar UI and API endpoints
  - Vite server (auto port) - Preview content with HMR
- **Live Reload** - File changes trigger automatic HTML regeneration
- **Reverse Proxy** - Seamless integration between servers

### Output Formats

- **PDF** - Renders via Chromium + Paged.js typesetter for professional print quality
- **HTML** - Standalone HTML file for web viewing

## Project Structure

```
print-md/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── commands/            # Command implementations
│   ├── lib/                 # Core libraries
│   │   ├── markdown/        # Markdown processing and plugins
│   │   ├── manifest.ts      # Config resolution
│   │   ├── presets.ts       # Vendor presets
│   │   ├── ghostscript.ts   # PDF/X conversion
│   │   └── chromium.ts      # Chromium resolution
│   ├── checks/              # Validation check system
│   ├── preview/             # Preview server
│   ├── schema/              # Type definitions
│   └── utils/               # Shared utilities
└── README.md
```

## Development

### Prerequisites

This project uses [Bun](https://bun.com) runtime v1.3.1 or later.

### Setup

```bash
# Clone the repository
git clone https://github.com/dimm-city/print-md.git
cd print-md

# Install dependencies
bun install

# Run from source
bun src/cli.ts build
bun src/cli.ts preview

# Build the CLI
bun run build

# Run tests
bun test
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

Verify the file exists:
```bash
# From your project root
ls -la styles/variables.css
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

**Problem: Preview Shows "Cannot Connect to Vite Server"**

The dual-server architecture requires both servers to start:

1. **Check if ports are available:**
   ```bash
# Main server (3579 default)
lsof -i :3579          # Linux/macOS

   # Vite server (auto-assigned, usually 5173)
   lsof -i :5173
   ```

2. **Check firewall settings:**
   - Ensure localhost connections are allowed
   - Try disabling firewall temporarily to test

3. **Check logs for errors:**
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

#### GitHub Integration Issues

**Problem: "gh CLI Not Found"**

Install GitHub CLI:

```bash
# macOS
brew install gh

# Linux
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh

# Windows
winget install --id GitHub.cli
```

**Problem: GitHub Authentication Fails**

Authenticate with GitHub:

```bash
# Interactive authentication
gh auth login

# Or use the preview UI's "Login to GitHub" button
```

**Problem: Clone Permission Denied**

Ensure you have access to the repository:

```bash
# For private repos, check authentication
gh auth status

# For public repos, try HTTPS URL instead of SSH:
# Use: https://github.com/owner/repo
# Not: git@github.com:owner/repo.git
```

#### Performance Issues

**Problem: Build is Slow**

   ```bash
   ```

2. **Common slow operations:**
   - Large images (optimize/resize)
   - Complex CSS (simplify selectors)
   - Many files (combine related content)
   - Circular CSS imports (fix import chain)

3. **Try HTML format first (faster):**
   ```bash
   ```

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
   - Bun/Node version (`bun --version`)
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

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [Creative Commons Attribution 4.0 International License (CC BY 4.0)](http://creativecommons.org/licenses/by/4.0/).

You are free to share and adapt this work for any purpose, even commercially, as long as you provide appropriate attribution.
