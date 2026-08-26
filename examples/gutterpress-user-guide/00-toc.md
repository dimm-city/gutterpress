@page toc #ch-toc

# Table of Contents

@section .lede

Eight chapters take you from first install to published, production-ready print PDFs.

@end-section

1. [Getting Started](#ch-getting-started) — Install, basic workflow, project structure, manifest configuration
2. [Writing Your Content](#ch-writing) — Typography, text formatting, lists, tables, layout directives
3. [Visual Elements](#ch-visual) — Callouts, images, full-bleed artwork, positioning, print-safe formats
4. [Styling & Theming](#ch-styling) — CSS variables, custom themes, fonts, page templates, cascade order
5. [Plugins](#ch-plugins) — Adding, installing, writing, and loading order for markdown-it plugins
6. [Validation & Best Practices](#ch-validation) — 34 print checks, CLI usage, file organization, production workflow
7. [System Setup](#ch-system) — Required external tools, per-platform install, troubleshooting
8. [Publishing](#ch-publishing) — Sending your finished book to itch.io, DriveThruRPG, Amazon KDP, Azure, or Shopify

---

## How to use this guide

This guide is itself a Gutterpress project. Every code block, callout, and layout you see here was produced by the same commands described in each chapter. Open `examples/gutterpress-user-guide/` alongside the text to see the source that produced each page.

### Quick start commands

```bash
# Preview this guide with live reload
gutterpress preview examples/gutterpress-user-guide

# Build a PDF
gutterpress build examples/gutterpress-user-guide

# Build a print-ready PDF/X
gutterpress build examples/gutterpress-user-guide --format pdfx
```
