# Theme Customization Guide

This guide covers everything you need to know about customizing the appearance of your print-md documents using CSS.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Built-in Themes](#built-in-themes)
3. [CSS Cascade](#css-cascade)
4. [CSS Variables](#css-variables)
5. [Typography](#typography)
6. [Page Layout](#page-layout)
7. [Headers & Footers](#headers--footers)
8. [Images & Figures](#images--figures)
9. [Tables](#tables)
10. [Code Blocks](#code-blocks)
11. [Custom Components](#custom-components)
12. [Print-Specific CSS](#print-specific-css)
13. [Examples](#examples)

---

## Quick Start

### Using a Built-in Theme

```yaml
# manifest.yaml
styles:
  - "themes/classic.css"
```

### Adding Custom CSS

```yaml
# manifest.yaml
styles:
  - "themes/classic.css"   # Base theme
  - "custom.css"            # Your customizations
```

Create `custom.css`:

```css
/* Override the primary color */
:root {
  --color-primary: #2c3e50;
}

/* Customize headings */
h1 {
  color: var(--color-primary);
  font-size: 28pt;
}
```

### Starting from Scratch

```yaml
# manifest.yaml
disableDefaultStyles: true   # Disable foundation CSS
styles:
  - "my-theme.css"           # Your complete theme
```

---

## Built-in Themes

print-md includes 4 professionally-designed themes:

### Classic Theme

Traditional book typography with serif fonts:

```yaml
styles:
  - "themes/classic.css"
```

**Features:**
- Georgia serif font for body
- Traditional margins and spacing
- Classic chapter headings
- Page numbers in footer
- Running headers

### Modern Theme

Clean, minimal design with sans-serif fonts:

```yaml
styles:
  - "themes/modern.css"
```

**Features:**
- Helvetica/Arial sans-serif fonts
- Generous white space
- Bold, simple headings
- Minimal ornamentation

### Dark Theme

Dark mode for screen reading:

```yaml
styles:
  - "themes/dark.css"
```

**Features:**
- Dark background (#1e1e1e)
- Light text (#e0e0e0)
- Reduced eye strain
- High contrast

**Note:** Not recommended for print output.

### Parchment Theme

Aged paper aesthetic:

```yaml
styles:
  - "themes/parchment.css"
```

**Features:**
- Beige parchment background
- Old-style serif fonts
- Decorative elements
- Medieval manuscript feel

---

## CSS Cascade

Understanding how CSS is applied:

### 1. Foundation CSS (Default)

Unless `disableDefaultStyles: true`, print-md includes:

- **Variables** - CSS custom properties for colors, fonts, spacing
- **Typography** - Base font styles, line heights, headings
- **Layout** - Page structure, margins, padding
- **Components** - Tables, code blocks, images, blockquotes
- **Book Reset** - Print-specific resets

### 2. Theme CSS

Themes from `styles` array are applied in order:

```yaml
styles:
  - "themes/classic.css"   # Applied first
  - "themes/modern.css"    # Overrides classic
```

### 3. Custom CSS

Your CSS files are applied last (highest priority):

```yaml
styles:
  - "themes/classic.css"
  - "custom.css"           # Overrides everything above
```

### Complete Override

Replace all default styles:

```yaml
disableDefaultStyles: true
styles:
  - "my-complete-theme.css"
```

---

## CSS Variables

print-md uses CSS custom properties for easy customization.

### Color Variables

```css
:root {
  /* Primary colors */
  --color-primary: #2c3e50;
  --color-secondary: #7f8c8d;

  /* Text colors */
  --color-text: #2c3e50;
  --color-text-light: #7f8c8d;
  --color-background: #ffffff;

  /* Accent colors */
  --color-accent: #3498db;
  --color-warning: #f39c12;
  --color-danger: #e74c3c;
  --color-success: #27ae60;

  /* Code colors */
  --color-code-bg: #f8f9fa;
  --color-code-text: #e83e8c;
}
```

### Typography Variables

```css
:root {
  /* Font families */
  --font-body: "Georgia", serif;
  --font-heading: "Helvetica", sans-serif;
  --font-code: "Courier New", monospace;

  /* Font sizes */
  --font-size-base: 11pt;
  --font-size-small: 9pt;
  --font-size-large: 13pt;

  --font-size-h1: 24pt;
  --font-size-h2: 20pt;
  --font-size-h3: 16pt;
  --font-size-h4: 14pt;
  --font-size-h5: 12pt;
  --font-size-h6: 11pt;

  /* Line heights */
  --line-height-base: 1.6;
  --line-height-heading: 1.2;
  --line-height-code: 1.4;

  /* Font weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-bold: 700;
}
```

### Spacing Variables

```css
:root {
  /* Base spacing unit */
  --spacing-unit: 1em;

  /* Common spacing values */
  --spacing-xs: calc(var(--spacing-unit) * 0.25);  /* 0.25em */
  --spacing-sm: calc(var(--spacing-unit) * 0.5);   /* 0.5em */
  --spacing-md: var(--spacing-unit);               /* 1em */
  --spacing-lg: calc(var(--spacing-unit) * 1.5);   /* 1.5em */
  --spacing-xl: calc(var(--spacing-unit) * 2);     /* 2em */
  --spacing-xxl: calc(var(--spacing-unit) * 3);    /* 3em */

  /* Page margins */
  --margin-top: 1in;
  --margin-bottom: 1in;
  --margin-left: 1in;
  --margin-right: 1in;
}
```

### Using Variables

```css
/* Override existing variables */
:root {
  --color-primary: #e74c3c;        /* Red primary color */
  --font-body: "Palatino", serif;  /* Different body font */
  --font-size-base: 12pt;          /* Larger base font */
}

/* Use variables in your styles */
h1 {
  color: var(--color-primary);
  font-family: var(--font-heading);
  font-size: var(--font-size-h1);
  margin-bottom: var(--spacing-lg);
}
```

---

## Typography

### Body Text

```css
body {
  font-family: "Georgia", serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #2c3e50;
  text-align: justify;
  hyphens: auto;
}
```

### Headings

```css
h1, h2, h3, h4, h5, h6 {
  font-family: "Helvetica", sans-serif;
  font-weight: 700;
  line-height: 1.2;
  color: #2c3e50;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

h1 {
  font-size: 24pt;
  break-before: page;  /* New page for chapters */
}

h2 {
  font-size: 20pt;
}

h3 {
  font-size: 16pt;
}
```

### Paragraphs

```css
p {
  margin-top: 0;
  margin-bottom: 1em;
  orphans: 3;          /* Minimum 3 lines at bottom of page */
  widows: 3;           /* Minimum 3 lines at top of page */
}

/* First paragraph after heading - no indent */
h1 + p,
h2 + p,
h3 + p {
  text-indent: 0;
}

/* Subsequent paragraphs - indent */
p + p {
  text-indent: 1.5em;
  margin-top: 0;
}
```

### Drop Caps

```css
/* First paragraph of chapter */
h1 + p::first-letter {
  float: left;
  font-size: 3.5em;
  line-height: 0.8;
  margin: 0.1em 0.1em 0 0;
  font-weight: bold;
}
```

### Pull Quotes

```css
.pullquote {
  font-size: 14pt;
  font-style: italic;
  color: #7f8c8d;
  border-left: 4px solid #3498db;
  padding-left: 1em;
  margin: 1.5em 0 1.5em 2em;
}
```

---

## Page Layout

### Page Size & Margins

```css
@page {
  size: letter;              /* or a4, a5, legal */
  margin: 1in 0.75in;        /* top/bottom left/right */
}

/* Or specify all margins */
@page {
  size: 8.5in 11in;
  margin-top: 1in;
  margin-bottom: 1in;
  margin-left: 1.25in;
  margin-right: 1.25in;
}
```

### Two-Sided Layout

```css
/* Left pages (even) */
@page :left {
  margin-left: 1.5in;   /* Wider inside margin */
  margin-right: 0.75in; /* Narrower outside margin */
}

/* Right pages (odd) */
@page :right {
  margin-left: 0.75in;  /* Narrower outside margin */
  margin-right: 1.5in;  /* Wider inside margin */
}
```

### First Page

```css
@page :first {
  margin-top: 0;
  margin-bottom: 0;
}

/* Or create named page */
@page cover {
  margin: 0;
}

/* Apply to element */
.cover-page {
  page: cover;
}
```

### Bleed for Printing

```css
@page {
  size: letter;
  bleed: 0.125in;       /* Standard print bleed */
  marks: crop cross;    /* Crop marks */
}
```

### Named Pages

```css
/* Define named pages */
@page chapter {
  @top-center {
    content: string(chapter-title);
  }
}

@page appendix {
  @top-center {
    content: "Appendix";
  }
}

/* Apply to elements */
h1.chapter {
  page: chapter;
  string-set: chapter-title content();
}

h1.appendix {
  page: appendix;
}
```

---

## Headers & Footers

### Running Headers

```css
/* Set string variable from h1 */
h1 {
  string-set: chapter content();
}

/* Display in header */
@page {
  @top-center {
    content: string(chapter);
    font-size: 10pt;
    font-style: italic;
    color: #7f8c8d;
  }
}
```

### Page Numbers

```css
/* Simple page number in footer */
@page {
  @bottom-center {
    content: counter(page);
  }
}

/* Page number with total pages */
@page {
  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
  }
}

/* Different position for left/right pages */
@page :left {
  @bottom-left {
    content: counter(page);
  }
}

@page :right {
  @bottom-right {
    content: counter(page);
  }
}
```

### Complex Headers

```css
/* Left page header: page number | chapter */
@page :left {
  @top-left {
    content: counter(page);
  }
  @top-center {
    content: string(chapter);
  }
}

/* Right page header: section | page number */
@page :right {
  @top-center {
    content: string(section);
  }
  @top-right {
    content: counter(page);
  }
}

/* Set string variables */
h1 {
  string-set: chapter content();
}

h2 {
  string-set: section content();
}
```

### No Header on First Page

```css
@page :first {
  @top-center {
    content: none;
  }
  @bottom-center {
    content: none;
  }
}
```

---

## Images & Figures

### Basic Image Styling

```css
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}
```

### Figures with Captions

```css
figure {
  margin: 1.5em 0;
  break-inside: avoid;  /* Don't split across pages */
}

figure img {
  width: 100%;
  display: block;
}

figcaption {
  font-size: 9pt;
  font-style: italic;
  text-align: center;
  margin-top: 0.5em;
  color: #7f8c8d;
}

/* Caption numbering */
figure {
  counter-increment: figure;
}

figcaption::before {
  content: "Figure " counter(figure) ": ";
  font-weight: bold;
}
```

### Full-Width Images

```css
.full-width {
  width: 100%;
  max-width: 100%;
}
```

### Full-Bleed Images

```css
.full-bleed {
  width: calc(100% + var(--margin-left) + var(--margin-right));
  margin-left: calc(-1 * var(--margin-left));
  margin-right: calc(-1 * var(--margin-right));
  max-width: none;
}
```

### Floating Images

```css
.float-left {
  float: left;
  margin: 0 1em 1em 0;
  max-width: 45%;
}

.float-right {
  float: right;
  margin: 0 0 1em 1em;
  max-width: 45%;
}
```

### Image Borders & Shadows

```css
.bordered {
  border: 1px solid #ddd;
  padding: 0.5em;
}

.shadowed {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
```

---

## Tables

### Basic Table Styling

```css
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
  break-inside: avoid;  /* Don't split across pages */
  font-size: 10pt;
}

th {
  background-color: #f8f9fa;
  font-weight: bold;
  text-align: left;
  padding: 0.5em;
  border-bottom: 2px solid #2c3e50;
}

td {
  padding: 0.5em;
  border-bottom: 1px solid #ddd;
}

/* Zebra striping */
tr:nth-child(even) {
  background-color: #f8f9fa;
}
```

### Compact Tables

```css
.compact table {
  font-size: 9pt;
}

.compact td,
.compact th {
  padding: 0.25em 0.5em;
}
```

### Full-Width Tables

```css
.full-width table {
  width: 100%;
}
```

### Table Captions

```css
caption {
  caption-side: top;
  font-size: 10pt;
  font-weight: bold;
  text-align: left;
  margin-bottom: 0.5em;
  color: #2c3e50;
}

/* Caption numbering */
table {
  counter-increment: table;
}

caption::before {
  content: "Table " counter(table) ": ";
}
```

---

## Code Blocks

### Inline Code

```css
code {
  font-family: "Courier New", monospace;
  font-size: 10pt;
  background-color: #f8f9fa;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  color: #e83e8c;
}
```

### Code Blocks

```css
pre {
  background-color: #f8f9fa;
  border-left: 4px solid #3498db;
  padding: 1em;
  overflow-x: auto;
  margin: 1.5em 0;
  border-radius: 3px;
  break-inside: avoid;
}

pre code {
  background-color: transparent;
  padding: 0;
  color: #2c3e50;
  font-size: 9pt;
  line-height: 1.4;
}
```

### Syntax Highlighting

If using a syntax highlighter, style the classes:

```css
.hljs-keyword {
  color: #8959a8;
  font-weight: bold;
}

.hljs-string {
  color: #718c00;
}

.hljs-comment {
  color: #8e908c;
  font-style: italic;
}

.hljs-number {
  color: #f5871f;
}
```

---

## Custom Components

### Callout Boxes

```css
.callout {
  background-color: #f8f9fa;
  border-left: 4px solid #3498db;
  padding: 1em;
  margin: 1.5em 0;
  break-inside: avoid;
}

.callout-warning {
  border-left-color: #f39c12;
  background-color: #fef9e7;
}

.callout-danger {
  border-left-color: #e74c3c;
  background-color: #fadbd8;
}

.callout-success {
  border-left-color: #27ae60;
  background-color: #d5f4e6;
}
```

### Sidebars

```css
.sidebar {
  float: right;
  width: 40%;
  margin: 0 0 1em 1em;
  padding: 1em;
  background-color: #f8f9fa;
  border: 1px solid #ddd;
}

.sidebar h3 {
  margin-top: 0;
  font-size: 12pt;
}
```

### Blockquotes

```css
blockquote {
  margin: 1.5em 2em;
  padding-left: 1em;
  border-left: 4px solid #3498db;
  font-style: italic;
  color: #7f8c8d;
}

blockquote p {
  margin: 0.5em 0;
}

blockquote cite {
  display: block;
  text-align: right;
  font-size: 10pt;
  margin-top: 0.5em;
}

blockquote cite::before {
  content: "— ";
}
```

---

## Print-Specific CSS

### Preventing Breaks

```css
/* Don't break headings from following content */
h1, h2, h3, h4, h5, h6 {
  break-after: avoid;
}

/* Don't break these elements */
table, figure, pre, blockquote {
  break-inside: avoid;
}
```

### Orphans & Widows

```css
p {
  orphans: 3;   /* Min lines at bottom of page */
  widows: 3;    /* Min lines at top of page */
}
```

### Page Breaks

```css
/* Always break before h1 */
h1 {
  break-before: page;
}

/* Avoid breaking after h2 */
h2 {
  break-after: avoid;
}

/* Force page break */
.page-break {
  break-after: page;
}
```

### Print vs Screen

```css
/* Screen only */
@media screen {
  body {
    background-color: #f0f0f0;
    max-width: 8.5in;
    margin: 2em auto;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  }
}

/* Print only */
@media print {
  a {
    color: #2c3e50;
    text-decoration: none;
  }

  a[href]::after {
    content: " (" attr(href) ")";
    font-size: 9pt;
    color: #7f8c8d;
  }
}
```

---

## Examples

### Complete Theme Example

```css
/* ============================================
   CUSTOM THEME: Technical Documentation
   ============================================ */

/* CSS Variables */
:root {
  --color-primary: #2c3e50;
  --color-accent: #3498db;
  --color-text: #2c3e50;
  --color-text-light: #7f8c8d;

  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-heading: inherit;
  --font-code: "Courier New", monospace;

  --font-size-base: 11pt;
  --line-height-base: 1.6;
}

/* Page Setup */
@page {
  size: letter;
  margin: 1in 0.75in;
}

@page :left {
  @bottom-left {
    content: counter(page);
    font-size: 10pt;
    color: var(--color-text-light);
  }
}

@page :right {
  @top-center {
    content: string(chapter);
    font-size: 10pt;
    font-style: italic;
    color: var(--color-text-light);
  }
  @bottom-right {
    content: counter(page);
    font-size: 10pt;
    color: var(--color-text-light);
  }
}

/* Typography */
body {
  font-family: var(--font-body);
  font-size: var(--font-size-base);
  line-height: var(--line-height-base);
  color: var(--color-text);
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  font-weight: 700;
  color: var(--color-primary);
  break-after: avoid;
}

h1 {
  font-size: 24pt;
  break-before: page;
  string-set: chapter content();
  border-bottom: 2px solid var(--color-accent);
  padding-bottom: 0.5em;
}

h2 {
  font-size: 18pt;
  margin-top: 2em;
}

h3 {
  font-size: 14pt;
  margin-top: 1.5em;
}

/* Code */
code {
  font-family: var(--font-code);
  background-color: #f8f9fa;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 10pt;
}

pre {
  background-color: #f8f9fa;
  border-left: 4px solid var(--color-accent);
  padding: 1em;
  overflow-x: auto;
  break-inside: avoid;
}

pre code {
  background-color: transparent;
  padding: 0;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
  break-inside: avoid;
  font-size: 10pt;
}

th {
  background-color: var(--color-primary);
  color: white;
  text-align: left;
  padding: 0.5em;
}

td {
  padding: 0.5em;
  border-bottom: 1px solid #ddd;
}

/* Components */
.note {
  background-color: #e3f2fd;
  border-left: 4px solid #2196f3;
  padding: 1em;
  margin: 1.5em 0;
  break-inside: avoid;
}

.warning {
  background-color: #fff3e0;
  border-left: 4px solid #ff9800;
  padding: 1em;
  margin: 1.5em 0;
  break-inside: avoid;
}
```

### Two-Column Layout Example

```css
/* Two-column section */
.two-column {
  column-count: 2;
  column-gap: 1.5em;
  column-rule: 1px solid #ddd;
}

/* Keep these elements in one column */
.two-column h2,
.two-column h3,
.two-column figure,
.two-column table {
  column-span: all;
}
```

### Magazine-Style Layout

```css
/* Larger margins for annotations */
@page {
  margin: 0.75in 2in 0.75in 0.75in;  /* Wide right margin */
}

/* Sidenotes in margin */
.sidenote {
  float: right;
  width: 1.5in;
  margin-right: -1.75in;
  font-size: 9pt;
  line-height: 1.3;
}
```

---

## Tips & Best Practices

### Testing Your Theme

1. **Use Preview Mode** - See changes instantly
   ```bash
   print-md preview --watch
   ```

2. **Build PDF Frequently** - Preview mode approximates, PDF is final
   ```bash
   print-md build
   ```

3. **Test Different Content** - Long pages, images, tables, code blocks

4. **Check Page Breaks** - Ensure headings aren't orphaned

### Common Pitfalls

**Don't:**
- Use `!important` (breaks cascade)
- Set absolute positions (breaks pagination)
- Use viewport units (not supported in print)
- Forget `break-inside: avoid` on important elements

**Do:**
- Use CSS variables for easy changes
- Test with realistic content
- Keep specificity low
- Use relative units (em, pt, %)

### Performance

- **Minimize CSS** - Remove unused rules
- **Avoid Complex Selectors** - Simple selectors are faster
- **Use Variables** - Easier to maintain
- **@import Sparingly** - Increases build time

### Debugging

```css
/* Show page boundaries */
@page {
  border: 1px solid red;
}

/* Show element boxes */
* {
  outline: 1px solid rgba(255, 0, 0, 0.2);
}

/* Show break points */
h1, h2, h3 {
  background-color: rgba(255, 255, 0, 0.2);
}
```

---

## Resources

- **[Prince XML Documentation](https://www.princexml.com/doc/)** - PDF typesetter guide
- **[Vivliostyle Documentation](https://docs.vivliostyle.org/)** - Preview engine guide
- **[CSS Paged Media](https://www.w3.org/TR/css-page-3/)** - W3C specification
- **[Print CSS Guide](https://www.smashingmagazine.com/2015/01/designing-for-print-with-css/)** - Smashing Magazine
- **[User Guide](./user-guide.md)** - print-md usage guide

---

**Questions or issues?** [Open an issue on GitHub](https://github.com/dimm-city/print-md/issues)

**Want to contribute?** See [CONTRIBUTING.md](../CONTRIBUTING.md)
