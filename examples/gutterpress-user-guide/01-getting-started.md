# Getting Started {#ch-getting-started}

@section .lede

Gutterpress converts markdown files into professional print PDFs. It is designed for books, manuals, rulebooks, and any print-first document --- using a native Chromium print engine for rendering.

@end-section

## Installation

Download the latest release for your platform from GitHub Releases. Gutterpress ships as a self-contained desktop app and standalone CLI binaries --- no Node, no Bun, or `node_modules` required. The [installation guide](https://github.com/dimm-city/gutterpress/blob/main/docs/installing.md) lists the supported architectures, Homebrew and Scoop commands, checksums, and unsigned-app first-run steps.

```bash
# Verify the install
gutterpress --version
```

For development use, run from source:

```bash
bun packages/cli/src/cli.ts --version
```

## Create Your First Project

The fastest way to start is the built-in scaffolder --- it generates a working
project (manifest, a starter chapter, an editable stylesheet, and local
version history) in one command, so you never have to
hand-write a manifest just to get going:

```bash
gutterpress new "My Book" --preset dtrpg
```

The `--preset` names what the book is *designed for* --- it sets the page size
and print rules the project starts with, and it is required:

- `dtrpg` --- DriveThruRPG print-on-demand: the 8.5×11in book's file size, trim plus a 0.125in bleed on the top, bottom and outer edges (621×810pt = 8.625×11.25in), print-ready checks on by default
- `book` --- a neutral 6×9in trade book, no print-service rules
- `custom` --- you supply the trim: add `--page-width` and `--page-height` (points; 72pt = 1in)

The command also records *where* you'll publish (the manifest's `targets:`
list --- see Chapter 6): the preset's default (`dtrpg` validates for
DriveThruRPG; `book`/`custom` for nothing), or your own choice via
`--targets dtrpg,itch` / `--targets none`. If a chosen destination needs
qpdf or Ghostscript and they aren't installed, the command tells you up
front that a print-compliant PDF can't be built or verified until they are
--- you can install them later (Chapter 7) or opt out with `--targets none`.

This creates a `my-book/` folder in the current directory:

```
my-book/
├── manifest.yaml       # Pre-filled with your title and author
├── chapter-01.md       # A starter chapter -- replace with your content
├── styles/
│   └── book.css        # Your own stylesheet -- ready to edit
└── assets/             # Images, fonts, diagrams go here
```

A new book has no look. Add one when you want it --- a built-in look
(`gutterpress ext add clean-book my-book`) or one from npm --- and it is
listed under `extensions:` in the manifest, with `styles/book.css` as your own
layer on top of it. Chapter 4 covers looks; Chapter 5 covers the
`extensions:` list itself.

It also runs `git init` and records a "Created project" snapshot by default ---
local version history with no credentials and no remote required. Pass
`--no-git` to skip that.

Useful flags:

```bash
gutterpress new "My Book" --preset dtrpg --author "Jane Doe"   # record an author
gutterpress new "My Book" --preset dtrpg --dir ~/Books         # choose a parent directory
gutterpress new "My Book" --preset dtrpg --template zine       # book | zine | technical | paper
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

The `preview` command starts a local server --- by default at
`http://localhost:3579` (override with `--port`) --- and reloads when any
source file changes; the terminal always prints the actual URL on startup,
so that's the source of truth if you've changed the port. The `build`
command produces a PDF in a `dist/` directory next to your project.

### Which Browser to Preview In

Gutterpress supports Chrome, Edge, and other Chromium-based browsers --- and nothing else. Firefox and Safari are not supported: the PDF always renders in Chromium, so a preview in another engine measures text differently and places page breaks the PDF will not reproduce. The desktop app previews in its own bundled Chromium, so it always matches; if you preview from the CLI, open the URL it prints in a Chromium-based browser. Either way, embed your fonts with `@font-face` instead of relying on system fonts, so the preview measures the same fonts the PDF prints.

### Print Overlays {#print-overlays}

The preview can draw the printer's bleed and safe-area rules on top of every page, so you can see what will be cut and spot a line of text or a picture that sits too close to the edge. It is a review aid only: it never prints, never appears in an exported PDF or a published page, and never moves your content or changes a page break.

