@chapter #ch-layout .layout

# Layout

<div class="lede">Utilities for multi-column text, image placement, and page-break control. All are CSS classes applied via markdown attributes or `@section` markers.</div>

---

## Two-Column Text

The `.two-column` class divides a container into two equal columns with a hairline column rule. Best for glossaries, reference lists, FAQ sections, and any content with short entries.

```markdown
@section .two-column
Column content flows left to right automatically.
Add `@column-break` to force content to the right column.
@end-section
```

@section .two-column

**Column flow** — text runs from the bottom of the left column to the top of the right column automatically, based on the available column height.

**Column break** — add `@column-break` on its own line anywhere inside the section to push subsequent content to the right column unconditionally.

**Page breaks** — a two-column block breaks across pages normally. Add `.no-break` to the `@section` classes to keep the entire block on one page.

**Headings inside** — H3 and H4 headings work inside two-column blocks. H1 and H2 span the full width because they carry a border-bottom that doesn't respect column boundaries.

@end-section

---

## Three-Column Text

`.three-column` follows the same rules as two-column but divides the content into three narrower columns. Use for very short entries (index items, skill lists) where each entry is two lines or fewer.

@section .three-column

Alpha · first entry in a longer list.

Beta · second entry demonstrating the three-column flow.

Gamma · third entry. The column rule draws between all three columns.

Delta · fourth entry. It wraps to the next column when the first fills.

Epsilon · fifth entry showing the automatic flow behavior.

Zeta · sixth entry. Three columns suit dense, short-form reference content.

@end-section

---

## Image Floats

Float an image alongside body text using `.img-float-right` or `.img-float-left`. The image occupies 44% of the column width; text wraps around it.

**Syntax** — apply via markdown-it-attrs: `![alt](src){.img-float-right}`

<div class="example">
<div style="overflow: hidden; padding: 0.2em 0;">
  <div class="img-float-right" style="background: var(--color-tint); border: var(--border-thin); height: 80pt; display: flex; align-items: center; justify-content: center;">
    <span style="font-family: var(--font-display); font-size: var(--fs-small); color: var(--color-ink-faint);">Image placeholder</span>
  </div>
  <p>Body text flows to the left of the floated image. The image occupies 44% of the text column width, leaving 56% for the paragraph. This balance keeps the image prominent without overwhelming the text.</p>
  <p style="clear: both;">After the float clears, text returns to full width. Add an empty paragraph below the float to clear it explicitly.</p>
</div>
</div>

```markdown
![Alt text](path/to/image.png){.img-float-right}

Body paragraph flows alongside the image...
```

`.img-float-right`/`.img-float-left` are **this guide's own** project-layer
classes (44% width, defined in `guide.css`). Core Gutterpress also ships an
always-available `gp-*` vocabulary that needs no project CSS at all — a
position word plus optional size and spacing words that compose:

<div class="example">
<div style="overflow: hidden; padding: 0.2em 0;">
  <div style="float: right; width: 25%; margin: 0 0 1em 1em; background: var(--color-tint); border: var(--border-thin); height: 60pt; display: flex; align-items: center; justify-content: center;">
    <span style="font-family: var(--font-display); font-size: var(--fs-small); color: var(--color-ink-faint);">.gp-right .gp-small</span>
  </div>
  <p>A quarter-width right float via <code>{.gp-right .gp-small}</code> — no stylesheet required. Sizes (<code>.gp-small/.gp-medium/.gp-large</code>) and wrap spacing (<code>.gp-tight/.gp-loose</code>) compose with either float, and <code>.gp-center</code>/<code>.gp-full</code>/<code>.gp-bleed</code> cover the no-wrap layouts.</p>
  <p style="clear: both;">Inside an <code>@page</code> block, <code>{.gp-pin .gp-bottom .gp-right}</code> pins an image to the page corner instead of flowing. See the User Guide's Chapter 3 for the full vocabulary.</p>
</div>
</div>

```markdown
![Alt text](path/to/image.png){.gp-right .gp-small}

Body paragraph flows alongside the image...

![Watermark](path/to/mark.png){.gp-pin .gp-bottom .gp-right .gp-small}
```

