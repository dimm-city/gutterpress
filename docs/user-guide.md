# print-md User Guide

Welcome to print-md! This guide will help you create professional print-ready PDFs from your markdown files.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Your First Project](#your-first-project)
4. [Configuration](#configuration)
5. [Writing Markdown](#writing-markdown)
6. [Styling Your Document](#styling-your-document)
7. [Preview Mode](#preview-mode)
8. [Building Your PDF](#building-your-pdf)
9. [Advanced Features](#advanced-features)
10. [Tips & Best Practices](#tips--best-practices)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/dimm-city/print-md.git
cd print-md
bun install

# Create a new project
mkdir my-book && cd my-book

# Create a simple manifest
cat > manifest.yaml << 'EOF'
title: "My First Book"
authors:
  - "Your Name"
EOF

# Create your first page
echo "# Chapter 1\n\nHello, world!" > chapter1.md

# Preview it live
bun src/cli.ts preview

# Run the full pipeline to build a PDF
bun src/cli.ts run .
```

---

## Installation

### Prerequisites

- **Bun** - Fast JavaScript runtime (required)
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

- **Chromium + Paged.js** - Integrated PDF generation (built-in, no separate installation needed)

### Install print-md

print-md is not yet published to npm. Install from source:

```bash
# Clone the repository
git clone https://github.com/dimm-city/print-md.git
cd print-md
bun install

# Run directly
bun src/cli.ts preview
bun src/cli.ts run ./my-book
```

---

## Your First Project

### 1. Create Project Directory

```bash
mkdir my-book
cd my-book
```

### 2. Create manifest.yaml

The `manifest.yaml` file is the heart of your project:

```yaml
# Required fields
title: "My First Book"
authors:
  - "Your Name"

# Specify file order (optional - defaults to alphabetical)
source:
  files:
    - "01-introduction.md"
    - "02-chapter1.md"
    - "03-chapter2.md"

# Add custom styles (optional)
styles:
  - "themes/classic.css"  # Built-in theme
  - "custom.css"           # Your custom CSS

# Page format (optional)
page:
  width: 612
  height: 792
  tolerance: 0.5
```

### 3. Write Your Content

Create `01-introduction.md`:

```markdown
# Introduction

Welcome to my first book created with print-md!

This tool makes it easy to create professional PDFs from markdown.

## Features

- Beautiful typography
- Professional print layout
- Easy to write and maintain
- Supports images, tables, and code

@break

## Getting Started

Let's dive in...
```

### 4. Preview Your Book

```bash
print-md preview
```

This will:
- Open your browser automatically
- Show a live preview
- Auto-reload when you save changes
- Provide page navigation controls

### 5. Build Your PDF

```bash
# Run the full pipeline
print-md run .

# Or specify output directory
print-md run . --out dist/
```

Your PDF will be created in the output directory.

---

## Configuration

### manifest.yaml Reference

```yaml
# ============================================
# REQUIRED FIELDS
# ============================================

title: "Book Title"                # Document title
authors:                           # List of authors
  - "Author One"
  - "Author Two"

# ============================================
# FILE ORDERING
# ============================================

source:
  files:                           # Explicit file order
    - "frontmatter/title-page.md"  # (omit for alphabetical)
    - "frontmatter/copyright.md"
    - "chapters/01-intro.md"
    - "chapters/02-chapter1.md"
    - "appendix/glossary.md"

# ============================================
# STYLING
# ============================================

styles:                            # CSS files (in order)
  - "themes/classic.css"           # Built-in themes:
                                   #   - classic
                                   #   - modern
                                   #   - dark
                                   #   - parchment
  - "custom.css"                   # Your custom CSS

# ============================================
# PAGE FORMAT
# ============================================

page:
  width: 612                       # Page width in points
  height: 792                      # Page height in points (letter = 612x792)
  tolerance: 0.5                   # Tolerance for page size validation

# Common page sizes (width x height in points):
  # Letter: 612 x 792
  # A4: 595 x 842
  # A5: 420 x 595
  # Legal: 612 x 1008

# ============================================
# PLUGINS
# ============================================

plugins:                           # Enable/disable plugins
  - ttrpg                          # TTRPG directives
  - dimm-city                      # Dimm City extensions
                                   # Note: containers are built-in
```

### CLI Options

```bash
# Full pipeline (run)
print-md run <input-dir> [options]
  --out <dir>                      # Output directory
  --pdfx <x1a|x3>                 # PDF/X flavor
  --skip-lint                      # Skip CSS linting step
  --skip-pre-validate              # Skip pre-build validation
  --skip-validate                  # Skip post-build validation

# Validate
print-md validate --pdf dist/book.pdf   # Validate PDF for print
print-md validate --input ./my-book     # Validate source/assets
print-md validate --input . --pdf dist/book.pdf  # Both
  --category source,pdf            # Filter by category
  --only pdf.print.page-size       # Run specific check(s)
  --skip pdf.nav.cross-refs        # Skip specific check(s)
  --format json                    # JSON output for CI
  --phase pre-build                # Run specific phase

# Build (HTML to PDF only, two positional args)
print-md build <html-file> <pdf-output> [options]
  --pdfx <x1a|x3>                 # Enable PDF/X conversion
  --icc <path>                     # ICC profile path
  --manifest <path>                # Path to manifest.yaml

# Preview commands
print-md preview [input]            # Start preview server
  --port <number>                  # Server port (default: 3579)
  --no-watch                       # Disable file watching
  --open                           # Open browser automatically
  --verbose                        # Verbose output
  --debug                          # Debug mode
```

---

## Writing Markdown

### Standard Markdown

print-md supports all standard markdown syntax:

```markdown
# Heading 1
## Heading 2
### Heading 3

**bold** and *italic* text

- Unordered lists
- With multiple items

1. Ordered lists
2. Numbered items

[Links](https://example.com)

![Images](path/to/image.png)

> Blockquotes for callouts

`inline code` and

```​javascript
// Code blocks with syntax highlighting
function hello() {
  console.log("Hello, world!");
}
```​
```

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| More     | Data     | Here     |
```

### Images

```markdown
<!-- Basic image -->
![Alt text](images/photo.jpg)

<!-- Image with size -->
![Alt text](images/photo.jpg =800x600)

<!-- Image with width only -->
![Alt text](images/photo.jpg =800x)
```

### Layout Markers

Control page layout with `@` markers (provided by `markdown-it-paged`):

```markdown
<!-- Force page break -->
@break

<!-- Start a new page with a CSS class -->
@page chapter

<!-- Start a two-page spread -->
@spread

<!-- Group content (avoid page breaks within) -->
@section
Content stays together on one page.
```

These markers emit semantic HTML (`<div class="page">`, `<div class="spread">`, etc.) compatible with Paged.js and CSS Paged Media.

### Cross-References

```markdown
<!-- Create an anchor -->
## Important Section {#important}

<!-- Link to it -->
See the [Important Section](#important) for details.
```

### Custom Attributes

```markdown
<!-- Add CSS classes -->
This is a paragraph with a custom class.
{.highlight}

<!-- Add ID and class -->
## Special Heading {#special .important}

<!-- Multiple attributes -->
![Image](photo.jpg){.full-width #hero-image}
```

---

## Styling Your Document

### Using Built-in Themes

print-md supports theme CSS files. These theme files need to exist in your project directory or be created by you -- they are not bundled with print-md:

```yaml
# manifest.yaml
styles:
  - "themes/classic.css"   # Traditional book style
  - "themes/modern.css"    # Clean, minimal design
  - "themes/dark.css"      # Dark mode for screens
  - "themes/parchment.css" # Aged paper look
```

**Note:** You must create these theme CSS files yourself or copy them from an existing project. print-md does not ship with pre-built themes.

### Creating Custom CSS

Create `custom.css` in your project directory:

```css
/* Override typography */
body {
  font-family: "Georgia", serif;
  font-size: 11pt;
  line-height: 1.6;
}

h1 {
  font-size: 24pt;
  margin-top: 2em;
  margin-bottom: 1em;
  color: #2c3e50;
}

/* Custom page breaks */
h1 {
  break-before: page;  /* New chapter starts on new page */
}

/* Two-sided printing */
@page :left {
  margin-left: 1.5in;
  margin-right: 1in;
}

@page :right {
  margin-left: 1in;
  margin-right: 1.5in;
}

/* Custom classes */
.highlight {
  background-color: #fff3cd;
  padding: 1em;
  border-left: 4px solid #ffc107;
}

.full-width {
  width: 100%;
  max-width: 100%;
}
```

Reference it in your manifest:

```yaml
styles:
  - "themes/classic.css"
  - "custom.css"
```

### CSS Cascade Order

Styles are applied in this order:

1. **Default foundation CSS**
   - Variables
   - Typography
   - Layout
   - Components

2. **Theme CSS** (from `styles` array)
   - Applied in order listed

3. **Your custom CSS** (from `styles` array)
   - Last in list = highest priority

### Common CSS Patterns

```css
/* ============================================
   HEADINGS
   ============================================ */

/* Chapter titles */
h1 {
  break-before: page;
  string-set: chapter content();
}

/* Running headers */
@page {
  @top-center {
    content: string(chapter);
  }
}

/* ============================================
   IMAGES
   ============================================ */

/* Full-bleed images */
.full-bleed {
  width: calc(100% + 2in);
  margin-left: -1in;
  margin-right: -1in;
}

/* Figure captions */
figure {
  margin: 1em 0;
}

figcaption {
  font-size: 9pt;
  font-style: italic;
  text-align: center;
}

/* ============================================
   LAYOUT
   ============================================ */

/* Two-column sections */
.two-column {
  column-count: 2;
  column-gap: 1em;
}

/* Avoid breaks inside */
.keep-together {
  break-inside: avoid;
}

/* ============================================
   PRINT SPECIFICS
   ============================================ */

/* First page different */
@page :first {
  margin-top: 0;
}

/* Left/right pages */
@page :left {
  @bottom-left {
    content: counter(page);
  }
}

@page :right {
  @bottom-right {
    content: counter(page);
  }
}
```

See [Theme Customization Guide](./theme-customization.md) for more details.

---

## Preview Mode

Preview mode provides a live development environment:

### Starting Preview

```bash
# Start from current directory
print-md preview

# Start from specific directory
print-md preview ./my-book

# Custom port
print-md preview --port 5000

# Don't open browser automatically
print-md preview --open false

# Disable file watching
print-md preview --no-watch
```

### Preview Features

**Toolbar Controls:**
- **Page Navigation** - First, Previous, Next, Last buttons
- **View Modes** - Single page or two-column spread
- **Zoom** - Zoom in/out/reset controls
- **Debug Mode** - Show layout debug info
- **Folder Switcher** - Browse and switch to different projects

**Live Updates:**
- Edit markdown files → browser updates automatically
- Edit CSS → instant style changes
- Edit manifest.yaml → configuration reloads
- No manual refresh needed (Hot Module Replacement)

**Keyboard Shortcuts:**
- `←` / `→` - Previous/Next page
- `Home` / `End` - First/Last page
- `+` / `-` - Zoom in/out
- `0` - Reset zoom

### Folder Switching

Click "Change Folder" to:
1. Browse your home directory
2. Select a different project
3. Preview switches automatically
4. No server restart needed

### GitHub Integration

Clone repositories directly from preview:
1. Click "Clone from GitHub"
2. Enter repository URL (e.g., `user/repo` or full URL)
3. Automatically cloned and opened
4. Requires `gh` CLI installed and authenticated

---

## Building Your PDF

### Basic Build

Use the `run` command for the full pipeline (markdown to PDF):

```bash
# Full pipeline from current directory
print-md run .

# Full pipeline with output directory
print-md run ./my-book --out dist/
```

The `build` command is for converting a single HTML file to PDF (not for the full pipeline):

```bash
# Convert HTML to PDF directly
print-md build output.html output.pdf
```

### Output Format

The `convert` command produces standalone HTML. The `run` pipeline produces PDF.

### Verbose Output

Verbose output is available for preview mode:

```bash
print-md preview --verbose
```

---

## Advanced Features

### TTRPG Extensions

Enable TTRPG-specific directives:

```yaml
# manifest.yaml
plugins:
  - ttrpg
```

**Stat Blocks:**
```markdown
:::statblock
### Goblin Scout
*Small humanoid (goblinoid), neutral evil*

**Armor Class** 15 (leather armor)
**Hit Points** 7 (2d6)
**Speed** 30 ft.

| STR | DEX | CON | INT | WIS | CHA |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 8   | 14  | 10  | 10  | 8   | 8   |
:::
```

**Ability Blocks:**
```markdown
:::ability
### Sneak Attack
Once per turn, deal an extra 1d6 damage when you hit with an attack.
:::
```

**Dice Notation:**
```markdown
Roll 2d6+3 for damage
Make a DC 15 Wisdom saving throw
```

### Dimm City Extensions

Enable Dimm City-specific syntax:

```yaml
# manifest.yaml
plugins:
  - dimm-city
```

**District Badges:**
```markdown
@district{The Warrens}
```

**Roll Prompts:**
```markdown
@roll{Investigation DC 15}
```

### Container Syntax

Container blocks are built-in to print-md. No plugin configuration is needed.

**Available Containers:**
```markdown
:::warning
This is a warning callout.
:::

:::info
This is an informational callout.
:::

:::page
Force content onto its own page.
:::

:::ability
Format as ability block.
:::
```

### Plugin System

print-md's plugin system allows you to extend markdown syntax with custom features. Plugins can add new markdown syntax, modify rendering, and inject CSS styles automatically.

#### Using Built-in Plugins

Enable built-in plugins in your manifest:

```yaml
# manifest.yaml
plugins:
  - ttrpg      # TTRPG features (stat blocks, dice notation, cross-refs)
  - dimm-city  # Dimm City game syntax (district badges, roll prompts)
```

#### Creating Local Plugins

Create custom plugins as JavaScript files in your project:

**Step 1:** Create a plugin file (`plugins/my-plugin.js`):

```javascript
/**
 * My custom plugin
 */
export default function myPlugin(md, options = {}) {
  const { enabled = true } = options;

  if (!enabled) return;

  // Example: Add custom renderer for blockquotes
  md.renderer.rules.blockquote_open = function(tokens, idx) {
    return '<blockquote class="custom-quote">\n';
  };
}

// Plugin metadata (optional but recommended)
export const metadata = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Custom blockquote styling',
  author: 'Your Name'
};

// Plugin CSS (automatically injected)
export const css = `
.custom-quote {
  border-left: 4px solid #3b82f6;
  padding-left: 1em;
  color: #1e40af;
}
`;
```

**Step 2:** Enable your plugin in manifest.yaml:

```yaml
# manifest.yaml
plugins:
  - ./plugins/my-plugin.js
```

**Step 3:** Use it in your markdown:

```markdown
> This blockquote will be styled with your custom CSS
```

#### Plugin Configuration

Plugins support options and priority control:

```yaml
plugins:
  # Simple usage
  - ttrpg

  # With options
  - path: ./plugins/callouts.js
    options:
      types: ["note", "warning", "tip"]
      className: "callout"

  # With priority (higher = loads first)
  - path: ./plugins/preprocessor.js
    priority: 500  # Runs before other plugins

  - path: ./plugins/postprocessor.js
    priority: 50   # Runs after other plugins
```

#### Using npm Package Plugins

Install plugins from npm:

```bash
npm install markdown-it-footnote
```

```yaml
# manifest.yaml
plugins:
  - name: markdown-it-footnote
    version: "^3.0.0"
    options:
      footnoteMarker: true
```

Then use footnote syntax in your markdown:

```markdown
Here is a footnote reference[^1].

[^1]: This is the footnote text.
```

#### Plugin Examples

**Example 1: Callouts/Admonitions**

See `examples/plugins/callouts-plugin.js` for a full-featured callout plugin that adds:

```markdown
> [!note] Important Information
> This is a note callout with custom styling.

> [!warning] Be Careful
> This could cause issues if not handled properly.

> [!tip] Pro Tip
> Here's a helpful suggestion.
```

**Example 2: Custom Inline Syntax**

```javascript
// plugins/hashtag-plugin.js
export default function hashtagPlugin(md) {
  md.inline.ruler.push('hashtag', function(state, silent) {
    const start = state.pos;
    const max = state.posMax;

    if (state.src.charCodeAt(start) !== 0x23) return false; // #

    let pos = start + 1;
    while (pos < max && /\w/.test(state.src[pos])) {
      pos++;
    }

    if (pos === start + 1) return false;

    if (!silent) {
      const token = state.push('hashtag', 'span', 0);
      token.content = state.src.slice(start + 1, pos);
    }

    state.pos = pos;
    return true;
  });

  md.renderer.rules.hashtag = function(tokens, idx) {
    const tag = tokens[idx].content;
    return `<span class="hashtag">#${md.utils.escapeHtml(tag)}</span>`;
  };
}

export const css = `
.hashtag {
  color: #1d4ed8;
  font-weight: 600;
}
`;
```

Usage:

```markdown
This project uses #javascript and #markdown-it
```

#### Plugin Development Guide

For comprehensive plugin development documentation, see:
- **[examples/plugins/README.md](../examples/plugins/README.md)** - Complete plugin development guide
- **[examples/with-custom-plugin/](../examples/with-custom-plugin/)** - Working example project
- **[markdown-it documentation](https://markdown-it.github.io/)** - markdown-it API reference

#### Security

Plugins are subject to security restrictions:
- Local plugins must use relative paths (no `../` or absolute paths)
- All plugin files are validated before loading
- Remote plugins (future feature) will require integrity hashes

### Validation

print-md includes a comprehensive validation system for checking print-readiness. See the [Validation Guide](validation.md) for full details.

**Quick start:**

```bash
# Validate source files and assets
print-md validate --input ./my-book

# Validate a PDF for print compliance
print-md validate --pdf dist/book.pdf --manifest manifest.yaml

# Full pipeline with validation
print-md run ./my-book --pdfx x1a
```

**Configure in manifest.yaml:**

```yaml
validate:
  source:
    markdownlint: ".markdownlint.yaml"  # Use your existing config
    allowedCallouts: ["sidebar", "ability", "specialty"]
  assets:
    maxImageSize: 10000000              # 10MB per image
    minImageDpi: 300
  pdf:
    forbidTransparency: true
```

The validation system runs 31 checks across four categories: source (markdownlint, htmlhint, stylelint, callout types), PDF (structure, page size, colors, fonts, ink coverage, transparency, bleed), assets (image size/DPI/color space, font refs), and heuristics (text density, layout analysis).

Missing external tools (e.g. `qpdf`, `identify`) are detected automatically before checks run. You'll see a warning listing which checks are skipped, while all other checks proceed normally. Warnings are suppressed for checks you've explicitly disabled in your manifest.

### Multi-File Projects

Organize large projects:

```
my-book/
├── manifest.yaml
├── frontmatter/
│   ├── title-page.md
│   ├── copyright.md
│   └── table-of-contents.md
├── chapters/
│   ├── 01-introduction.md
│   ├── 02-chapter1.md
│   └── 03-chapter2.md
├── appendix/
│   ├── glossary.md
│   └── index.md
├── images/
│   └── *.jpg
└── styles/
    └── custom.css
```

Specify order in manifest:

```yaml
source:
  files:
    - "frontmatter/title-page.md"
    - "frontmatter/copyright.md"
    - "chapters/01-introduction.md"
    - "chapters/02-chapter1.md"
    - "chapters/03-chapter2.md"
    - "appendix/glossary.md"
```

### CSS @import

Split CSS into modules:

```css
/* styles/main.css */
@import "typography.css";
@import "layout.css";
@import "print.css";
```

print-md resolves all imports at build time (no external dependencies in output).

---

## Tips & Best Practices

### Project Organization

```
my-book/
├── manifest.yaml         # Project configuration
├── chapters/             # Markdown content
│   └── *.md
├── images/               # Image assets
│   └── *.jpg
├── styles/               # Custom CSS
│   └── *.css
└── .print-mdignore        # Files to exclude (future)
```

### Writing Tips

**Use Semantic Headings:**
```markdown
# Chapter Title (h1 - major sections)
## Section Title (h2 - sub-sections)
### Subsection (h3 - details)
```

**Force Page Breaks Strategically:**
```markdown
# Chapter 1
Content here...

@break

# Chapter 2
New chapter on new page
```

**Keep Images Reasonable:**
- Use JPG for photos (smaller file size)
- Use PNG for diagrams/illustrations (better quality)
- Optimize images before adding (aim for <1MB each)
- Use appropriate resolution (300 DPI for print)

**Test Frequently:**
- Use preview mode while writing
- Check pagination early and often
- Build PDF occasionally to verify output

### CSS Tips

**Use CSS Variables:**
```css
:root {
  --primary-color: #2c3e50;
  --body-font: "Georgia", serif;
  --heading-font: "Helvetica", sans-serif;
}

body {
  color: var(--primary-color);
  font-family: var(--body-font);
}
```

**Avoid Breaking Important Content:**
```css
h2, h3 {
  break-after: avoid;  /* Keep heading with content */
}

table, figure {
  break-inside: avoid; /* Don't split across pages */
}
```

**Use Running Headers:**
```css
h1 {
  string-set: chapter content();
}

@page {
  @top-center {
    content: string(chapter);
    font-size: 10pt;
    font-style: italic;
  }
}
```

### Performance Tips

**For Large Projects:**
- Split content into multiple markdown files
- Use preview mode to identify performance issues
- Optimize images (compress, resize)
- Consider removing unused CSS

**For Slow Builds:**
- PDF generation is the bottleneck
- Use preview mode during development for faster iteration
- Use preview mode during development
- Only build PDF for final output

### Troubleshooting

See [README.md - Troubleshooting](../README.md#troubleshooting) for common issues and solutions.

---

## Next Steps

- **[Theme Customization Guide](./theme-customization.md)** - Deep dive into CSS styling
- **[Examples](../examples/)** - Sample projects to learn from
- **[Architecture](./ARCHITECTURE.md)** - How print-md works internally
- **[Contributing](../CONTRIBUTING.md)** - Help improve print-md

---

**Questions or issues?** [Open an issue on GitHub](https://github.com/dimm-city/print-md/issues)

**Want to contribute?** See [CONTRIBUTING.md](../CONTRIBUTING.md)