There are four layers. Each has its own colour (you can change them, below) and its own switch, so every line on the page has its own row in the legend:

@section

| Layer | What it draws | Colour |
|-------|---------------|--------|
| **Bleed** | A tinted band outside the trim, and a solid line where the page is cut | Red |
| **Safe area: text** | The printer's safe line for text, **dashed**, with the strip between it and the trim tinted | Blue |
| **Safe area: art** | The printer's safe line for art that does not bleed, **dotted** | Purple |
| **Page margins** | The box your margins (Setup > Details, or `page.margin` in the manifest) leave for text, as a thin solid line. It is your book's choice, not the printer's | Green |

@end-section

When the two safe areas are the same distance (the `book` preset sets one distance for both), the two lines lie on top of each other. Switch one layer off to see the other alone.

With **Safe area: text** or **Safe area: art** on, anything that strays from its safe line is outlined. Each layer outlines only what its own rule covers: **Safe area: text** checks text line by line, and **Safe area: art** checks pictures, videos and any box with a background or a border. A box that paints nothing is never outlined, only what it holds, and the folios and running heads in your page margins are checked too. The outlines are:

- an **amber outline** on a line of text, a picture or a box that leaves its safe line but stays on the trimmed page;
- a **red outline** on anything that crosses the trim into the bleed band or off the page. Art that runs all the way to the edge of the page is a good bleed and is left alone; art that stops partway into the bleed band is outlined;
- a **dotted pink outline**, softly, on art you placed on purpose: `.gp-bleed` images, `.gp-pin` / `.gp-flush` pinned art, `.gp-behind` images and `@page full-bleed` pages. These are expected to reach the edge, so they are shown but not counted.

**The legend.** A small legend in the bottom-right corner of the preview stays put as you scroll and zoom. It has a row for each layer that is on, with its colour and its sizes in inches, where the numbers come from, and what the safe area layers found:

```
Bleed 0.125in -- top, bottom, outside; none at the binding
Safe area: text -- 0.5in, every edge
Safe area: art -- 0.25in top, bottom, outside; 0.5in at the binding
Page margins -- your stylesheet's @page margins
from DriveThruRPG -- Quick Specifications for Print Books
3 text outside the safe area · 1 art outside · 2 in the bleed band
```

*Outside* is the edge away from the spine and *binding* is the edge at the spine: on a right-hand (odd) page the binding edge is the left one, and page 1 is a right-hand page. The source line links to the printer's article when your preset has one; otherwise it names `manifest.yaml`. The last line counts only what the safe area layers that are on look at: text for **Safe area: text**, art for **Safe area: art**, and whatever either finds in the bleed band or off the page. A clean book says "everything inside the safe area", or "all text inside the safe area" or "all art inside the safe area" when only one of the two is on. When the legend is in your way, the chevron beside its **Print overlays** title folds it down to that title; click it again to open it. The preview keeps it as you left it.

To switch the overlays on:

