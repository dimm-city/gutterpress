# Writing Your Content {#ch-writing}

<div class="lede">Print-md renders standard GitHub-flavored markdown to print-quality HTML. This chapter covers headings, text, tables, and the layout directives that control how content flows across pages.</div>

## Headings

Six heading levels map to a type scale tuned for print:

```markdown
# H1 — Chapter Title (starts new page, sets running header)

## H2 — Major Section

### H3 — Subsection

#### H4 — Minor Heading

##### H5 — Small Heading

###### H6 — Tiny Heading
```

### Heading rules

- Use **H1 for chapter titles only** — one per file. H1 automatically starts a new page.
- H1 sets the text that appears in the running header on every page.
- Use H2–H3 for main sections. H4–H6 sparingly.
- Keep headings under 60 characters.
- Never skip heading levels (H1 → H3 without H2).

## Text Formatting

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
- Third item

Ordered list:
1. First step
2. Second step
   1. Substep A
   2. Substep B
3. Third step
```

Use ordered lists for sequential steps. Use unordered lists for non-ordered items. Keep nesting to two levels maximum.

### Blockquotes

```markdown
> This is a blockquote.
> It can span multiple lines and paragraphs.
>
> And have multiple paragraphs.
```

Blockquotes are styled with a left border and tinted background — good for quotes, references, or notes that don't need the full callout treatment.

## Tables

```markdown
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

Alignment:
| Left   | Center | Right |
|:-------|:------:|------:|
| Text   | Text   |    42 |
```

Tables automatically:
- Break across pages intelligently with repeated headers
- Apply alternating row shading
- Stay together when they fit on one page

Keep tables simple — 5 to 7 columns maximum. Align numbers right, text left.

## Markdown Attributes

Add CSS classes, IDs, and attributes to any element using `markdown-it-attrs` syntax:

```markdown
# Chapter Title {#custom-id .special-class}

Paragraph with custom styling. {.highlight}

![Image](photo.jpg){.center width="80%"}

[Link text](page.html){.download}
```

### Cross-References

```markdown
# Chapter One {#chapter-one}

Content here...

Later, reference it: [See Chapter One](#chapter-one)
```

All headings get auto-generated anchors from their slugified text. You can override with `{#custom-id}`.

## Layout Directives

Layout directives are `@`-prefixed markers that control how content flows across pages. They are provided by the built-in `markdown-it-paged` plugin.

### Quick syntax reference

@section

| Marker | Effect |
|--------|--------|
| `@page` | Start a new page (optionally with CSS class names) |
| `@page-break` | Hard break, no page wrapper emitted |
| `@section` | Group content together to avoid mid-section breaks |
| `@end-section` | Close `@section` or `@page`, stay on same page |
| `@spread` | Start a two-page spread group |
| `@column-break` | Force a column break inside a multi-column section |

@end-section

### @page — start a new page

Starts a new page. Optionally accepts one or more CSS class names:

```markdown
@page

@page chapter

@page chapter sidebar-layout
```

For multiple classes, use either comma-separated values in a `class=...` attribute or the `.class` shorthand. A trailing bare token after `class=...` is treated as a marker name instead of an extra class, so prefer `@page class=cover,sidebar` or `@page .cover .sidebar` over `@page class=cover sidebar`.

### @page-break — hard break

Forces a page break without creating a `<div class="page">` wrapper. Use when you want a break inside flowing content without a new named page:

```markdown
Content above.

@page-break

Content below, on a new page.
```

### @section and @end-section

`@section` groups content to avoid mid-section page breaks. Close with `@end-section` — which stays on the current page rather than forcing a break:

```markdown
@section

## Character Stats

| Stat | Value |
|------|-------|
| HP   | 45    |
| AC   | 16    |

@end-section

Continues on the same page as the section above.
```

### @column-break and @spread

`@column-break` forces a break inside a multi-column section. `@spread` groups content into a two-page spread:

```markdown
@section .two-column

Left column content.

@column-break

Right column content.

@end-section
```

## Writing Guidelines

### Paragraphs

- One idea per paragraph
- Break long paragraphs at 6–8 sentences
- Use blank lines between paragraphs
- Avoid single-sentence paragraphs

### Print Optimization

- Do not use `<br>` tags for spacing — use paragraph breaks and CSS margins
- Let auto-rules handle chapter starts; use `@page` only when you need a named class or a forced break mid-flow
- Test font embedding in your final PDF before submitting to a printer
