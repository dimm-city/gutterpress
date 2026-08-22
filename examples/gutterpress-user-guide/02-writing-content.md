# Writing Your Content {#ch-writing}

@section .lede

Gutterpress renders standard GitHub-flavored markdown to print-quality HTML. This chapter covers headings, text, tables, and the `@`-prefixed layout markers that control how content flows across pages — and calls out, wherever it matters, which behaviors are core Gutterpress and which come from this guide's own `guide.css`.

@end-section

## Two Ways to Write {#two-ways-to-write}

Markdown files are the only thing Gutterpress stores, and that does not
change. What changes is how you look at one while you write it. The desktop
app offers two editing surfaces for the same file:

@section

| Surface | What you see |
|---------|--------------|
| **Rich** | Your text laid out with the book's own stylesheet, at print size, on page-sized sheets |
| **Markdown** | The markdown source itself |

@end-section

**Rich is the default** — every `.md` file opens that way. The two buttons
labelled **Rich** and **Markdown** just above the editing area switch between
them, and the choice sticks for every file you open afterwards, in every
project, until you switch back. Switching saves any pending edit first, so
whichever surface you arrive at starts from the bytes that are on disk.

Stylesheets are a different story: a `.css` file has no rich form, so it
always opens as source and the switch does not appear for it.

### What the rich editor shows you

The rich editor loads your book's CSS unchanged — the same bytes the PDF gets
— and lays your text out on page-sized sheets at the trim size from your
`@page` rule. The fonts, margins, heading styles, `@section` classes and
column layouts are the real ones; the editor brings no stylesheet of its own
for your content.

The toolbar's **Single** and **Two-page** buttons apply here as well as to the
preview — one switch for both panes, not a separate editor setting. Two-page
needs real room, because the editor draws pages at their true print size and
never zooms: a letter-sized spread is 1656 pixels wide. When the editing pane
is narrower than that, it keeps the single-page stack rather than pushing half
a spread off the edge; drag the splitter wider, or hide the preview, and the
spread appears.

It is **not** page-for-page identical to the PDF, and it is not meant to be.
The live preview is the surface that is; the editor trades that accuracy for
being fast enough to keep up with your typing. It lays your pages out and
leaves them alone, where the preview goes back over its work and corrects it,
so a break here and there lands a page early or a page late. Three things
account for most of the difference:

- **Elements sized to the whole sheet** — a `@page` rule with no margins, a
  `.gp-bleed` image — are taller than the box that has to hold them, so they
  spill onto the next page.
- **A named page that changes the sheet size** has no equivalent in the
  editor, so that page is laid out at the book's default size instead.
- **Breaks are avoided by slightly different rules** than the print engine
  uses, which accounts for the rest.

@section .callout-tip

**Tip:** The live preview is the authority on pagination, and that is checked
rather than asserted: every release compares the preview against the built PDF
across six books, and a single page number, cross-reference or heading landing
differently in one of them is a build failure. Write in the rich editor; judge
your page breaks in the preview.

@end-section

### Saving rewrites your markdown in one style

The rich editor holds your document as structure rather than as text, so when
it saves it writes that structure back out in one consistent markdown style.
Your words are untouched and the rendered book is identical — but the file on
disk may not be byte-for-byte what you typed:

@section

| You typed | Saved as |
|-----------|----------|
| `- item` or `+ item` | `* item` |
| `_italic_` | `*italic*` |
| `__bold__` | `**bold**` |
| `it's` | `it’s` |
| `itch.io` | `[itch.io](http://itch.io)` |

@end-section

The last two look like the editor rewriting your prose, and they are not: the
smart-quote and auto-link steps already run when your book is rendered, so a
curly apostrophe and a linked domain are what the PDF was always going to
show. Saving only writes down what was already true. Table delimiter rows are
tidied the same way — `|------|------|` becomes `| --- | --- |`.

The big one is wrapping. A line break inside a paragraph is only a space in
markdown, so a paragraph you hand-wrapped over several lines comes back as one
long line:

```markdown
As you typed it:

Files are processed in the order listed in
`manifest.yaml`, or alphabetically if you
omit it.

After saving:

Files are processed in the order listed in `manifest.yaml`, or alphabetically if you omit it.
```

That is a deliberate trade, chosen on measurement: across 139 real paragraphs,
re-wrapping the text back to 80 columns would have made the one-time change
nearly twice as large (1,826 lines against 1,045) and made an ordinary
one-word edit dirty up to 14 lines instead of always 2. Long lines cost
nothing in the book and keep later changes readable — though they are
genuinely long: across Gutterpress's own example books, a hand-wrapped
paragraph comes back as a line of 225 characters at the median, and the
longest line in any of those books is 797.

Layout markers are the exception to all of this: `@chapter`, `@page`,
`@section` and the rest are written back exactly as you authored them, and
`{#id}` / `{.class}` braces survive on headings, images, links and code
fences. And if you would rather hand-wrap, write in **Markdown** mode —
nothing rewrites a file you edit as source.

