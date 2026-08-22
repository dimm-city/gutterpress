# Gutterpress Documentation

Complete documentation for creating professional print documents from markdown.

> **📖 User Guide** — The canonical documentation is the **[Gutterpress User Guide](../examples/gutterpress-user-guide/)**, a professionally formatted book covering all core features. Start here for learning Gutterpress.
>
> This directory contains technical architecture docs and advanced references. For authoring guides, see the user guide chapters linked below.

## Quick Start

New to Gutterpress? Start here:

- **[User Guide — Chapter 1: Getting Started](../examples/gutterpress-user-guide/01-getting-started.md)** - Installation, basic workflow, and project setup

## Core Documentation (see User Guide)

See the **[Gutterpress User Guide](../examples/gutterpress-user-guide/)** for all core documentation:

- **Chapter 1: Getting Started** — Installation, basic commands, project structure, manifest configuration
- **Chapter 2: Writing Your Content** — Headings, text formatting, lists, blockquotes, tables, layout directives
- **Chapter 3: Visual Elements** — Callouts, images, artwork, print-safe requirements
- **Chapter 4: Styling & Theming** — CSS custom properties, themes, fonts, page templates
- **Chapter 5: Plugins** — Adding and writing markdown-it plugins
- **Chapter 6: Validation** — Source/asset/PDF checks, configuration, workflows
- **Chapter 7: System Setup** — Tool installation, environment variables, troubleshooting
- **Chapter 8: Publishing** — Sending a finished book to publishing platforms

The user guide is authored as a complete professional book and serves as the canonical reference for all features.

## Documentation by Use Case

See the [Gutterpress User Guide](../examples/gutterpress-user-guide/) for all topics:

**Create my first document**
→ [User Guide: Chapter 1 — Getting Started](../examples/gutterpress-user-guide/01-getting-started.md)

**Control where pages break**
→ [User Guide: Chapter 2 — Layout Directives](../examples/gutterpress-user-guide/02-writing-content.md#layout-directives)

**Format text and headings**
→ [User Guide: Chapter 2 — Text Formatting](../examples/gutterpress-user-guide/02-writing-content.md#text-formatting)

**Add warning boxes or tips**
→ [User Guide: Chapter 3 — Callouts](../examples/gutterpress-user-guide/03-visual-elements.md#callouts)

**Include photos or artwork**
→ [User Guide: Chapter 3 — Images](../examples/gutterpress-user-guide/03-visual-elements.md#images)

**Customize colors and fonts**
→ [User Guide: Chapter 4 — Styling & Theming](../examples/gutterpress-user-guide/04-styling-theming.md)

**Structure CSS for a multi-chapter book** (the recommended pattern for component variants, per-chapter overrides, and reusable section libraries)
→ [The Contextual Cascade Principle](./contextual-cascade-principle.md)

**Validate my project for print**
→ [User Guide: Chapter 6 — Validation](../examples/gutterpress-user-guide/06-validation.md)

**Prepare for professional printing**
→ [User Guide: Chapter 7 — System Setup](../examples/gutterpress-user-guide/07-system-setup.md)

**Diagnose a missing-tool error (`spawn gs ENOENT`, "No Chromium found", etc)**
→ [User Guide: Chapter 7 — System Setup / Troubleshooting](../examples/gutterpress-user-guide/07-system-setup.md)

**Use the CLI from a terminal or CI**
→ [CLI README](../packages/cli/README.md)

**Install the desktop app or CLI, verify a download, or check platform support**
→ [Installation and supported platforms](./installing.md)

**Develop on the desktop app or the lib**
→ [Architecture](ARCHITECTURE.md)

**My CSS looks right but nothing painted in the PDF**
→ [Known limitations](./known-limitations.md) — the browser-level gaps that fail silently

## Quick Reference

### Common Commands

```bash
# Build PDF
 gutterpress build ./my-book

# Preview with live reload
 gutterpress preview ./my-book

# Full validated print-ready PDF/X pipeline
 gutterpress build ./my-book --format pdfx

# Validate source files
 gutterpress validate --input ./my-book

# Validate a built PDF (dist/<title-slug>/<title-slug>-pdf.pdf)
 gutterpress validate --pdf dist/my-book/my-book-pdf.pdf
```

### Common Directives

```markdown
@page                       Start a new page
@page chapter               New page with chapter class
@page-break                 Force a page break
@continue                   Continue current @section with a matching new section box
@end-section                Close current @section
@spread                     Start a two-page spread
@section .gp-columns-2       Two-column layout (also .gp-columns-3)
```

### Common Callouts

> **Plugin required:** `> [!note]`-style GitHub alert syntax is **not** part
> of core Gutterpress — it lives in the separate, Dimm City plugin.
> Without that plugin configured, these print as literal blockquote text
> (`[!note] ...`). See [User Guide: Chapter 5 — Plugins](../examples/gutterpress-user-guide/05-plugins.md)
> to add it, or use `@section .callout-tip` … `@end-section` (a plain marker
> core always renders — see [User Guide: Chapter 8 — Publishing](../examples/gutterpress-user-guide/08-publishing.md))
> or a plain `>` blockquote for a core-only callout.

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
├── README.md                              # This file
├── ARCHITECTURE.md                        # Technical architecture (developers)
├── best-practices.md                      # Extended reference for best practices
├── contextual-cascade-principle.md        # ★ Recommended CSS architecture pattern
├── installing.md                           # Install channels, platform support, unsigned-app guidance
├── known-limitations.md                   # Silent Chromium print gaps (upstream-tracked)
├── SOURCE-FILES-GUIDE.md                  # Deep-dive into source.files configuration
├── migrations/                            # Migration guides
│   └── 2026-05-removing-container-syntax.md
├── docker.md                              # Running Gutterpress in Docker
├── publishing.md                          # Publishing built output to platforms
├── schema-autocomplete.md                 # manifest.yaml JSON Schema / editor autocomplete
├── design-guides.md                       # Companion design-guide projects
├── open-design/                           # Open Design workflow and plugin guides
├── desktop-shortcut.md                    # OS desktop shortcuts for the desktop app
├── reviews/                               # Point-in-time critical review reports
└── [remaining files are point-in-time audits/plans, kept for history — not
     part of the current documentation set]
```

All authoring documentation lives in the **[Gutterpress User Guide](../examples/gutterpress-user-guide/)** (in `examples/`). This directory contains developer/architect reference materials — some current (the files listed above), some historical audit/planning artifacts kept for the record.

## Contributing

Found an error or want to improve the documentation?

1. Submit an issue on GitHub
2. Create a pull request with corrections
3. Share your examples and use cases

## Additional Resources

- **Paged.js Documentation:** https://www.pagedjs.org/
- **Markdown Guide:** https://www.markdownguide.org/
- **CSS Paged Media:** https://www.w3.org/TR/css-page-3/
- **Print Design Principles:** Research professional book design
