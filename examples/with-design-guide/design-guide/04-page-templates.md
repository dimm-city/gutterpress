@chapter #ch-templates .templates

# Page Templates

<div class="lede">Three named page types control the visual treatment and margin box content. Each maps to a CSS <code>@page</code> rule and is triggered by a directive in the markdown source.</div>

---

## Page Geometry

Physical dimensions for the print output. These values are declared in `manifest.yaml` and reflect the US Letter format used by this guide.

| Dimension | Value | Notes |
|-----------|-------|-------|
| Trim size | 8.5 × 11 in | US Letter — change in `manifest.yaml` |
| Top margin | 0.875 in | Increased to 2.5in on chapter opener pages |
| Bottom margin | 1 in | Folio sits in this space |
| Inner margin (gutter) | 0.75 in | Left on recto, right on verso — binding side |
| Outer margin | 1 in | Right on recto, left on verso |
| Bleed | 0.125 in | Extend backgrounds to the page edge; keep text 0.125in inside the trim |
| Safe area | Trim − 0.125in | Keep all critical content inside this boundary |

**Bleed** is the extra area beyond the trim edge that backgrounds and images must extend into, so trimming variation doesn't leave a white sliver. **Safe area** is the inset boundary inside which all text, logos, and critical art must remain.

To add bleed to your project, extend any full-bleed background color or image 0.125in past each edge using negative margins or `padding: 0.125in` offsets on the container.

---

## Default Body Page

The default page is active for all content that doesn't use a named `@page` directive. It provides:

- **Margins**: 0.875 in (top/bottom), 0.75 in (inner) / 1 in (outer) for a bound book gutter
- **Running header**: chapter title, centered in upper margin, 8pt uppercase
- **Folio**: page number, outside bottom corner (left on verso, right on recto)

No markdown directive is needed — every paragraph is on the default page unless you explicitly switch.

**CSS** — `@page { … }` and `@page :left / :right { … }` in `guide.css § 2`.

---

## Chapter Opener  (`@page chapter`)

Chapter titles automatically switch to the `chapter` named page via the `page: chapter` CSS property on `h1`. The chapter opener provides:

- **Top margin**: 2.5 in (extra breathing room above the title)
- **No running header** (the chapter title *is* the header)
- **Folio**: page number, outside bottom corner

**Directive** — insert `@page chapter` in your markdown *before* the H1 if you need to force the current content onto a fresh chapter opener. Usually this is automatic because every `h1` already sets `break-before: page; page: chapter`.

```markdown
@page chapter

# Chapter One Title

Opening paragraph of the chapter...
```

**Decorative chapter number** — add a `.chapter-num` div above the H1 for a large decorative counter:

```markdown
<div class="chapter-num">01</div>

# The Opening Chapter
```

<div class="example">
<div style="border: var(--border-thin); border-top: 3pt solid var(--color-accent); padding: 1.5em 1em 1em; margin-top: 0.5em;">
<div style="font-family: var(--font-display); font-size: 56pt; font-weight: 700; color: var(--color-rule); line-height: 1; margin-bottom: -0.05em; letter-spacing: -0.04em;">01</div>
<div style="font-family: var(--font-display); font-size: 20pt; font-weight: 700; color: var(--color-accent); letter-spacing: -0.02em; margin-bottom: 0.3em;">The Opening Chapter</div>
<div style="font-family: var(--font-display); font-size: 11pt; color: var(--color-ink-muted); font-style: italic; margin-bottom: 0.8em;">An optional lede paragraph introduces the chapter topic in one or two sentences.</div>
<p style="font-size: 10pt; color: #888; font-style: italic;">↑ Chapter opener preview (decorative number + title + lede)</p>
</div>
</div>

---

## Cover Page  (`@page cover`)

The cover page uses zero margins and sets the background to `--color-accent`. It is typically the first page of the document.

**Directive** — wrap the cover HTML in a `<div class="cover-page">`. The CSS sets `page: cover` on that class.

```html
<div class="cover-page">
  <div class="cover-title">Your Book Title</div>
  <div class="cover-subtitle">A Subtitle or Edition Label</div>
  <div class="cover-rule"></div>
  <div class="cover-author">Author Name</div>
</div>
```

<div class="example">
<div style="background: var(--color-accent); padding: 1.5em 1.5em 1em; border-radius: var(--radius-md);">
  <div style="font-family: var(--font-display); font-size: 22pt; font-weight: 700; color: #fff; line-height: 1.1; letter-spacing: -0.02em; margin-bottom: 0.25em;">Your Book Title</div>
  <div style="font-family: var(--font-display); font-size: 13pt; font-weight: 300; color: rgba(255,255,255,0.7); margin-bottom: 1em;">A Subtitle or Edition Label</div>
  <div style="width: 2in; height: 3pt; background: var(--color-accent-alt); margin-bottom: 1em;"></div>
  <div style="font-family: var(--font-display); font-size: 9pt; font-weight: 600; color: rgba(255,255,255,0.85); letter-spacing: 0.07em; text-transform: uppercase;">Author Name</div>
