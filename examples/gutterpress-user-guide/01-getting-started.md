# Getting Started {#ch-getting-started}

@section .lede

Gutterpress converts markdown files into professional print PDFs. It is designed for books, manuals, rulebooks, and any print-first document — using a native Chromium print engine for rendering.

@end-section

## Installation

Download the latest release for your platform from GitHub Releases. Gutterpress ships as a self-contained desktop app and standalone CLI binaries — no Node, no Bun, or `node_modules` required. The [installation guide](../../docs/installing.md) lists the supported architectures, Homebrew and Scoop commands, checksums, and unsigned-app first-run steps.

```bash
# Verify the install
gutterpress --version
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
gutterpress new "My Book" --preset dtrpg
```

The `--preset` names what the book is *designed for* — it sets the page size
and print rules the project starts with, and it is required:

- `dtrpg` — DriveThruRPG print-on-demand: letter-with-bleed page (621×810pt = 8.625×11.25in), print-ready checks on by default
- `book` — a neutral 6×9in trade book, no print-service rules
- `custom` — you supply the trim: add `--page-width` and `--page-height` (points; 72pt = 1in)

The command also records *where* you'll publish (the manifest's `targets:`
list — see Chapter 6): the preset's default (`dtrpg` validates for
DriveThruRPG; `book`/`custom` for nothing), or your own choice via
`--targets dtrpg,itch` / `--targets none`. If a chosen destination needs
qpdf or Ghostscript and they aren't installed, the command tells you up
front that a print-compliant PDF can't be built or verified until they are
— you can install them later (Chapter 7) or opt out with `--targets none`.

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
gutterpress new "My Book" --preset dtrpg --author "Jane Doe"   # record an author
gutterpress new "My Book" --preset dtrpg --dir ~/Books         # choose a parent directory
gutterpress new "My Book" --preset dtrpg --template zine       # book | zine | technical
gutterpress new "My Book" --preset dtrpg --no-git              # skip local version history
gutterpress new "My Zine" --preset custom \
  --page-width 396 --page-height 612                            # your own trim size, in points
```

## Basic Workflow

Three commands cover most use cases:

```bash
# Build a PDF from a project directory
gutterpress build ./my-book

# Preview with live reload in the browser
gutterpress preview ./my-book

# Build with a custom output filename
gutterpress build ./my-book --out my-book.pdf
```

The `preview` command starts a local server — by default at
`http://localhost:3579` (override with `--port`) — and reloads when any
source file changes; the terminal always prints the actual URL on startup,
so that's the source of truth if you've changed the port. The `build`
command produces a PDF in a `dist/` directory next to your project.

### Which Browser to Preview In

Gutterpress supports Chrome, Edge, and other Chromium-based browsers — and nothing else. Firefox and Safari are not supported: the PDF always renders in Chromium, so a preview in another engine measures text differently and places page breaks the PDF will not reproduce. The desktop app previews in its own bundled Chromium, so it always matches; if you preview from the CLI, open the URL it prints in a Chromium-based browser. Either way, embed your fonts with `@font-face` instead of relying on system fonts, so the preview measures the same fonts the PDF prints.

## Project Structure

A Gutterpress project is a directory with a `manifest.yaml` file and one or more markdown source files — the same shape `gutterpress new` just created for you, grown out with more chapters:

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

You don't need to hand-write `manifest.yaml` — `gutterpress new` already
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

# What the book is designed for: dtrpg | book | custom.
# Fills in page geometry and print-rule defaults; anything you set
# explicitly below always wins over the preset.
preset: book

# Page validation bounds (values in points: 72pt = 1in). The actual trim
# comes from your stylesheet's @page rule — these are the size the built
# PDF is checked against, so keep the two matching. Required (width and
# height) when `preset: custom`; optional overrides otherwise.
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
```

Plugins are optional and most projects don't need any — see Chapter 5, *Plugins*, for the `plugins:` manifest key and the bundled, no-install-required plugins.

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

This layout is a suggestion, not a requirement — put images and fonts
wherever makes sense for your project. An image referenced from markdown or
HTML just needs to live somewhere inside the project folder; a font (or
image) referenced from CSS resolves relative to that CSS file, wherever it
lives, and Gutterpress embeds it into the book automatically. See
[Chapter 4 — Font Loading](./04-styling-theming.md#font-loading).

### Naming Conventions

- **Number files** for explicit ordering: `01-intro.md`, `02-chapter.md`
- **Use descriptive names**: `character-creation.md` not `cc.md`
- **Keep images organized**: Use subdirectories by chapter or type
- **All lowercase with hyphens**: `forest-scene.jpg`, not `Forest Scene.jpg`

## Next Steps

With your project set up, the following chapters cover how to write content, control layout, add visual elements, and prepare for print.

> **Chapter 2** covers the full markdown syntax and layout directives — `@page`, `@section`, `@column-break`, and more.

> **Chapter 6** covers the validation system that checks your project for print compliance before and after the PDF build.
