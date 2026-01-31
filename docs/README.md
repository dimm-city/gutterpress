# Print-md Documentation

Complete documentation for creating professional print documents from markdown.

## Quick Start

New to Print-md? Start here:

- **[Getting Started](getting-started.md)** - Installation, basic workflow, and project setup

## Core Documentation

### Essential Guides

- **[Getting Started](getting-started.md)**
  Learn the basics of Print-md, including installation, basic commands, project structure, and manifest configuration. Start here if you're new to the tool.

- **[Core Directives](core-directives.md)**
  Master page control with directives for page templates, page breaks, column layouts, and running headers. Essential for controlling document structure.

- **[Typography & Formatting](typography.md)**
  Learn about headings, text formatting, lists, blockquotes, tables, and professional typography practices for print documents.

- **[Callouts & Admonitions](callouts.md)**
  Use professional callouts to highlight important information. Includes five standard types (note, tip, warning, danger, info) with GitHub-style syntax.

- **[Images & Artwork](images.md)**
  Comprehensive guide to using images in print, including sizing, positioning, full-bleed artwork, print-safe requirements, and resolution guidelines.

### Advanced Features

- **[TTRPG Extensions](ttrpg-extensions.md)**
  Specialized markdown syntax for tabletop RPG content, including stat blocks, dice notation, cross-references, trait callouts, and challenge ratings.

- **[Styling & Theming](styling-theming.md)**
  Customize your document's appearance with built-in themes, CSS variables, custom styles, and advanced page templates.

- **[Best Practices](best-practices.md)**
  Professional guidelines for file organization, writing, print optimization, testing, and production workflows.

## Complete Reference

- **[Authoring Guide](authoring-guide.md)**
  Comprehensive single-file reference covering all features in detail. Use this for deep dives or offline reference.

## Documentation by Use Case

### I want to...

**Create my first document**
→ [Getting Started](getting-started.md)

**Control where pages break**
→ [Core Directives](core-directives.md)

**Format text and headings**
→ [Typography & Formatting](typography.md)

**Add warning boxes or tips**
→ [Callouts & Admonitions](callouts.md)

**Include photos or artwork**
→ [Images & Artwork](images.md)

**Create an RPG rulebook**
→ [TTRPG Extensions](ttrpg-extensions.md)

**Customize colors and fonts**
→ [Styling & Theming](styling-theming.md)

**Prepare for professional printing**
→ [Best Practices](best-practices.md)

## Quick Reference

### Common Commands

```bash
# Build PDF
print-md build ./my-book

# Preview with live reload
print-md preview ./my-book

# Build with custom output
print-md build ./my-book --output book.pdf

# Build HTML instead of PDF
print-md build ./my-book --format html
```

### Common Directives

```markdown
<!-- @page: chapter -->     Apply chapter template
<!-- @break -->             Force page break
<!-- @spread: right -->     Start on right page
<!-- @columns: 2 -->        Two-column layout
```

### Common Callouts

```markdown
> [!note]      Blue - General information
> [!tip]       Green - Helpful advice
> [!warning]   Orange - Important cautions
> [!danger]    Red - Critical warnings
> [!info]      Gray - Neutral information
```

## Documentation Structure

```
docs/
├── README.md                    # This file
├── authoring-guide.md          # Complete reference (all-in-one)
├── getting-started.md          # Introduction and setup
├── core-directives.md          # Page control and directives
├── typography.md               # Text formatting
├── callouts.md                 # Callouts and admonitions
├── images.md                   # Image handling
├── ttrpg-extensions.md         # TTRPG features
├── styling-theming.md          # Customization
└── best-practices.md           # Professional guidelines
```

## Contributing

Found an error or want to improve the documentation?

1. Submit an issue on GitHub
2. Create a pull request with corrections
3. Share your examples and use cases

## Additional Resources

- **Prince XML Documentation:** https://www.princexml.com/doc/
- **Vivliostyle Documentation:** https://docs.vivliostyle.org/
- **Markdown Guide:** https://www.markdownguide.org/
- **CSS Paged Media:** https://www.w3.org/TR/css-page-3/
- **Print Design Principles:** Research professional book design
