# Print-md User Guide Example

This project is the official Print-md user documentation rendered as a print-ready book. It serves two purposes:

1. **Documentation** — every feature is described and explained
2. **Example** — this project is itself built with the commands it documents

## Usage

```bash
# Preview with live reload
print-md preview examples/print-md-user-guide

# Build a PDF
print-md build examples/print-md-user-guide

# Build a print-ready PDF/X
print-md build examples/print-md-user-guide --format pdfx
```

## Structure

```
print-md-user-guide/
├── manifest.yaml          # Project configuration
├── README.md              # This file
├── styles/
│   └── guide.css          # Stylesheet (tokens, page rules, typography, components)
├── 00-cover.md            # Cover page
├── 00-toc.md              # Table of contents
├── 01-getting-started.md  # Installation, workflow, manifest configuration
├── 02-writing-content.md  # Typography, formatting, layout directives
├── 03-visual-elements.md  # Callouts, images, full-bleed artwork
├── 04-styling-theming.md  # CSS variables, themes, fonts, page templates
├── 05-ttrpg-extensions.md # Stat blocks, dice, cross-refs, traits, CR
├── 06-plugins.md          # Adding, writing, and loading plugins
├── 07-validation.md       # Validation system, CLI, best practices
└── 08-system-setup.md     # External tools, install, troubleshooting
```

## Chapters

| # | Chapter | Source docs |
|---|---------|-------------|
| 01 | Getting Started | `docs/getting-started.md` |
| 02 | Writing Your Content | `docs/typography.md`, `docs/core-directives.md` |
| 03 | Visual Elements | `docs/callouts.md`, `docs/images.md` |
| 04 | Styling & Theming | `docs/styling-theming.md` |
| 05 | TTRPG Extensions | `docs/ttrpg-extensions.md` |
| 06 | Plugins | `docs/plugins.md` |
| 07 | Validation & Best Practices | `docs/validation.md`, `docs/best-practices.md` |
| 08 | System Setup | `docs/system-dependencies.md` |
