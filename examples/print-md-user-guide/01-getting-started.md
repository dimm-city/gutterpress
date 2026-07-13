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

## Create Your First Project

The fastest way to start is the built-in scaffolder — it generates a working
project (manifest, a starter chapter, a real editable stylesheet, and local
version history) in one command, so you never have to hand-write a manifest
just to get going:

```bash
print-md new "My Book"
```

This creates a `my-book/` folder in the current directory:

```
my-book/
├── manifest.yaml       # Pre-filled with your title and author
├── chapter-01.md       # A starter chapter — replace with your content
├── styles/
│   └── book.css        # A real starter stylesheet, ready to edit
└── assets/              # Images, fonts, diagrams go here
```

It also runs `git init` and records a "Created project" snapshot by default —
local version history with no credentials and no remote required. Pass
`--no-git` to skip that.

Useful flags:

```bash
print-md new "My Book" --author "Jane Doe"   # record an author
print-md new "My Book" --dir ~/Books         # choose a parent directory
print-md new "My Book" --template ttrpg      # book | ttrpg | zine | technical
print-md new "My Book" --no-git              # skip local version history
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

The `preview` command starts a local server — by default at
`http://localhost:3579` (override with `--port`) — and reloads when any
source file changes; the terminal always prints the actual URL on startup,
so that's the source of truth if you've changed the port. The `build`
command produces a PDF in a `dist/` directory next to your project.

### Previewing in Different Browsers

The live preview runs in your browser. Safari and Firefox may place page breaks slightly differently from the exported PDF because each browser measures text differently — the PDF, which always renders in Chromium, is the authoritative layout. To minimise the difference, embed your fonts with `@font-face` instead of relying on system fonts.

## Project Structure

A Print-md project is a directory with a `manifest.yaml` file and one or more markdown source files — the same shape `print-md new` just created for you, grown out with more chapters:

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

## Reference: Manifest Configuration

You don't need to hand-write `manifest.yaml` — `print-md new` already
generated one for you, pre-filled with your title and author. This section
is a reference for editing it directly (changing page size, adding
stylesheets, reordering chapters) or for authors who prefer to build a
project from scratch instead of the scaffolder.

The `manifest.yaml` file configures the book metadata, page geometry, stylesheets, and source files:

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
```

Plugins are optional and most projects don't need any — see Chapter 6, *Plugins*, for the `plugins:` manifest key and the bundled, no-install-required plugins.

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
