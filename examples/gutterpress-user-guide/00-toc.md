@page toc #ch-toc

# Table of Contents

<div class="lede">Nine chapters take you from first install to published, production-ready print PDFs.</div>

<ol>
<li><a href="#ch-getting-started">Getting Started</a> — Install, basic workflow, project structure, manifest configuration</li>
<li><a href="#ch-writing">Writing Your Content</a> — Typography, text formatting, lists, tables, layout directives</li>
<li><a href="#ch-visual">Visual Elements</a> — Callouts, images, full-bleed artwork, positioning, print-safe formats</li>
<li><a href="#ch-styling">Styling & Theming</a> — CSS variables, custom themes, fonts, page templates, cascade order</li>
<li><a href="#ch-ttrpg">TTRPG Extensions</a> — Stat blocks, dice notation, cross-references, trait callouts, challenge ratings</li>
<li><a href="#ch-plugins">Plugins</a> — Adding, installing, writing, and loading order for markdown-it plugins</li>
<li><a href="#ch-validation">Validation & Best Practices</a> — 33 print checks, CLI usage, file organization, production workflow</li>
<li><a href="#ch-system">System Setup</a> — Required external tools, per-platform install, troubleshooting</li>
<li><a href="#ch-publishing">Publishing</a> — Sending your finished book to itch.io, DriveThruRPG, Amazon KDP, Azure, or Shopify</li>
</ol>

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
