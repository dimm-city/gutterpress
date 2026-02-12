# Getting Started with Print-md

Print-md converts markdown files into professional print PDFs. It's designed for creating books, manuals, rulebooks, and any print-first documents. Uses Chromium + Paged.js for PDF generation and Paged.js for live preview.

## Basic Workflow

```bash
# Build a PDF from markdown files
print-md build ./my-book

# Preview with live reload
print-md preview ./my-book

# Build with custom output name
print-md build ./my-book --out my-book.pdf
```

## Project Structure

```
my-book/
├── manifest.yaml          # Book configuration
├── 01-introduction.md     # Chapter files (numbered for order)
├── 02-mechanics.md
├── 03-combat.md
├── assets/                # Images, fonts, etc.
│   └── cover.jpg
└── styles/                # Custom CSS (optional)
    └── custom.css
```

## Document Structure

### Manifest Configuration

Create a `manifest.yaml` file in your project directory:

```yaml
# Basic metadata
title: "My Awesome Book"
authors:
  - "Jane Doe"
  - "John Smith"
description: "A comprehensive guide to..."

# Page format
page:
  width: 432
  height: 648
  tolerance: 0.5

# Margins (optional)
margins:
  top: 54
  bottom: 54
  inner: 54
  outer: 36

# Styling (CSS cascade)
styles:
  - "themes/classic.css"   # Bundled theme
  - "styles/custom.css"    # Your custom styles

# File ordering (optional - defaults to alphabetical)
files:
  - "01-introduction.md"
  - "02-mechanics.md"
  - "03-combat.md"

# Enable plugins (optional)
plugins:
  - "ttrpg"                # Stat blocks, dice notation, etc.
  - "dimm-city"            # District badges, roll prompts
```

### Page Format Options

Common book sizes (width x height in points):

```yaml
# Trade paperback (6in x 9in)
page:
  width: 432
  height: 648

# Standard novel (5.5in x 8.5in)
page:
  width: 396
  height: 612

# Large format (8.5in x 11in)
page:
  width: 612
  height: 792

# A4 (210mm x 297mm)
page:
  width: 595
  height: 842

# A5 (148mm x 210mm)
page:
  width: 420
  height: 595
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

### Naming Conventions

- **Number files** for explicit ordering: `01-intro.md`, `02-chapter.md`
- **Use descriptive names**: `character-creation.md` not `cc.md`
- **Separate frontmatter/backmatter**: Use folders or clear numbering
- **Keep images organized**: Use subdirectories by type or chapter

## Next Steps

- Review the [Core Directives Reference](core-directives.md) for page control
- Learn about [Typography & Formatting](typography.md) options
- Explore [Callouts & Admonitions](callouts.md) for highlighted content
- See [Styling & Theming](styling-theming.md) for customization
- Check [Best Practices](best-practices.md) for print optimization