---

## Figures with Captions

Wrap images in a `<figure>` element for proper captioning. The `figcaption` renders at `--fs-small` in muted color with italic style.

<div class="example">
<figure>
  <div style="background: var(--color-tint); border: var(--border-thin); height: 100pt; display: flex; align-items: center; justify-content: center; margin-bottom: 0.4em;">
    <span style="font-family: var(--font-display); font-size: var(--fs-small); color: var(--color-ink-faint);">Figure image placeholder</span>
  </div>
  <figcaption>Figure 1.1 — A descriptive caption explains what the figure shows and why it matters. Captions are set at 9pt in --color-ink-muted.</figcaption>
</figure>
</div>

```html
<figure>
  ![Image](path.png)
  <figcaption>Figure N — Caption text.</figcaption>
</figure>
```

---

## Page-Break Utilities

| Class | Effect |
|-------|--------|
| `.no-break` | Keep block on one page (`break-inside: avoid`) |
| `.break-before` | Start block on a new page |
| `.keep-next` | Keep block on the same page as the next element |

**Applied via `@section`** — wrap any block in a section with the class:

```markdown
@section .no-break
Content that must not split across a page break.
@end-section
```

**Applied via heading attribute** — force a new page before a specific heading:

```markdown
## New Section {.break-before}
```

---

## Layout Class Reference

<table class="token-table">
<thead><tr><th>Class / Syntax</th><th>Applied via</th><th>Effect</th></tr></thead>
<tbody>
<tr><td>.two-column</td><td>@section .two-column</td><td>Two equal CSS columns with column rule</td></tr>
<tr><td>.three-column</td><td>@section .three-column</td><td>Three narrow columns for dense lists</td></tr>
<tr><td>.img-float-right</td><td>![alt](src){.img-float-right}</td><td>Float image right, 44% width, text wraps</td></tr>
<tr><td>.img-float-left</td><td>![alt](src){.img-float-left}</td><td>Float image left, 44% width, text wraps</td></tr>
<tr><td>.gp-left / .gp-right / .gp-center / .gp-full / .gp-bleed</td><td>![alt](src){.gp-right}</td><td>Core image positions (no project CSS needed)</td></tr>
<tr><td>.gp-small / .gp-medium / .gp-large</td><td>![alt](src){.gp-right .gp-small}</td><td>Core image sizes — 25/50/75% of the column</td></tr>
<tr><td>.gp-shape</td><td>![alt](src){.gp-right .gp-shape}</td><td>Wrap text to a floated image's alpha silhouette</td></tr>
<tr><td>.gp-pin (+ .gp-top/.gp-bottom/.gp-left/.gp-right)</td><td>![alt](src){.gp-pin .gp-bottom}</td><td>Pin an image to its @page container instead of flowing</td></tr>
<tr><td>.no-break</td><td>@section .no-break</td><td>Prevent block from splitting across pages</td></tr>
<tr><td>.break-before</td><td>## Heading {.break-before}</td><td>Force new page before this element</td></tr>
<tr><td>.keep-next</td><td>@section .keep-next</td><td>Keep block on same page as next element</td></tr>
<tr><td>.lede</td><td>&lt;div class="lede"&gt;…&lt;/div&gt;</td><td>13pt italic intro paragraph after H1</td></tr>
<tr><td>@column-break</td><td>Inside a two/three-column @section</td><td>Force remaining content to next column</td></tr>
</tbody>
</table>

---

## Intro / Lede Paragraph

Use `.lede` on the opening paragraph of a chapter for a larger, italic introductory paragraph that sets the stage before the body begins.

<div class="example">
<div class="lede">This is a lede paragraph. It is set in the display font at 13pt italic, in <code>--color-ink-muted</code>. Use it once per chapter, immediately after the H1, to give the reader a one- or two-sentence preview of what follows.</div>
</div>

```markdown
# Chapter Title

<div class="lede">One or two sentences that frame the chapter for the reader.</div>

First body paragraph begins here...
```
