# Markdown Reference

<div class="lede">Every print-md syntax feature with live examples. This chapter is a complete reference — consult it when you can't remember which directive, container, or attribute to use.</div>

---

## Page Layout Markers

The `@` marker system is the primary way to control page flow.

### @page — New Page

Starts a new page. Optionally accepts CSS class names.

**Syntax** — `@page` alone, or `@page chapter-class` with class names.

```markdown
@page

# New Chapter Title
```

### @break — Hard Break

Forces a page break without the `<div class="page">` wrapper.

**Syntax** — `@break` on its own line.

```markdown
Content before the break.

@break

Content starts on the next page.
```

### @spread — Two-Page Spread

Groups content into a two-page spread. Use for facing-page layouts where left and right content must stay paired.

**Syntax** — `@spread` on its own line.

```markdown
@spread

Content that spans both pages of a spread.
```

### @section — Keep Together

Groups content to prevent page breaks within the block. Equivalent to `break-inside: avoid` in CSS.

**Syntax** — `@section` on its own line.

```markdown
@section

This entire block will try to stay on one page.

- Item A
- Item B
- Item C
```

---

## Container Blocks

Triple-colon fences wrap content in a styled `<div>`. The word after `:::` sets the container type.

### ::: container — Avoid Page Break

Prevents the content from splitting across a page.

::: container
This `container` block will stay on one page. Use it around tables, spec blocks, callouts, and any multi-line element that must read as a unit.
:::

### ::: two-column — Two Columns

Flows content in two equal CSS columns.

::: two-column

Left column content. Use `---{.column-break}` to force content into the right column early.

---{.column-break}

Right column content. The column rule runs between both columns.

:::

### ::: sidebar — Sidebar Block

Floats content as a right-aligned aside.

::: sidebar
**Sidebar.** Floated right at 38% width. Use for supplementary notes, cross-references, or examples that support but don't interrupt the body flow.
:::

A body paragraph flows to the left of the sidebar. The paragraph will wrap around the floated aside until it clears the bottom of the sidebar element.

### ::: callout-note, ::: callout-warning, ::: callout-tip

Styled information panels with a labeled type.

::: callout-note
<span class="callout-label">Note</span>
Standard informational callout. Blue left border, tinted background.
:::

::: callout-warning
<span class="callout-label">Warning</span>
Action-required callout. Orange left border, warm-tinted background.
:::

::: callout-tip
<span class="callout-label">Tip</span>
Positive guidance callout. Green left border, cool-tinted background.
:::

### ::: pull-quote — Pull Quote

Large centered excerpt with decorative rules above and below.

::: pull-quote
The measure of good design is whether the reader notices the design at all.

<span class="attribution">— Design Guide, Chapter 3</span>
:::

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

Forces a column break inside a two-column container. No space before the `{`.

**Syntax** — `---{.column-break}`

::: two-column

Left column content. The break below pushes everything after it into the right column.

---{.column-break}

Right column content. This paragraph begins here because of the column break directive above it.

:::
