@chapter #ch-reference .reference

# Markdown Reference

<div class="lede">Every Gutterpress syntax feature with live examples. This chapter is a complete reference — consult it when you can't remember which marker or attribute to use.</div>

---

## Page Layout Markers

The `@` marker system controls page flow and generates semantic HTML wrappers. Markers accept `#id`, `.class`, and `key=value` attributes — enabling chapter-scoped CSS rules without touching any selector in the global stylesheet.

**Full attribute syntax** — `@marker #id .class key=value`

```markdown
@chapter #ch-typography .typography
@page #pg-intro .opener template=chapter
@section #sec-scale .type-scale region=main
```

Generated HTML:
```html
<div class="chapter typography" id="ch-typography">
<div class="page opener" id="pg-intro" data-page="..." data-template="chapter">
<div class="section type-scale" id="sec-scale" data-section="..." data-region="main">
```

Chapter IDs unlock precise CSS targeting without specificity battles:

```css
/* Only affects the CLI chapter's tables — zero global side-effects */
.chapter#ch-cli table      { table-layout: fixed; }
.chapter#ch-cli td:first-child { width: 26%; }
```

---

### @chapter — Chapter Wrapper

Wraps all following content in `<div class="chapter">` until the next `@chapter` or end of document. The h1 inside still drives the CSS page break and running header — `@chapter` provides the structural ID for CSS scoping.

**Syntax** — `@chapter #id .class` before the chapter h1.

```markdown
@chapter #ch-typography .typography

# Typography

Content of this chapter...
```

### @page — New Page

Wraps content in `<div class="page">`. Use inside a chapter or spread for explicit page-level containers with named CSS targets.

**Syntax** — `@page #id .class` or `@page` alone.

```markdown
@chapter #ch-palette .palette

# Color Palette

@page #pg-swatches .swatches

## Primary Colors

@page #pg-token-ref .token-ref

## Token Reference
```

### @page-break — Hard Break

Forces a page break **without** generating a `<div class="page">` wrapper element. Use `@page-break` when you need a page change but don't want a targetable `page` div.

**Key distinction from `@page`:**
- `@page` wraps all following content in `<div class="page [class]">` — CSS rules targeting `.page` apply to it.
- `@page-break` emits `<div class="md-page-break" aria-hidden="true"></div>` — no wrapper for content to live inside, and it does not close any open `@section`/`@page`/`@spread`.

**Syntax** — `@page-break` on its own line.

```markdown
Content before the break.

@page-break

Content starts on the next page.
```

### @spread — Two-Page Spread

Wraps content in `<div class="spread">`. Use for facing-page layouts where left and right pages must stay paired.

**Syntax** — `@spread #id .class` before the spread content.

```markdown
@spread #sp-palette-intro .fullbleed

Content that spans both pages of a spread.
```

### @section / @end-section — Region Block

Wraps content in `<div class="section">`. Use to group a logical block within a page — equivalent to `break-inside: avoid` plus an addressable ID. Close with `@end-section`.

**Syntax** — `@section #id .class region=name` … `@end-section`

```markdown
@section #sec-type-scale .type-scale region=main

## Type Scale

Specimen content here...

@end-section
```

**Live example** — this callout is inside a `@section` and will stay on one page:

@section .no-break

<span class="callout-label">Note</span>
This callout is wrapped in a `@section .no-break` block. Paged.js will push the entire block to the next page rather than split it mid-block.

@end-section

---

## Styled Blocks

Gutterpress has no block-container plugin — every styled block is just a `@section` (or `@page`) carrying the CSS class the stylesheet targets, or raw HTML for content with no page-break requirement.

### Avoid a Page Break

@section .no-break

This `@section .no-break` block will stay on one page. Use it around tables, spec blocks, callouts, and any multi-line element that must read as a unit.

@end-section

```markdown
@section .no-break
Content that must stay on one page.
@end-section
```

### Two Columns

Flows content in two equal CSS columns.

@section .two-column

Left column content. Use `@column-break` to force content into the right column early.

@column-break

Right column content. The column rule runs between both columns.

@end-section

```markdown
@section .two-column
Left column content. Use `@column-break` to force content into the right column early.

@column-break

Right column content. The column rule runs between both columns.
@end-section
```

### Sidebar

Floats content as a right-aligned aside.

@section .sidebar

**Sidebar.** Floated right at 38% width. Use for supplementary notes, cross-references, or examples that support but don't interrupt the body flow.

@end-section

