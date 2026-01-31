# Print-md Authoring Guide

A comprehensive guide to creating beautiful print-ready documents from markdown using print-md.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Document Structure](#document-structure)
3. [Core Directives](#core-directives)
4. [Typography & Formatting](#typography--formatting)
5. [Page Control](#page-control)
6. [Callouts & Admonitions](#callouts--admonitions)
7. [Images & Artwork](#images--artwork)
8. [Advanced Features](#advanced-features)
9. [TTRPG Extensions](#ttrpg-extensions)
10. [Styling & Theming](#styling--theming)
11. [Best Practices](#best-practices)

---

## Getting Started

Print-md converts markdown files into professional print PDFs. It's designed for creating books, manuals, rulebooks, and any print-first documents. Uses Prince XML for PDF generation and Vivliostyle for live preview.

### Basic Workflow

```bash
# Build a PDF from markdown files
print-md build ./my-book

# Preview with live reload
print-md preview ./my-book

# Build with custom output name
print-md build ./my-book --output my-book.pdf
```

### Project Structure

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

---

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
format:
  size: "6in 9in"          # Digest size (default)
  margins:
    top: "0.75in"
    bottom: "0.75in"
    inner: "0.75in"        # Binding edge
    outer: "0.5in"         # Trim edge
  bleed: "0.125in"         # Print bleed zone

# Styling (CSS cascade)
styles:
  - "themes/classic.css"   # Bundled theme
  - "styles/custom.css"    # Your custom styles

# File ordering (optional - defaults to alphabetical)
files:
  - "01-introduction.md"
  - "02-mechanics.md"
  - "03-combat.md"

# Enable extensions (optional)
extensions:
  - "ttrpg"                # Stat blocks, dice notation, etc.
  - "dimm-city"            # District badges, roll prompts
```

### Page Format Options

Common book sizes:

```yaml
# Trade paperback
size: "6in 9in"

# Standard novel
size: "5.5in 8.5in"

# Large format
size: "8.5in 11in"

# A4
size: "210mm 297mm"

# A5
size: "148mm 210mm"
```

---

## Core Directives

Print-md provides powerful directives to control page layout and behavior. Directives are HTML comments that control print layout rendering.

### Page Templates

Apply named page templates to sections of your document:

```markdown
<!-- @page: chapter -->
# Chapter One: The Beginning

This content will use the chapter page template with extra top margin
and special header/footer treatment.

<!-- @page: body -->
Regular content continues here with standard body template.

<!-- @page: appendix -->
# Appendix A: Reference Tables

Back matter content uses appendix styling.
```

### Available Page Templates

- `chapter` - Chapter opening pages (right-hand, extra top margin, minimal headers)
- `body` - Standard body content (default)
- `art` - Full-bleed artwork (zero margins, no headers/footers)
- `appendix` - Back matter (appendix header in page margins)
- `frontmatter` - Front matter pages (title, credits, etc.)
- `cover` - Book cover (full bleed)
- `title-page` - Title page (centered, no page numbers)
- `credits` - Credits/copyright page (roman numerals)
- `toc` - Table of contents (roman numerals)
- `glossary` - Glossary/index (reduced margins for multi-column)
- `blank` - Blank pages (with "intentionally left blank" note)

### Page Breaks

Control when and where page breaks occur:

```markdown
<!-- @break -->
Content after this directive starts on a new page.

<!-- @spread: right -->
Forces the next content to start on a right-hand page (odd number).

<!-- @spread: left -->
Forces the next content to start on a left-hand page (even number).

<!-- @spread: blank -->
Inserts a blank page.
```

### Column Layouts

Set multi-column layouts for specific sections:

```markdown
<!-- @columns: 2 -->
This content will flow in a two-column layout, perfect for
glossaries, indexes, or dense reference material.

<!-- @columns: 1 -->
Back to single column layout.

<!-- @columns: 3 -->
Three columns for very dense content (use sparingly).
```

**Important:** Columns apply to subsequent content until changed by another `@columns` directive or reset by a chapter heading (H1).

---

## Typography & Formatting

### Headings

Print-md provides six heading levels with automatic styling:

```markdown
# H1 - Chapter Title (24pt, auto-starts on right page)

## H2 - Major Section (18pt)

### H3 - Subsection (14pt)

#### H4 - Minor Heading (12pt)

##### H5 - Small Heading (10.5pt)

###### H6 - Tiny Heading (9pt)
```

**Auto-rules:**
- H1 headings automatically start chapters on right-hand pages
- H1 sets the section title in page headers
- All headings respect widow/orphan control

### Emphasis & Formatting

```markdown
*Italic text* or _italic text_

**Bold text** or __bold text__

***Bold italic*** or ___bold italic___

`Inline code or monospace`

~~Strikethrough~~
```

### Lists

```markdown
Unordered list:
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

Ordered list:
1. First step
2. Second step
   1. Substep A
   2. Substep B
3. Third step
```

### Blockquotes

```markdown
> This is a blockquote.
> It can span multiple lines.
>
> And have multiple paragraphs.

> Nested blockquotes are also supported:
>
> > Inner quote
> > - With lists
> > - And formatting
```

### Tables

```markdown
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

Alignment:
| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |
| D    | E      | F     |
```

Tables automatically:
- Break across pages intelligently
- Repeat headers on new pages
- Apply striped row styling
- Use professional borders and spacing

---

## Page Control

### Automatic Page Breaks

Print-md provides automatic page breaks with simple markdown:

```markdown
# Chapter One

Content here...

---

This horizontal rule becomes a page break.
New content starts on the next page.
```

**Auto-rule:** Any horizontal rule (`---`, `***`, `___`) becomes a page break.

### Manual Page Breaks

For more control, use explicit directives:

```markdown
Some content here.

<!-- @break -->

This starts on a new page.
```

### Chapter Starts

```markdown
# Chapter Title

This H1 heading automatically:
- Starts on a right-hand (odd-numbered) page
- Adds extra top margin for dramatic impact
- Removes headers to let the chapter title stand alone
- Sets the section title for subsequent page headers
```

### Preventing Page Breaks

Use CSS classes to control breaking behavior:

```markdown
::: container
This content will try to stay together on one page
and avoid breaking across pages.
:::
```

Or in custom CSS:

```css
.keep-together {
  break-inside: avoid;
  page-break-inside: avoid;
}
```

---

## Callouts & Admonitions

Print-md supports five professional callout types for highlighting important information. These use GitHub-style syntax and are universally applicable to any document type.

### Callout Syntax

```markdown
> [!note]
> This is a note callout with the default "Note" title.
> It uses blue styling and a circle icon.

> [!note] Custom Title Here
> You can override the title by adding text after [!note].
> This is useful for context-specific callouts.

> [!tip]
> This is a tip callout (green) with helpful advice.
> Great for best practices and shortcuts.

> [!warning]
> This is a warning callout (orange/yellow).
> Use for important considerations or potential issues.

> [!danger]
> This is a danger callout (red).
> Use for critical warnings and things that will break.

> [!info]
> This is an info callout (gray).
> Use for neutral information and definitions.
```

### Callout Types

**Note** (Blue)
- Default title: "Note"
- Use for: General information, context, explanations
- Example: "Note: This section requires prior knowledge of..."

**Tip** (Green)
- Default title: "Tip"
- Use for: Helpful advice, best practices, shortcuts
- Example: "Tip: You can speed this up by..."

**Warning** (Orange)
- Default title: "Warning"
- Use for: Cautions, important considerations, potential issues
- Example: "Warning: This operation cannot be undone"

**Danger** (Red)
- Default title: "Danger"
- Use for: Critical warnings, errors, things that will break
- Example: "Danger: This will delete all your data"

**Info** (Gray)
- Default title: "Info"
- Use for: Neutral information, definitions, references
- Example: "Info: See Chapter 5 for more details"

### Multi-paragraph Callouts

```markdown
> [!warning] Read This Carefully
> This callout has multiple paragraphs.
>
> Each paragraph must be prefixed with `>` to stay in the blockquote.
>
> - You can include lists
> - And other formatting
> - Within callouts
>
> Even **bold**, *italic*, and `code` formatting works!
```

### Print Considerations

Callouts automatically:
- Avoid page breaks within the content (stay together)
- Use WCAG AA compliant color contrast (4.5:1 minimum)
- Work in both color and grayscale printing
- Use CSS-based icons (no emoji dependencies)
- Respect widow/orphan control

---

## Images & Artwork

### Basic Images

```markdown
![Alt text](assets/image.jpg)

![Image with caption](assets/diagram.png "This caption appears in the print")
```

### Image Sizing

Use the `img-size` plugin syntax for precise control:

```markdown
![Portrait](assets/portrait.jpg =300x400)

![Landscape](assets/landscape.jpg =800x)

![Square](assets/square.jpg =x600)
```

### Image Attributes

Use `markdown-it-attrs` syntax for advanced styling:

```markdown
![Centered image](assets/photo.jpg){.center}

![Floated left](assets/small.jpg){.float-left}

![Full width](assets/wide.jpg){.full-width}
```

### Full-Bleed Artwork

For images that fill an entire page:

```markdown
![Full bleed art](assets/artwork.jpg){.full-bleed}
```

**Auto-rule:** Images with `.full-bleed` class automatically:
- Get the `art` page template (zero margins)
- Force a page break before the image
- Extend to the bleed edge
- Remove headers and footers
- Cover the entire page

### Image Positioning

```markdown
<!-- Float image beside text -->
![](assets/portrait.jpg){.float-right width="200px"}

Lorem ipsum text flows around the floated image on the left side.
This is perfect for character portraits or small illustrations
that accompany text.

<!-- Clear floats -->
<div style="clear: both;"></div>

<!-- Centered image -->
![](assets/diagram.jpg){.center width="80%"}
```

### Print-Safe Images

Best practices for print images:

1. **Resolution:** 300 DPI minimum for print quality
2. **Format:** JPEG for photos, PNG for graphics with transparency
3. **Color space:** RGB (Prince XML handles CMYK conversion)
4. **Size:** Pre-size images to final dimensions to reduce PDF file size
5. **Bleed:** For full-bleed images, add 0.125in to all edges

---

## Advanced Features

### Markdown Attributes

Add CSS classes, IDs, and attributes to any element:

```markdown
# Heading {#custom-id .special-class}

Paragraph with custom styling {.highlight}

[Link](https://example.com){target="_blank" rel="noopener"}

![Image](photo.jpg){width="50%" .rounded}
```

### Anchors & Cross-References

```markdown
# Chapter One {#chapter-one}

Content here...

Later, reference the chapter: [See Chapter One](#chapter-one)
```

Auto-generated anchors are created for all headings, using slugified text.

### Custom Containers

Use container syntax for custom layouts:

```markdown
::: custom-class
This content gets wrapped in a div with class="custom-class".

You can then style it with CSS in your custom stylesheet.
:::
```

### HTML in Markdown

Print-md supports inline HTML when needed:

```markdown
<div class="custom-container">

This markdown content is inside a custom HTML container.

**Markdown still works** inside HTML blocks if separated by blank lines.

</div>

<span style="color: red;">Inline HTML</span> works too.
```


### Running Headers

Set custom running headers for page margins:

```markdown
<!-- H1 automatically sets section title -->
# Chapter Title

This sets the running header for subsequent pages.

<!-- Override with manual directive -->
<h1 style="string-set: section-title 'Custom Header';">Section</h1>
```

---

## TTRPG Extensions

When `ttrpg` extension is enabled in manifest, you get specialized markdown syntax for tabletop RPG content.

### Enable TTRPG Features

In `manifest.yaml`:

```yaml
extensions:
  - "ttrpg"
```

### Stat Blocks (Inline)

Quick inline stats for characters or monsters:

```markdown
The goblin {HP:12 AC:14 DMG:1d6+2} attacks!

Boss monster {HP:85 AC:18 DMG:2d8+5 STR:18 DEX:12}
```

Renders as styled stat display with labels and values.

### Dice Notation

Automatic dice formatting:

```markdown
Roll 2d6+3 for damage.

The dragon breathes fire for 10d10 damage!

Make a DC 15 check or take 3d8-2 damage.
```

Dice notation gets styled with:
- 🎲 icon
- Monospace font
- Interactive hover styling (in preview mode)
- Proper inline formatting

### Cross-References

Link to game elements:

```markdown
The @[shadowkin] appears from the darkness.

Check the @[ITEM:flickerblade] in the equipment section.

See @[NPC:investigator] for details.
```

Renders as formatted links with:
- Type-specific styling
- Auto-generated anchor links
- Hover tooltips

### Trait & Ability Callouts

Highlight special abilities inline:

```markdown
The creature has ::trait[Shadow Step] allowing it to teleport.

Its primary attack is ::ability[Umbral Strike].
```

Renders with:
- Icon indicators
- Colored highlighting
- Inline styling

### Challenge Ratings

Display difficulty ratings:

```markdown
CR:3 encounter ahead!

Boss fight: CR:12
```

Automatically styled with:
- Difficulty-based colors (easy/medium/hard/deadly)
- CR label formatting
- Consistent styling

---

## Dimm City Extensions

When `dimm-city` extension is enabled, you get specialized syntax for the Dimm City Operations Manual.

### Enable Dimm City Features

```yaml
extensions:
  - "dimm-city"
```

### District Badges

Reference districts with hashtag syntax:

```markdown
The #TechD is known for innovation.

Venture into #Dark at your own risk.

Other districts: #EntD, #CommD, #MarketD, #ArcD
```

Renders as styled badges with:
- District-specific colors
- Uppercase formatting
- Hover tooltips with full district names

### Roll Prompts

Emphasize die roll moments:

```markdown
When you face the guardian, ROLL A DIE!

The outcome is uncertain. ROLL THE DIE to find out.
```

Automatically styled with:
- 🎲 dice icon
- Bold, uppercase text
- Decorative borders
- Centered alignment

### Dimm City Containers

Dimm City includes specialized containers:

```markdown
::: specialty
Special content block
:::

::: learning-path
Step-by-step progression
:::

::: ability
Game ability description
:::

::: item
Equipment or item details
:::
```

---

## Styling & Theming

### Built-in Themes

Print-md includes professional themes you can use:

```yaml
# manifest.yaml
styles:
  - "themes/classic.css"    # Warm cream, burgundy (default)
  - "themes/modern.css"      # Clean white, blue accents
  - "themes/dark.css"        # Dark backgrounds, light text
  - "themes/parchment.css"   # Aged paper texture
  - "themes/dimm-city.css"   # Cyberpunk aesthetic
  - "themes/zine.css"        # Bold, DIY aesthetic
  - "themes/bw.css"          # Pure black & white
```

### CSS Variables

Customize the design system with CSS variables:

```css
/* custom.css */
:root {
  /* Page dimensions */
  --doc-width: 6in;
  --doc-height: 9in;

  /* Margins */
  --margin-top: 0.75in;
  --margin-bottom: 0.75in;
  --margin-inner: 0.75in;
  --margin-outer: 0.5in;

  /* Typography */
  --font-body: "Crimson Text", serif;
  --font-heading: "Libre Baskerville", serif;
  --font-display: "Cinzel", serif;
  --font-ui: "Inter", sans-serif;
  --font-mono: "Courier Prime", monospace;

  --font-size-base: 10.5pt;
  --line-height-base: 1.45;

  /* Colors */
  --color-ink: #2a2420;
  --color-paper: #fefdfb;
  --color-accent-primary: #8c3f5d;
  --color-accent-secondary: #3a6ea5;

  /* Spacing */
  --spacing-sm: 8pt;
  --spacing-md: 16pt;
  --spacing-lg: 24pt;
}
```

### Custom Page Templates

Create custom page templates:

```css
/* custom.css */
@page custom-template {
  margin: 1in;

  @top-center {
    content: "Custom Header";
    font-family: var(--font-ui);
    font-size: 9pt;
  }

  @bottom-center {
    content: counter(page);
  }
}

/* Apply to elements */
.custom-section {
  page: custom-template;
  break-before: page;
}
```

### Custom Component Styles

Override built-in components:

```css
/* custom.css */

/* Customize callouts */
.callout-note {
  --callout-bg: #e8f4f8;
  --callout-border: #0066cc;
}

/* Customize headings */
h1 {
  font-family: "Your Custom Font", serif;
  color: #custom-color;
  border-bottom: 2pt solid currentColor;
  padding-bottom: 0.5em;
}

/* Customize tables */
table {
  width: 100%;
  border-collapse: collapse;
}

th {
  background: #333;
  color: white;
  padding: 8pt;
}

td {
  padding: 6pt;
  border-bottom: 0.5pt solid #ccc;
}
```

### Disabling Default Styles

For complete control, disable default styles:

```yaml
# manifest.yaml
disableDefaultStyles: true

styles:
  - "styles/my-complete-stylesheet.css"
```

**Warning:** You must provide ALL necessary CSS including:
- Page setup and margins
- Typography and font loading
- Layout and positioning
- Component styles
- Print optimization

---

## Best Practices

### File Organization

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

### Writing Guidelines

**Headings:**
- Use H1 for chapter titles only (one per file)
- Use H2-H3 for main sections
- Use H4-H6 sparingly
- Keep headings concise (under 60 characters)

**Paragraphs:**
- One idea per paragraph
- Break up long paragraphs (6-8 sentences max)
- Use blank lines between paragraphs

**Lists:**
- Use ordered lists for sequential steps
- Use unordered lists for non-ordered items
- Keep list items concise
- Use nested lists sparingly (2 levels max)

**Tables:**
- Keep tables simple (5-7 columns max)
- Use descriptive headers
- Align numbers right, text left
- Consider rotating wide tables to landscape

### Print Optimization

**Page Breaks:**
- Avoid manual breaks unless necessary
- Let auto-rules handle chapter starts
- Use directives for special cases only
- Test with preview mode before final PDF

**Images:**
- 300 DPI minimum resolution
- Pre-size images to print dimensions
- Use JPEG for photos, PNG for graphics
- Add 0.125in bleed for full-page images
- Test grayscale conversion for black & white printing

**Typography:**
- Don't override widow/orphan control
- Maintain consistent line height
- Use proper spacing (avoid manual line breaks)
- Test font embedding in final PDF

**Color:**
- Test in grayscale mode
- Ensure sufficient contrast (4.5:1 minimum)
- Avoid pure black (#000) - use dark gray
- Avoid pure white (#fff) - use off-white
- Test CMYK conversion if offset printing

### Performance Tips

**Build Speed:**
- Keep images reasonably sized (< 2MB each)
- Use CSS imports for modularity
- Enable watch mode for development
- Use preview mode for rapid iteration

**PDF Size:**
- Compress images before adding
- Embed only used font subsets
- Remove unused CSS rules
- Optimize for web if distributing digitally

### Testing Checklist

Before final print:

- [ ] Preview entire document in browser
- [ ] Check all page breaks and spreads
- [ ] Verify all images appear correctly
- [ ] Test all internal links work
- [ ] Review table of contents (if auto-generated)
- [ ] Check running headers on all pages
- [ ] Verify page numbers are correct
- [ ] Test callouts don't break awkwardly
- [ ] Review first/last lines of pages (widows/orphans)
- [ ] Check bleed on full-page images
- [ ] Print test pages on target paper
- [ ] Review grayscale conversion
- [ ] Verify font embedding in PDF
- [ ] Check file size is reasonable

---

## Quick Reference

### Common Directives

```markdown
<!-- @page: template -->    Apply named page template
<!-- @break -->             Force page break
<!-- @spread: right -->     Start on right page
<!-- @spread: left -->      Start on left page
<!-- @spread: blank -->     Insert blank page
<!-- @columns: 2 -->        Set column layout
```

### Common Callouts

```markdown
> [!note]     Blue circle, general info
> [!tip]      Green lightbulb, helpful advice
> [!warning]  Orange triangle, cautions
> [!danger]   Red octagon, critical warnings
> [!info]     Gray square, neutral info
```

### Common Attributes

```markdown
{.class}                    Add CSS class
{#id}                       Add ID
{.class #id}                Multiple attributes
{width="50%"}               Inline style
{.float-left .rounded}      Multiple classes
```

### Page Templates

```
chapter        - Chapter opening (right page, extra margin)
body           - Standard content (default)
art            - Full-bleed artwork (no margins)
appendix       - Back matter
frontmatter    - Front matter (title, credits)
cover          - Book cover
title-page     - Title page
credits        - Copyright page
toc            - Table of contents
glossary       - Index/glossary (narrow margins)
blank          - Blank page
```

---

## Additional Resources

- **Prince XML Documentation:** https://www.princexml.com/doc/
- **Vivliostyle Documentation:** https://docs.vivliostyle.org/
- **Markdown Guide:** https://www.markdownguide.org/
- **Print Design Best Practices:** Research book design principles
- **CSS Paged Media:** https://www.w3.org/TR/css-page-3/

For more examples, see the `/examples` directory in the print-md repository.

---

**Version:** 1.0
**Last Updated:** 2025-11-07