</div>
</div>

---

## Full-Bleed Spread  (`@page full-bleed`)

The full-bleed page strips all margins and header/footer chrome. Use it for full-page images, maps, diagrams, or decorative interstitials.

**Directive** — set `page: full-bleed` on any block element. Typically wrapped in a `@page full-bleed` directive:

```markdown
@page full-bleed

<div style="page: full-bleed; width: 100%; min-height: 100%;">
  <!-- full-bleed content here -->
</div>
```

Because the full-bleed page has no margins, position all content in CSS using padding on the container element.

---

## Running Headers and Folios

Running headers and page numbers are defined in `@page` margin boxes in `guide.css § 2`. The chapter title is captured via:

```css
h1 { string-set: chapter-title content(); }
```

And placed in the margin via:

```css
@page :right {
  @top-right {
    content: string(chapter-title);
    font-family: var(--font-display);
    font-size: var(--fs-micro);
    text-transform: uppercase;
  }
}
```

**To customize** — change the `content:` value in the margin box. You can use `string()`, `counter()`, or any combination. See the [Paged.js margin box documentation](https://pagedjs.org/documentation/7-generated-content-in-margin-boxes/) for the full reference.

---

## Page Template Summary

| Template | `@page` rule | Triggers via | Top margin | Chrome |
|----------|-------------|--------------|------------|--------|
| Default | `@page` | (automatic) | 0.875 in | Header + folio |
| Chapter opener | `@page chapter` | `h1` / `@page chapter` | 2.5 in | Folio only |
| Cover | `@page cover` | `.cover-page` class | 0 | None |
| Full-bleed | `@page full-bleed` | `page: full-bleed` | 0 | None |

To add a new template, define a new `@page name { … }` rule in `guide.css § 2`, then set `page: name` on the appropriate block element in CSS or as an inline style in the markdown.

---

## Extended Named Page Reference

Named page types beyond the four defaults. Add these to `@page` rules in `styles/guide.css` when your book needs them.

| Template | CSS class | `page:` value | Top margin | Chrome |
|----------|-----------|--------------|------------|--------|
| Default | — | `@page` | 0.875 in | Running header + folio |
| Chapter opener | `.chapter-opener` | `chapter` | 2.5 in | Folio only |
| Cover | `.cover-page` | `cover` | 0 | None |
| Full-bleed | `page: full-bleed` | `full-bleed` | 0 | None |
| Front matter | `.front-matter` | `front-matter` | 0.875 in | None (footers suppressed) |
| Colophon | `.colophon` | `colophon` | 0.875 in | None |
| Blank | `@page :blank` | `:blank` | — | None (auto-inserted) |

Define new named pages in `styles/guide.css § 2 PAGE SETUP` following the existing `@page chapter { … }` pattern.

---

## Facing-Page Spread Layout

Use `@spread` to group content into a logical two-page spread — the left and right pages are authored as a unit and Paged.js keeps them paired.

```markdown
@spread #sp-intro .intro-spread

@page .left-page

Left page content goes here. Use `@column-break` for columns within a page.

@page .right-page

Right page content goes here. Both pages render side-by-side in the preview.
```

The `@spread` marker emits `<div class="spread">`. The `@page` markers inside it emit `<div class="page">` children. There is no dedicated "close spread" marker — a spread stays open until the next `@spread`, the next `@chapter`, or the end of the file, whichever comes first. Start a new `@chapter` (or `@spread`) when you're ready to leave two-page-spread mode. CSS targets the spread with `.spread.intro-spread` and individual pages with `.spread .page.left-page`.

---

## Internal Anchor Cross-References

Because every chapter opens with `@chapter #ch-name`, you can link directly to any chapter from anywhere in the document using a standard markdown link:

```markdown
See the [Typography chapter](#ch-typography) for body text specifications.

[Jump to Color Palette](#ch-palette)

[CLI Reference](#ch-cli)
```

The `#ch-*` IDs are set by the `@chapter #id` marker at the top of each source file. In the PDF viewer, these render as clickable hyperlinks. In a printed PDF, the `a[href]::after` CSS rule in `guide.css` prints the URL fragment in parentheses — suppress this for internal links with `a[href^="#"]::after { content: none; }` (already set in the stylesheet).