A body paragraph flows to the left of the sidebar. The paragraph will wrap around the floated aside until it clears the bottom of the sidebar element.

```markdown
@section .sidebar
**Sidebar.** Floated right at 38% width.
@end-section

A body paragraph flows to the left of the sidebar.
```

### Callouts

Styled information panels with a labeled type — `.callout-note`, `.callout-warning`, `.callout-tip`.

@section .callout-note

<span class="callout-label">Note</span>
Standard informational callout. Blue left border, tinted background.

@end-section

@section .callout-warning

<span class="callout-label">Warning</span>
Action-required callout. Orange left border, warm-tinted background.

@end-section

@section .callout-tip

<span class="callout-label">Tip</span>
Positive guidance callout. Green left border, cool-tinted background.

@end-section

```markdown
@section .callout-note
<span class="callout-label">Note</span>
Standard informational callout.
@end-section
```

### Pull Quote

Large centered excerpt with decorative rules above and below.

@section .pull-quote

The measure of good design is whether the reader notices the design at all.

<span class="attribution">— Design Guide, Chapter 3</span>

@end-section

```markdown
@section .pull-quote
The measure of good design is whether the reader notices the design at all.

<span class="attribution">— Design Guide, Chapter 3</span>
@end-section
```

### Any Custom Class

`@section` accepts any class from `guide.css` or `§ 8 YOUR BOOK LAYER` — no registration step is needed for a new class.

@section .callout

<span class="callout-label">Generic section</span>
This block uses `@section .callout` — applying the `.callout` class directly.

@end-section

```markdown
@section .callout
Content inside gets `class="section callout"` on its wrapping div.
@end-section

@section .my-custom-class key="value"
Accepts classes, IDs, and data attributes.
@end-section
```

For side-by-side blocks that don't share text flow, use `.grid` on a plain `<div>`:

<div class="grid">

<div class="example">
**Left block** — independent content, does not flow into the right block.
</div>

<div class="example">
**Right block** — equal width, aligned to the top of the left block.
</div>

</div>

---

## Element Attributes

The `markdown-it-attrs` plugin adds `{#id .class attr="value"}` to most markdown elements.

### Heading Attributes

```markdown
## Section Heading {#my-anchor .custom-class}
```

### Image Attributes

```markdown
![Alt text](image.png){.img-float-right}
```

### Inline Span Attributes

```markdown
This sentence has a **key term**{.custom-span} with a custom class.
```

---

## Standard Markdown

All standard GFM features are available. Smart typography is enabled.

### Formatting

**Bold** — `**text**` · *Italic* — `*text*` · ***Bold italic*** — `***text***` · `code` — `` `text` ``

Smart quotes: "quoted text" and 'single quotes'. Em dash: --- · En dash: --. Ellipsis: ...

### Headings

```markdown
# H1 — chapter title (page break before)
## H2 — section heading (accent border)
### H3 — sub-section
#### H4 — item heading (uppercase)
```

### Lists

Unordered:

- First item
- Second item
  - Nested A
  - Nested B
- Third item

Ordered:

1. Step one
2. Step two
3. Step three

### Blockquotes

```markdown
> Quote text.
>
> — Attribution
```

### Tables

| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |
| D    | E      | F     |

### Fenced Code Blocks

````markdown
```language
code here
```
````

---

## Column Break

Forces a column break inside a two- or three-column `@section`.

**Syntax** — `@column-break` on its own line.

@section .two-column

Left column content. The break below pushes everything after it into the right column.

@column-break

Right column content. This paragraph begins here because of the column break directive above it.

@end-section

```markdown
@section .two-column
Left column content. The break below pushes everything after it into the right column.

@column-break

Right column content.
@end-section
```

---

## Footnotes

Footnotes are supported via the `markdown-it-footnote` plugin. References appear inline at the point of use; definitions can be placed anywhere in the file and render at the end of the content flow.

**Syntax** — `[^label]` in text + `[^label]: definition` anywhere in the file.

Here is a sentence with a footnote reference.[^demo] And here is a second reference to the same note.[^demo]

A different footnote uses a different label.[^second]

[^demo]: This is the footnote definition. It renders at the end of the page or document context. Definitions can be placed anywhere in the source file — they do not need to follow the reference immediately.

[^second]: A second, independent footnote. Labels can be any string — numbers, words, or abbreviations.

```markdown
Here is a sentence with a footnote.[^fn-1]

[^fn-1]: The footnote definition. Can go anywhere in the file.
```