### The one-time tidy

Paid one file at a time, that reformatting scatters through every later change
you make and your version history stops being readable. So the app offers to
pay it once, up front. The first time you open the editor on a book that has
never been tidied — and only if something would actually change — a dialog
appears headed **Tidy this book's markdown?**

- It says how many files would be reformatted, and how many are already fine.
- Every listed file has a **Show changes** link that puts the first differing
  lines side by side, **Now** against **After tidying**, so you can see what
  the change looks like in your own prose before agreeing to it.
- **Tidy the markdown** rewrites them all at once — a single change you can
  read and record as a unit. Nothing is written until you press it.
- **Decide later** writes nothing at all. Rich editing keeps working, and you
  will be asked again next time you open the book.
- Files rich editing cannot represent are listed separately, with the reason,
  and are left exactly as you wrote them.

Expect it to touch most of a book: across Gutterpress's own example projects,
27 of 32 markdown files changed.

### Files that stay in markdown

Some markdown has no rich equivalent, and rather than guess at one, Gutterpress
opens that file as source and prints the reason in a line above the editor. Two
constructs account for it in practice:

- **Footnotes** — `[^1]` and its definition. There is no footnote in the rich
  document model, so a file using them cannot be represented.
- **Link reference definitions** — the `[label]: url` form, where a URL is
  declared once and referred to by name. This is the more dangerous case: the
  markdown parser consumes that line while rendering and emits nothing for it,
  so a rich save would quietly drop it. A file containing any is refused
  outright.

Definition lists and syntax contributed by plugins behave the same way. The
refusal is deliberate — the file opens in the surface that cannot damage it,
rather than opening richly and mis-writing your book. It is also rare: 31 of
the 32 markdown files across Gutterpress's own example books are rich-editable,
and the single exception is a footnote.

### The `/` menu

Type `/` at the start of a line, or after a space, and a menu of blocks opens
at the cursor. Keep typing to filter it (`col` finds **Two columns**), Up and
Down to move, **Enter** or **Tab** to insert, **Esc** to dismiss. A slash
anywhere else — inside a URL, in `and/or` — is just a slash.

@section

| Item | Inserts |
|------|---------|
| Heading 1, 2, 3 | `#`, `##`, `###` |
| Bulleted list, Numbered list | A list |
| Quote | A blockquote |
| Code | A fenced code block |
| Divider | A horizontal rule |
| Table | A three-column table |
| Page break | `@page-break` |
| Section | `@section` … `@end-section` |
| Two columns | `@section .gp-columns-2`, with a `@column-break` between the columns |
| Chapter | `@chapter "Chapter Title"`, wrapping a first `@page` |
| Spread | `@spread`, wrapping a first `@page` |

@end-section

The last five insert the layout markers described in
[Layout Directives](#layout-directives) below. The menu is a faster way to
reach commands that already exist — every item runs the same action as its
button on the formatting toolbar, so the two cannot disagree about what they
insert.

### The selection toolbar

Select any text and a small toolbar appears above it, with buttons for bold,
italic, strikethrough, inline code, and turning the selection into a link.
Left and Right arrows move between the buttons and **Esc** dismisses it. These
are the same marks described in [Text Formatting](#text-formatting) below — the
toolbar is for when you would rather not remember which asterisks do what.

### Moving a block

Point at any block — a paragraph, a heading, a list item, a table, a whole
`@section` — and a small grip appears in the margin beside it. Drag the grip
and the block moves: a line shows where it will land, and it lands there when
you let go. Only the order changes; the words, the marker lines and the
`{.class}` braces come along untouched.

A block moves **among the blocks it sits with** — a paragraph inside a
`@section` moves within that section, a top-level paragraph moves among the
other top-level blocks. Drop it over something outside that group, such as a
different `@section`, and it lands **beside** that section rather than inside
it, so a stray drop can never quietly change which group your text belongs to.
To move text between groups, edit the marker lines in **Markdown** mode. And
dragging a `@section` itself moves the whole section — marker lines, classes
and everything inside — which is usually the move you wanted anyway.

**Alt+Up** and **Alt+Down** do the same thing from the keyboard, with no grip
involved — the same keys that move a line up and down in **Markdown** mode, so
one habit works in both surfaces. The keys move whichever block the cursor is
in, the grip whichever block the pointer is over, and the two always pick the
same one: the nearest thing that has somewhere to go. Inside a `@section` that
is the paragraph, which moves within the section; inside a list it is the
whole list item, which moves among its siblings; anywhere inside a table it is
the table itself, because a table's rows and columns are its structure rather
than an order you chose.

**Ctrl** (**Option** on macOS) held while you drop copies the block instead of
moving it, and a move is one undo — **Ctrl+Z** puts it back where it was.

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

## Text Formatting {#text-formatting}

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
