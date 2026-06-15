# Getting Started {#ch-getting-started}

<div class="lede">Print-md converts markdown files into professional print PDFs. It is designed for books, manuals, rulebooks, and any print-first document — using Chromium and Paged.js for rendering.</div>

## Installation

Download the latest release for your platform from GitHub Releases. Print-md ships as a single standalone binary — no Node, no Bun, no `node_modules` required on your machine.

```bash
# Verify the install
print-md --version
```

For development use, run from source:

```bash
bun packages/cli/src/cli.ts --version
```

## Basic Workflow

Three commands cover most use cases:

```bash
# Build a PDF from a project directory
print-md build ./my-book

# Preview with live reload in the browser
print-md preview ./my-book

# Build with a custom output filename
print-md build ./my-book --out my-book.pdf
```

The `preview` command starts a local server at `http://localhost:3000` and reloads when any source file changes. The `build` command produces a PDF in a `dist/` directory next to your project.

### Previewing in Different Browsers

The live preview runs in your browser. Safari and Firefox may place page breaks slightly differently from the exported PDF because each browser measures text differently — the PDF, which always renders in Chromium, is the authoritative layout. To minimise the difference, embed your fonts with `@font-face` instead of relying on system fonts.

## Project Structure

A Print-md project is a directory with a `manifest.yaml` file and one or more markdown source files:

```
my-book/
├── manifest.yaml          # Book configuration
├── 01-introduction.md     # Chapter files (numbered for order)
├── 02-chapter-two.md
├── 03-chapter-three.md
├── assets/                # Images, fonts, diagrams
│   └── cover.jpg
└── styles/                # Custom CSS (optional)
    └── custom.css
```

Files are processed in the order listed in `manifest.yaml`. If no order is specified, they are processed alphabetically — which is why numeric prefixes (`01-`, `02-`) are the standard convention.

## Manifest Configuration

The `manifest.yaml` file configures the book metadata, page geometry, stylesheets, and source files. Create one in your project directory:

```yaml
# Basic metadata
title: "My Awesome Book"
authors:
  - "Jane Doe"
  - "John Smith"

# Page format (values in points: 72pt = 1in)
page:
  width: 432
  height: 648
  tolerance: 0.5

# Stylesheets (applied in order, last wins on conflicts)
styles:
  - "styles/custom.css"

# File ordering (defaults to alphabetical if omitted)
source:
  files:
    - "01-introduction.md"
    - "02-chapter-two.md"
  assets:
    - styles
    - assets

# Plugins (optional)
plugins:
  - ttrpg
```

### Page Size Reference

Common book trim sizes in points (72pt = 1 inch):

@section

| Format | Width | Height | Common Use |
|--------|------:|-------:|------------|
| US Letter | 612 | 792 | Manuals, guides |
| Trade 6×9 | 432 | 648 | Novels, rulebooks |
| Digest 5.5×8.5 | 396 | 612 | Supplements |
| A4 | 595 | 842 | European standard |
| A5 | 420 | 595 | Pocket guides |

@end-section

## File Organization

### Recommended Structure

```
my-book/
├── manifest.yaml
├── 00-frontmatter/
│   ├── title.md
│   ├── credits.md
│   └── toc.md
├── 01-introduction.md
├── 02-chapter-one.md
├── 03-chapter-two.md
├── 99-backmatter/
│   ├── appendix.md
│   └── index.md
├── assets/
│   ├── images/
│   ├── fonts/
│   └── diagrams/
└── styles/
    └── custom.css
```

### Naming Conventions

- **Number files** for explicit ordering: `01-intro.md`, `02-chapter.md`
- **Use descriptive names**: `character-creation.md` not `cc.md`
- **Keep images organized**: Use subdirectories by chapter or type
- **All lowercase with hyphens**: `forest-scene.jpg`, not `Forest Scene.jpg`

## Next Steps

With your project set up, the following chapters cover how to write content, control layout, add visual elements, and prepare for print.

> **Chapter 2** covers the full markdown syntax and layout directives — `@page`, `@section`, `@column-break`, and more.

> **Chapter 7** covers the validation system that checks your project for print compliance before and after the PDF build.
