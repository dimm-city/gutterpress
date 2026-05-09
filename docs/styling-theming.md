# Styling & Theming

Comprehensive guide to customizing the visual design of your documents.

## Built-in Themes

Print-md does not bundle pre-built themes. Theme files are project-local CSS files that you create yourself or source from the community. Below are examples of themes you might create and reference in your manifest:

```yaml
# manifest.yaml
styles:
  - "themes/classic.css"    # Warm cream, burgundy
  - "themes/modern.css"      # Clean white, blue accents
  - "themes/dark.css"        # Dark backgrounds, light text
  - "themes/parchment.css"   # Aged paper texture
  - "themes/dimm-city.css"   # Cyberpunk aesthetic
  - "themes/zine.css"        # Bold, DIY aesthetic
  - "themes/bw.css"          # Pure black & white
```

> **Note:** These theme files are not included with print-md. You must create them in your project's directory (or obtain them from the community) and reference them via the `styles:` array in your manifest.

### Theme Descriptions

**Classic** (Default)
- Warm cream paper (#fefdfb)
- Dark brown ink (#2a2420)
- Burgundy accents (#8c3f5d)
- Traditional serif fonts
- Use for: Fantasy RPGs, classic books

**Modern**
- Clean white backgrounds
- Blue accent colors
- Sans-serif typography
- Use for: Technical docs, modern guides

**Dark**
- Dark backgrounds
- Light text
- High contrast
- Use for: Screen reading, digital-first

**Parchment**
- Aged paper texture
- Warm sepia tones
- Distressed aesthetic
- Use for: Historical, vintage themes

**Dimm City**
- Cyberpunk aesthetic
- Neon accents
- Futuristic typography
- Use for: Sci-fi, cyberpunk games

**Zine**
- Bold, high contrast
- DIY aesthetic
- Punk/indie vibes
- Use for: Alternative, indie content

**Black & White**
- Pure black on white
- Maximum contrast
- Minimal styling
- Use for: Cost-effective printing

## CSS Variables

Customize the design system with CSS variables:

### Page Dimensions

```css
:root {
  /* Page size */
  --doc-width: 6in;
  --doc-height: 9in;

  /* Margins */
  --margin-top: 0.75in;
  --margin-bottom: 0.75in;
  --margin-inner: 0.75in;    /* Binding edge */
  --margin-outer: 0.5in;     /* Trim edge */
  --margin-bleed: 0.125in;
}
```

### Typography

```css
:root {
  /* Font families */
  --font-body: "Crimson Text", serif;
  --font-heading: "Libre Baskerville", serif;
  --font-display: "Cinzel", serif;
  --font-ui: "Inter", sans-serif;
  --font-mono: "Courier Prime", monospace;

  /* Font sizes */
  --font-size-base: 10.5pt;
  --font-size-sm: 9pt;
  --font-size-lg: 12pt;
  --font-size-h1: 24pt;
  --font-size-h2: 18pt;
  --font-size-h3: 14pt;

  /* Line heights */
  --line-height-base: 1.45;
  --line-height-tight: 1.2;
  --line-height-relaxed: 1.6;

  /* Font weights */
  --font-weight-normal: 400;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

### Colors

```css
:root {
  /* Base colors */
  --color-ink: #2a2420;
  --color-paper: #fefdfb;
  --color-accent-primary: #8c3f5d;
  --color-accent-secondary: #3a6ea5;

  /* Semantic colors */
  --color-text: var(--color-ink);
  --color-text-muted: #6b6860;
  --color-background: var(--color-paper);
  --color-border: #d4cfc5;
}
```

### Spacing

```css
:root {
  /* Baseline grid */
  --baseline: 8pt;

  /* Spacing scale */
  --spacing-xs: 4pt;
  --spacing-sm: 8pt;
  --spacing-md: 16pt;
  --spacing-lg: 24pt;
  --spacing-xl: 32pt;
}
```

## Custom Styling

### Creating a Custom Theme

Create `styles/custom.css`:

```css
/* custom.css */

/* Override variables */
:root {
  /* Use your brand colors */
  --color-accent-primary: #your-color;

  /* Use your fonts */
  --font-body: "Your Font", serif;
}

/* Custom heading styles */
h1 {
  font-family: "Your Display Font", serif;
  color: var(--color-accent-primary);
  border-bottom: 2pt solid currentColor;
  padding-bottom: 0.5em;
}

/* Custom callout colors */
.callout-note {
  --callout-bg: #your-bg-color;
  --callout-border: #your-border-color;
}
```

Then reference in manifest:

```yaml
styles:
  - "themes/classic.css"      # Base theme
  - "styles/custom.css"       # Your overrides
```

## Custom Page Templates

Create custom page templates for special sections:

```css
/* Custom gallery page template */
@page gallery {
  margin: 0.5in;

  @top-center {
    content: "Gallery";
    font-family: var(--font-ui);
    font-size: 9pt;
    text-transform: uppercase;
  }

  @bottom-center {
    content: counter(page);
  }
}

/* Apply to elements */
.gallery-section {
  page: gallery;
  break-before: page;
}
```

Usage in markdown:

```markdown
@page gallery

# Art Gallery

<div class="gallery-section">
Images here...
</div>
```

## Layout Marker CSS Classes

The `markdown-it-paged` plugin emits these CSS classes from `@` markers:

| Marker | CSS Class | Default Style |
|--------|-----------|---------------|
| `@page` | `.page` | `break-before: page` |
| `@spread` | `.spread` | `break-before: page` |
| `@section` | `.region` | `break-inside: avoid` |
| `@break` | `.md-break` | `break-before: page` |

These classes can be extended in your custom CSS:

```css
/* Example: add spacing to page starts */
.page { padding-top: 2em; }

/* Example: spread always starts on left page */
.spread { break-before: left; }

/* Example: region with visual border */
.region { border: 1px solid #ccc; padding: 1em; }
```

## Component Customization

### Tables

```css
table {
  width: 100%;
  border-collapse: collapse;
  margin: var(--spacing-lg) 0;
}

th {
  background: #333;
  color: white;
  padding: 8pt;
  font-family: var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.5pt;
}

td {
  padding: 6pt;
  border-bottom: 0.5pt solid #ccc;
}

/* Striped rows */
tr:nth-child(even) {
  background: rgba(0, 0, 0, 0.03);
}
```

### Blockquotes

```css
blockquote {
  border-left: 4pt solid var(--color-accent-primary);
  padding-left: var(--spacing-md);
  margin: var(--spacing-lg) 0;
  font-style: italic;
  color: var(--color-text-muted);
}
```

### Lists

```css
ul {
  list-style-type: disc;
  padding-left: 1.5em;
  margin: var(--spacing-md) 0;
}

li {
  margin-bottom: var(--spacing-sm);
}

/* Custom bullet styles */
ul > li::marker {
  color: var(--color-accent-primary);
  font-size: 1.2em;
}
```

## Controlling Default Styles

Style control is managed through the `styles:` array in the manifest. The order of entries determines the CSS cascade, so your custom styles can override any defaults:

```yaml
# manifest.yaml
styles:
  - "styles/my-complete-stylesheet.css"
```

If you provide your own complete stylesheet, it should include ALL necessary CSS:
- Page setup and margins
- Typography and font loading
- Layout and positioning
- Component styles
- Print optimization

## Font Loading

### Web Fonts

```css
/* Load from Google Fonts or other CDN */
@import url('https://fonts.googleapis.com/css2?family=Crimson+Text&display=swap');

:root {
  --font-body: "Crimson Text", serif;
}
```

### Local Fonts

```css
/* Load from assets directory */
@font-face {
  font-family: 'Custom Font';
  src: url('../assets/fonts/custom-font.woff2') format('woff2'),
       url('../assets/fonts/custom-font.woff') format('woff');
  font-weight: 400;
  font-style: normal;
}

:root {
  --font-body: "Custom Font", serif;
}
```

## Print-Specific Styles

### Page Breaking

```css
/* Prevent breaks inside elements */
.keep-together {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Force break before */
.break-before {
  break-before: page;
  page-break-before: always;
}

/* Force break after */
.break-after {
  break-after: page;
  page-break-after: always;
}
```

### Widow/Orphan Control

```css
p {
  orphans: 3;  /* Min lines at bottom of page */
  widows: 3;   /* Min lines at top of page */
}
```

### Running Headers

```css
h1 {
  string-set: section-title content();
}

@page :left {
  @top-left {
    content: string(section-title);
  }
}
```

## CSS Cascade Order

Print-md loads styles in this order (later overrides earlier):

1. **Default Styles** (if not disabled)
   - Core variables
   - Typography
   - Layout
   - Components

2. **Theme Styles** (from manifest)
   - Bundled themes
   - Plugin styles

3. **Custom Styles** (from manifest)
   - Your custom CSS
   - Final authority

Example manifest showing cascade:

```yaml
styles:
  - "themes/classic.css"      # Layer 1: Base theme
  - "plugins/ttrpg.css"       # Layer 2: Plugin styles
  - "styles/brand.css"        # Layer 3: Brand overrides
  - "styles/custom.css"       # Layer 4: Final tweaks
```

## Responsive Design (Preview Mode)

Add responsive styles for web preview:

```css
/* Only apply in web preview, not print */
@media screen {
  body {
    max-width: 800px;
    margin: 0 auto;
    padding: 2em;
  }
}

/* Only apply to print */
@media print {
  .no-print {
    display: none;
  }
}
```

## Advanced Techniques

### CSS Grid Layouts

```css
.two-column-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg);
  break-inside: avoid;
}
```

### Flexbox Layouts

```css
.flex-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
}
```

### Custom Shapes

```css
/* Text flows around circular shape */
.circular-image {
  shape-outside: circle(50%);
  clip-path: circle(50%);
  float: left;
  margin-right: var(--spacing-lg);
}
```

## Debugging Styles

### Preview Mode

Use preview mode to test styles:

```bash
print-md preview ./my-book
```

- Live reload on file changes
- Inspect elements with browser DevTools
- Test responsive behavior
- Debug page breaks

### CSS Debugging

```css
/* Show page boundaries */
@page {
  marks: crop cross;
}

/* Highlight elements */
.debug {
  outline: 2px solid red;
}
```

## Best Practices

### Performance

- Minimize @import usage (slows builds)
- Remove unused CSS rules
- Optimize font loading
- Keep selectors simple

### Maintainability

- Use CSS variables for colors and sizes
- Document custom styles with comments
- Organize CSS into logical sections
- Use meaningful class names

### Print Safety

- Test in grayscale mode
- Ensure 4.5:1 color contrast minimum
- Avoid pure black (#000) and white (#fff)
- Test font embedding in final PDF
- Verify page breaks look correct

## See also

- [**Companion design guides**](./design-guides.md) — publish a living HTML styleguide that documents the CSS this book ships with.
