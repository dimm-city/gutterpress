# Writing Your Content {#ch-writing}

@section .lede

Gutterpress renders standard GitHub-flavored markdown to print-quality HTML. This chapter covers headings, text, tables, and the `@`-prefixed layout markers that control how content flows across pages — and calls out, wherever it matters, which behaviors are core Gutterpress and which come from this guide's own `guide.css`.

@end-section

## Headings

Six heading levels map to standard HTML:

```markdown
# H1 — Chapter Title

## H2 — Major Section

### H3 — Subsection

#### H4 — Minor Heading

##### H5 — Small Heading

###### H6 — Tiny Heading
```

Core Gutterpress renders these as plain `<h1>`–`<h6>` — nothing more. **A new page on every H1, a running header, and the big chapter numeral are this guide's own theme (`guide.css`), not core:**

```css
/* guide.css — a project theme, NOT core Gutterpress */
h1 {
  break-before: page;              /* starts a new page on every H1 */
  page: chapter;
  counter-increment: chapter;
  /* ...type styling... */
}
h1 { string-set: chapter-title content(); }        /* feeds the running header */
h1::before { content: counter(chapter, decimal-leading-zero); /* ...the numeral... */ }
```

A brand-new Gutterpress project has none of this — headings are inert HTML until your own CSS (or a bundled theme, see [Chapter 4](./04-styling-theming.md)) styles them. If you want core, marker-driven pagination instead of an H1-triggered break, use `@chapter` / `@page` / `@page-break` — see [Layout Directives](#layout-directives) below.

### Heading rules

- Use **H1 for chapter titles only** — one per file is a strong convention, but core Gutterpress does not enforce or special-case it.
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

Core Gutterpress emits a plain `<blockquote>`. The left border and tinted background you see rendered in this guide come from `guide.css` — bring your own `blockquote` rule (or a bundled theme) to get that look in your own project.

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

GFM tables render as standard `<table><thead>…</thead><tbody>…</tbody></table>` — that's markdown-it's built-in table support, not a Gutterpress addition. Because the header row is real `<thead>` markup, Chromium can repeat it when a table is forced to break across a page — standard CSS table fragmentation, independent of any stylesheet.

Alternating row shading and keeping a whole table on one page (`table { break-inside: avoid; }`) are **this guide's `guide.css`**, not core. A bare Gutterpress project renders plain, unshaded tables that may break anywhere; add your own `break-inside: avoid` rule to a table or an explicitly classed `@section` when it must stay together.

Keep tables simple — 5 to 7 columns maximum. Align numbers right, text left.

## Markdown Attributes

Add CSS classes, IDs, and attributes to any element using `markdown-it-attrs` syntax (bundled — no install step needed):

```markdown
# Chapter Title {#custom-id .special-class}

Paragraph with custom styling. {.highlight}

![Image](photo.jpg){.gp-center .gp-medium}

[Link text](page.html){.download}
```

`.gp-center` and `.gp-medium` above come from core Gutterpress's built-in `gp-*` image vocabulary — position, size, and spacing classes that compose — see [Chapter 3, Common image classes](./03-visual-elements.md#common-image-classes) for the full set.

### Cross-References

```markdown
# Chapter One {#chapter-one}

Content here...

Later, reference it: [See Chapter One](#chapter-one)
```

Headings do **not** get an automatic id from their text — core Gutterpress has no heading-slug step. Give a heading an explicit id with `{#custom-id}` (via `markdown-it-attrs`) before linking to it with `#custom-id`.

## Layout Directives {#layout-directives}

Layout directives are `@`-prefixed markers that control how content flows across pages. They are built into Gutterpress — this is core behavior, present in every project regardless of theme.

### Quick syntax reference

@section

| Marker | Effect |
|--------|--------|
| `@chapter` | Wrap content in a chapter; a bare label auto-injects a `.chapter-opener` on its first page |
| `@spread` | Start a two-page spread group |
| `@page` | Start a new page (optionally named and/or classed) |
| `@page-break` | Hard break, no page wrapper emitted |
| `@section` | Wrap related content in a structural group for styling and layout |
| `@end-section` | Close the current `@section` (no-op if none is open); stays on the same page |
| `@continue` | Close the current `@section` and reopen a matching one, marked `.gp-continued` |
| `@column-break` | Force a column break inside a multi-column section |

@end-section

### Writing about a marker without triggering it

A marker is **any line whose first character is `@` followed by one of the
words above** — including a line your paragraph happened to wrap onto. Write a
sentence about the `@page` marker and your editor may reflow it so `@page`
lands at the start of a line, and Gutterpress will split your page there.

Escape it with a backslash, exactly as you would escape any other markdown
punctuation, or write it as inline code:

```markdown
A pinned image sets itself against the
\@page container it sits in.

A pinned image sets itself against the
`@page` container it sits in.
```

Both render the text `@page` and leave your page alone. If you ever see a page
break you did not ask for, look for a line that begins with `@` — Gutterpress
warns about most of these, and the warning names the escape.

### @chapter — chapter wrapper (with automatic chapter-opener)

`@chapter` is the flagship layout marker. It wraps everything until the next `@chapter` (or end of file) in `<div class="chapter">`. When given a bare label, it also auto-injects a **chapter-opener** element into the first `@page` inside it — the only element Gutterpress generates on your behalf:

```markdown
@chapter C.01 #ch-bestiary

@page

# Bestiary

Monsters and their stat blocks...
```

Renders:

```html
<div class="chapter" data-chapter-label="C.01" id="ch-bestiary">
  <div class="page" data-chapter-label="C.01">
    <div class="chapter-opener" data-chapter-label="C.01">C.01</div>
    <h1>Bestiary</h1>
    <p>Monsters and their stat blocks...</p>
  </div>
</div>
```

- The bare label (`C.01`) becomes `data-chapter-label` on the chapter **and** on every `@page` inside it, so CSS can reach it from the page where the content actually lives (the engine may split the chapter wrapper itself into an empty leading sheet).
- `.chapter-opener` is a plain, unstyled `<div>` — style it yourself as a badge, a big numeral, a rule, or a full opener layout. It's injected once per chapter, on the first `@page` only.
- `#id` / `.class` work like on any other marker: `@chapter #ch-bestiary .bestiary`.
- No bare label means no `.chapter-opener` — there's no label to show.

### @page — start a new page

Starts a new page. A **single** bare word names the page; `.class` shorthand (or `class=a,b`) adds CSS classes — these are two different things:

```markdown
@page

@page intro

@page .cover .sidebar

@page intro .cover
```

- `@page` → `<div class="page">`
- `@page intro` (one bare word) → `<div class="page" data-page="intro">` — target it with `[data-page="intro"]`, not `.intro`.
- `@page .cover .sidebar` (or `@page class=cover,sidebar`) → `<div class="page cover sidebar">`.
- `@page intro .cover` (name + shorthand) → `<div class="page cover" data-page="intro">`.

Marker classes may also use markdown-it-attrs braces. For example,
`@page {.cover .sidebar}` is equivalent to `@page .cover .sidebar`, and
`@section {.gp-columns-2}` is equivalent to `@section .gp-columns-2`.

**Two or more bare words with no `.class`/`class=` are all treated as classes, with no name at all** — `@page cover sidebar` renders `<div class="page cover sidebar">`, no `data-page`. For predictable results, always use `.class` shorthand (or `class=...`) when you want a class, and reserve a single bare word for the page's name.

### @page-break — hard break

Forces a page break without creating a `<div class="page">` wrapper. Use when you want a break inside flowing content without a new named page:

```markdown
Content above.

@page-break

Content below, on a new page.
```

Renders `<div class="gp-page-break" aria-hidden="true"></div>` between the two paragraphs — a plain marker element, not a page container.

### @section and @end-section

`@section` wraps related content in a structural group. Core keeps the group's
first child from being stranded by itself at a page boundary, but deliberately
does **not** put `break-inside: avoid` on the whole section: long sections must
be allowed to fragment. Add that stronger rule to an explicitly classed
section in your project CSS only when the entire group really must stay
together. Close with `@end-section`, which stays on the current page rather
than forcing a break:

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

`@section` emits `<div class="section">` — plain `.section`, never `.region`.

### @continue — split a named section without losing its identity

`@continue` closes the **currently open** `@section` and immediately reopens a new one with the same name and attributes, plus an extra `gp-continued` class. Use it when a named block has to spill past a break but you still want to style the overflow (e.g. a "(continued)" label) without repeating its heading:

```markdown
@section Notes

First part of a long note...

@continue

The overflow, continuing.

@end-section
```

Renders:

```html
<div class="section" data-section="Notes">
  <p>First part of a long note...</p>
</div>
<div class="section gp-continued" data-section="Notes">
  <p>The overflow, continuing.</p>
</div>
```

`@continue` used with no open `@section` is dropped with a warning — it does not resurrect a section already closed by `@end-section`.

### @column-break and @spread

`@column-break` forces a break inside a multi-column section. `@spread` groups content into a two-page spread:

```markdown
@section {.gp-columns-2}

Left column content.

@column-break

Right column content.

@end-section
```

`.gp-columns-2` and `.gp-columns-3` are the core two- and three-column
utilities. They use `--gp-column-gap` for their gutter and are valid on a bare
`@section`; an enclosing `@page` is not required. Themes may add decoration to
an explicitly themed class, but should not redefine generic column vocabulary.

## Writing Guidelines

### Paragraphs

- One idea per paragraph
- Break long paragraphs at 6–8 sentences
- Use blank lines between paragraphs
- Avoid single-sentence paragraphs

### Print Optimization

- Do not use `<br>` tags for spacing — use paragraph breaks and CSS margins
- Core Gutterpress never inserts a page break on its own — every break in a bare project comes from an explicit `@chapter` / `@page` / `@page-break` marker, or from a theme's own CSS (like this guide's H1 rule). Use `@page` when you need a named page, an id, or a forced break mid-flow.
- Test font embedding in your final PDF before submitting to a printer