- **Desktop app:** the **print overlays** button at the top right of the preview (next to the zoom menu) switches the overlays on and off, in Read and in Edit. The small arrow beside it opens a menu with a tick box and a colour swatch for each layer. A number on the button counts what the safe area layers found, and hovering shows a one-line summary. The app remembers your choices.
- **`gutterpress preview`:** press **Alt+M** in the browser to show all four layers, and **Alt+M** again to hide them (the legend's last line says so). There is no layer menu in the browser: you get all four, in the default colours.

To change the colours or how bold the lines are, use the desktop app's **Settings &rarr; App &rarr; Preview**: **Print overlay strength** (Subtle, Normal, Strong) and one colour each for **Bleed**, **Safe area: text**, **Safe area: art** and **Page margins**. These are app settings; there is nothing to add to your book's CSS. `gutterpress preview` always uses the default colours and the Normal strength.

**The numbers come from your project's print settings, never from your book's styles.** They are `page.bleed`, `page.safe` and `page.artSafe` in `manifest.yaml`, or your preset's values when you set none ([DriveThruRPG Requirements](#dtrpg-requirements) and [Bleed and Safe Area Settings](#bleed-safe-settings) below list them). Only the Page margins layer reads your stylesheet, because it shows your `@page` margins; moving your margins never moves the printer's lines. No stylesheet or plugin can hide, move or restyle the overlays: they are drawn above the whole preview, apart from the book. If the project sets no bleed or no safe area, that part is not drawn and the legend says which setting to add.

## Project Structure

A Gutterpress project is a directory with a `manifest.yaml` file and one or more markdown source files --- the same shape `gutterpress new` just created for you, grown out with more chapters:

```
my-book/
├── manifest.yaml          # Book configuration
├── 01-introduction.md     # Chapter files (numbered for order)
├── 02-chapter-two.md
├── 03-chapter-three.md
├── assets/                # Images, fonts, diagrams
│   └── cover.jpg
├── extensions/            # Looks and plugins added with `gutterpress ext add` (Chapters 4--5)
└── styles/                # Custom CSS (optional)
    └── custom.css
```

Files are processed in the order listed in `manifest.yaml`. If no order is specified, they are processed alphabetically --- which is why numeric prefixes (`01-`, `02-`) are the standard convention.

## Reference: Manifest Configuration

You don't need to hand-write `manifest.yaml` --- `gutterpress new` already
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

# The book's language (a BCP 47 tag: en, de-CH, pt-BR; default en). Sets the
# HTML lang, which hyphenation follows, and the quotation marks straight
# quotes print as.
language: en

# What the book is designed for: dtrpg | book | custom.
# Fills in page geometry and print-rule defaults; anything you set
# explicitly below always wins over the preset.
preset: book

# Page size and margins (values in points: 72pt = 1in). The size is what
# your book prints at and what the built PDF is checked against; the
# margins are the space between the trim and your text, `inside` at the
# binding edge. The manifest decides both: a `size` in a stylesheet is
# ignored, and a stylesheet's `@page` margins apply only while `margin` is
# left out. Width and height are required when `preset: custom`, optional
# overrides otherwise.
page:
  width: 432
  height: 648
  margin:
    top: 61.2
    bottom: 61.2
    inside: 54
    outside: 54

# Extensions -- a look, plugins -- in load order. Your `styles:` always load
# after every extension (Chapters 4 and 5).
extensions:
  - clean-book

# Stylesheets (applied in order, last wins on conflicts)
styles:
  - "styles/custom.css"

# Chapter order (defaults to alphabetical if omitted)
chapters:
  - "01-introduction.md"
  - "02-chapter-two.md"
```

Plugins are optional and most projects don't need any --- see Chapter 5, *Plugins*, for the `extensions:` manifest list (looks and plugins share it) and the bundled, no-install-required features.

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

Your book prints at the manifest's `page.width` × `page.height` --- your preset's size unless you set them --- and that is also the size the finished PDF is checked against. The build writes it as the `@page { size }` after every stylesheet, so a `size` in a stylesheet is ignored (the CSS check tells you so). Margins work the same way: `page.margin` (`top`, `bottom`, `inside` and `outside`, in points, `inside` at the binding edge) prints your book with those margins whatever a look's stylesheet says; leave it out and the stylesheets' `@page` margins apply, else 1in. In the app, both are under Setup > Details.

### DriveThruRPG Requirements {#dtrpg-requirements}

These are DriveThruRPG's print-on-demand rules for an 8.5×11in interior, from DriveThru Partners' help articles [Quick Specifications for Print Books](https://help.drivethrupartners.com/hc/en-us/articles/12780800178583-Quick-Specifications-for-Print-Books) and [Correcting Most Common Print Errors](https://help.drivethrupartners.com/hc/en-us/articles/12780799485335-Correcting-Most-Common-Print-Errors). The `dtrpg` preset is set up to meet them; the last column says where Gutterpress shows or checks each one.

@section

| Rule | DriveThruRPG asks for | In Gutterpress |
|------|-----------------------|----------------|
| File size | 8.625×11.25in (621×810pt): the trim plus the bleed | `dtrpg` preset; the page-size check |
| Bleed | 0.125in (9pt) on the top, bottom and outside edges; none at the binding edge | **Bleed** layer |
| Text | At least 0.5in (36pt) inside the trim, on every edge | **Safe area: text** layer; [the safe-margins check](#safe-margins-check) |
| Art that does not bleed | At least 0.25in (18pt) from the top, bottom and outside edges; 0.5in (36pt) from the binding edge | **Safe area: art** layer; [the safe-margins check](#safe-margins-check), for images |
| PDF | PDF/X-1a:2001 or PDF/X-3:2002, every font embedded, CMYK or greyscale images, ICC profile CGATS21_CRPC1 | `--format pdfx` build; the PDF/X, font and colour checks |
| Ink | Total area coverage of 240% or less | The ink-coverage check |
| Page count | US Letter prints in 4-page signatures, and the file ends on a blank page | `dtrpg` preset pads the book; the signature check |

@end-section

The trim is the page after it is cut. The file is the trim plus the bleed on the top, bottom and outside edges only. The checks are covered in [Chapter 6](#ch-validation), and the tools they need in [Chapter 7](#ch-system).

### Bleed and Safe Area Settings {#bleed-safe-settings}

Four `page:` settings in `manifest.yaml` tell the print overlays where the trim and the printer's safe lines are. They are in points (72pt = 1 inch), and your preset fills them in when you set none:

@section

| Setting | What it is | `dtrpg` | `book` |
|---------|------------|---------|--------|
| `page.bleed` | The bleed your page size already contains, on the top, bottom and outside edges (none at the binding edge) | 9 (0.125in) | none |
| `page.safe` | The text rule: how far inside the trim text must stay, on every edge (the binding edge too, unless you set `page.gutter`) | 36 (0.5in) | 18 (0.25in) |
| `page.artSafe` | The art rule: how far inside the trim art that does not bleed must stay, on the top, bottom and outside edges; the binding edge uses `page.gutter`, and where none is set art follows `page.safe` on every edge | 18 (0.25in) | none |
| `page.gutter` | The binding allowance: how far from the spine text and art stay, instead of `page.safe`, at the binding edge only. Set it when your book keeps its text further from the spine than the printer's minimum, so the lines show the distance your book commits to; where none is set it is `page.safe` | 36 (0.5in) | none |

@end-section

The `custom` preset sets none of the four, so add your own to see the bleed and the safe lines.

Three things read these settings: the preview's print overlays (all four), pinned art (print and preview both place it on the art-safe line, `page.gutter` at the binding) and the safe-margins check (all four, to find the trim and the text and art lines). The overlays and the check change nothing in your PDF, and no stylesheet moves any of these lines. To hold a `book` to DriveThruRPG's text and art rules:

```yaml
preset: book
page:
  safe: 36      # text at least 0.5in inside the trim
  artSafe: 18   # art at least 0.25in from the outside edges
```

A book whose inner margin is wider than the printer's minimum says so with `page.gutter`, in the manifest and not in the stylesheet. With this, the binding lines sit 0.75in from the trim, and the legend says "Safe area: text --- 0.5in; 0.75in at the binding":

```yaml
page:
  gutter: 54    # text and art at least 0.75in from the spine
```

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

This layout is a suggestion, not a requirement --- put images and fonts
wherever makes sense for your project. An image referenced from markdown or
HTML just needs to live somewhere inside the project folder; a font (or
image) referenced from CSS resolves relative to that CSS file, wherever it
lives, and Gutterpress embeds it into the book automatically. See
[Chapter 4 --- Font Loading](#font-loading).

### Naming Conventions

- **Number files** for explicit ordering: `01-intro.md`, `02-chapter.md`
- **Use descriptive names**: `character-creation.md` not `cc.md`
- **Keep images organized**: Use subdirectories by chapter or type
- **All lowercase with hyphens**: `forest-scene.jpg`, not `Forest Scene.jpg`

## Next Steps

With your project set up, the following chapters cover how to write content, control layout, add visual elements, and prepare for print.

> **Chapter 2** covers the full markdown syntax and layout directives --- `@page`, `@section`, `@column-break`, and more.

> **Chapter 6** covers the validation system that checks your project for print compliance before and after the PDF build.
