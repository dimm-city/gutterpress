@chapter #ch-typography .typography

# Typography

<div class="lede">The type system uses two families: a serif for body text and a sans-serif for headings and UI labels. Adjust <code>--font-body</code> and <code>--font-display</code> in <code>guide.css</code> to swap both at once.</div>

## Type Scale

<span class="spec-label">H1 — Chapter Title  ·  24pt  ·  --font-display  ·  700</span>

<div class="type-h1">This Is a Chapter Title</div>

<span class="spec-label">H2 — Section Heading  ·  16pt  ·  --font-display  ·  600</span>

## This Is a Section Heading

<span class="spec-label">H3 — Sub-section  ·  13pt  ·  --font-display  ·  600</span>

### This Is a Sub-section Heading

<span class="spec-label">H4 — Item Heading  ·  11pt  ·  --font-display  ·  700  ·  uppercase</span>

#### This Is an Item Heading

<span class="spec-label">Body text  ·  11pt  ·  --font-body  ·  400  ·  1.45 leading  ·  justified</span>

Body paragraphs are 11pt Georgia at 1.45 line-height, justified with automatic hyphenation. The text color uses `--color-ink` (#1a1a2e). Consecutive paragraphs share a 0.65em bottom margin — enough to separate them without breaking reading flow.

A second paragraph demonstrates the spacing. The margin between paragraphs is intentionally modest; the reader's eye should track the column, not jump between visual islands.

<span class="spec-label">Small / Caption  ·  9pt  ·  --font-display  ·  400</span>

<span style="font-family: var(--font-display); font-size: var(--fs-small); color: var(--color-ink-muted);">Figure 1.1 — Small text for captions, table labels, and running copy.</span>

<span class="spec-label">Micro / Folios  ·  8pt  ·  --font-display  ·  400</span>

<span style="font-family: var(--font-display); font-size: var(--fs-micro); color: var(--color-ink-faint); text-transform: uppercase; letter-spacing: 0.08em;">CHAPTER TITLE  ·  RUNNING HEADER</span>

---

## Inline Elements

**Bold** is used for emphasis: `**text**`.

*Italic* is used for titles, technical terms on first use, and foreign phrases: `*text*`.

***Bold italic*** is reserved for strong named terms: `***text***`.

`Inline code` uses `--font-mono` (Menlo/Consolas) with a tinted background: `` `text` ``.

[Links](#typography) render with `--color-accent` and print a URL in parentheses for PDF output.

> A blockquote sets off an epigraph, pull citation, or extended quotation. It receives an accent-colored left border, italic text, and muted color. Use for attributable external sources or thematic openings.

---

## Paragraph Spacing in Context

This section demonstrates a full column of body text at production length. A book paragraph typically runs four to eight lines. At the set measure (the page width minus margins), 11pt Georgia with 1.45 leading produces approximately 65–72 characters per line — the ergonomic ideal for sustained reading.

Avoid one-sentence paragraphs in body prose. They disrupt the rhythm and inflate visual spacing. Two or three sentences is the minimum that reads as a coherent thought; four to six is the comfortable range for most genres.

Orphan and widow control is set globally at 3 lines. The layout engine will push a block to the next page rather than leave fewer than 3 lines stranded at the top or bottom of a column.

---

## Lists

Unordered lists:

- First item — full sentence or phrase
- Second item, slightly longer to show wrapping behavior inside a single bullet point
- Third item, with a sub-list:
  - Nested A
  - Nested B

Ordered lists:

1. First step in a sequence
2. Second step — numbers in the source don't need to be sequential
3. Third step

---

## Token Reference

<table class="token-table">
<thead><tr><th>Variable</th><th>Value</th><th>Use</th></tr></thead>
<tbody>
<tr><td>--font-body</td><td>Georgia, Times New Roman, serif</td><td>Body text, blockquotes</td></tr>
<tr><td>--font-display</td><td>Helvetica Neue, Arial, sans-serif</td><td>Headings, labels, UI</td></tr>
<tr><td>--font-mono</td><td>Menlo, Consolas, Courier New, mono</td><td>Code, tokens, folios</td></tr>
<tr><td>--fs-display</td><td>32pt</td><td>Cover / hero title</td></tr>
<tr><td>--fs-h1</td><td>24pt</td><td>Chapter title (H1)</td></tr>
<tr><td>--fs-h2</td><td>16pt</td><td>Section heading (H2)</td></tr>
<tr><td>--fs-h3</td><td>13pt</td><td>Sub-section (H3)</td></tr>
<tr><td>--fs-h4</td><td>11pt</td><td>Item heading (H4)</td></tr>
<tr><td>--fs-body</td><td>11pt</td><td>Body paragraphs</td></tr>
<tr><td>--fs-small</td><td>9pt</td><td>Captions, table text</td></tr>
<tr><td>--fs-micro</td><td>8pt</td><td>Running headers, folios</td></tr>
</tbody>
</table>

---

## Smart Typography

The markdown renderer has `typographer: true` enabled, which automatically converts common ASCII shortcuts to proper typographic characters. No special syntax required.

| You type | Renders as | Character |
|----------|------------|-----------|
| `(c)` | (c) | Copyright © |
| `(tm)` | (tm) | Trademark ™ |
| `(R)` | (R) | Registered ® |
| `--` | -- | En dash – |
| `---` | --- | Em dash — |
| `...` | ... | Ellipsis … |
| `"quoted"` | "quoted" | Curly double quotes |
| `'quoted'` | 'quoted' | Curly single quotes |

Hyphens in words are left as-is. The `hyphens: auto` CSS property handles automatic hyphenation for justified body text — this is separate from the typographer plugin.

---

## Custom Fonts

The stylesheet's `§ 0 CUSTOM FONTS` section (at the top of `styles/guide.css`) contains a commented `@font-face` template. To load a custom font:

1. Add your font files to a `fonts/` directory alongside `guide.css`.
2. Uncomment and edit the `@font-face` blocks in `§ 0`, updating the file paths and family name.
3. Update `--font-body` or `--font-display` in `§ 1 BRAND TOKENS` to reference your new family name.

```css
/* In § 0 CUSTOM FONTS — uncomment and edit */
@font-face {
  font-family: "YourBodyFont";
  src: url("../fonts/your-body-font-regular.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}

/* In § 1 BRAND TOKENS — update the variable */
:root {
  --font-body: "YourBodyFont", Georgia, serif;
}
```

Include one `@font-face` block per weight and style combination (regular, bold, italic, bold-italic). Use `woff2` as the primary format with a `ttf` fallback for broadest compatibility. The `font-display: swap` value prevents invisible text during font loading in the preview.
