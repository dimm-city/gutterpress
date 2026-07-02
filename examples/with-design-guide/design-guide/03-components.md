@chapter #ch-components .components

# Components

<div class="lede">Reusable layout blocks authored with the `@section` marker. Each section shows the markdown source, a live rendered example, and the CSS class that controls the styling.</div>

---

## Callout: Note

Use for supplementary information that expands on the body text but isn't required reading. Default callout type.

**Syntax** — `@section .callout-note` … `@end-section`

<div class="example">
<div class="callout-note">
<span class="callout-label">Note</span>
This is a note callout. Use it for tips, clarifications, or extra context that supports the body paragraph above. Keep notes to two or three sentences — longer content belongs in a sidebar or an appendix.
</div>
</div>

```markdown
@section .callout-note
<span class="callout-label">Note</span>
Your note text here.
@end-section
```

---

## Callout: Warning

Use for information the reader must act on before proceeding. The altered color draws the eye before the reader moves past.

**Syntax** — `@section .callout-warning` … `@end-section`

<div class="example">
<div class="callout-warning">
<span class="callout-label">Warning</span>
This action cannot be undone. Verify all settings before proceeding, and keep a backup of any files you intend to overwrite.
</div>
</div>

```markdown
@section .callout-warning
<span class="callout-label">Warning</span>
Your warning text here.
@end-section
```

---

## Callout: Tip

Use for positive guidance — best practices, shortcuts, or "nice to know" improvements. Green accent signals a safe, optional action.

**Syntax** — `@section .callout-tip` … `@end-section`

<div class="example">
<div class="callout-tip">
<span class="callout-label">Tip</span>
Run `print-md preview` with `--verbose` to see exactly which files are being watched and when rebuilds fire. Useful for diagnosing slow hot-reload cycles.
</div>
</div>

```markdown
@section .callout-tip
<span class="callout-label">Tip</span>
Your tip text here.
@end-section
```

---

## Sidebar

A floated aside for supplementary reference material. Sidebars run 38% width, float right, and allow body text to wrap alongside. Keep them to 60–120 words.

**Syntax** — `@section .sidebar` … `@end-section`

<div class="example">
<div class="sidebar">

**Design note.** This sidebar uses `.sidebar` from `guide.css`. In production you'd replace this placeholder text with a genuine aside — a worked example, a historical note, or a cross-reference — that rewards the reader who pauses but doesn't interrupt those who don't.

</div>

Body text flows alongside the sidebar, demonstrating the float behavior. The sidebar occupies 38% of the column width; the remaining 62% holds the paragraph. At the end of the sidebar the text reverts to full-width flow. Use a `@section .no-break` wrapper around a sidebar + its accompanying paragraph if you need to prevent them from splitting across a page break.

</div>

```markdown
@section .sidebar
**Sidebar heading.** Sidebar body text (60–120 words).
@end-section

Body paragraph that flows alongside the sidebar.
```

---

## Pull Quote

A large-format excerpt from the body text, set off with accent rules above and below. Use sparingly — one per chapter at most.

**Syntax** — `@section .pull-quote` … `@end-section`

<div class="example">
<div class="pull-quote">
<p>The measure of good design is whether the reader notices the design at all.</p>
<span class="attribution">— Design Guide, Chapter 2</span>
</div>
</div>

```markdown
@section .pull-quote
The measure of good design is whether the reader notices the design at all.

<span class="attribution">— Source, Chapter N</span>
@end-section
```

---

## Spec Block

A key/value data panel for reference material: product specs, character stats, API parameters, recipe ingredient lists. Stays on one page.

**Syntax** — Raw HTML, since standard markdown renders HTML blocks as-is. Wrap in `@section .no-break` only if it needs to stay off a page break.

<div class="example">
<div class="spec-block">
<div class="spec-block-title">Product Specification</div>
<div class="spec-row"><span class="spec-key">Format</span><span class="spec-val">8.5 × 11 in, perfect bound</span></div>
<div class="spec-row"><span class="spec-key">Pages</span><span class="spec-val">256 pp (estimated)</span></div>
<div class="spec-row"><span class="spec-key">Color</span><span class="spec-val">Full color interior, 4-color cover</span></div>
<div class="spec-row"><span class="spec-key">Paper</span><span class="spec-val">70 lb uncoated text</span></div>
<div class="spec-row"><span class="spec-key">Print run</span><span class="spec-val">1,000 units (first edition)</span></div>
</div>
</div>

```html
<div class="spec-block">
  <div class="spec-block-title">Spec Title</div>
  <div class="spec-row">
    <span class="spec-key">Key</span>
    <span class="spec-val">Value</span>
  </div>
</div>
```

---

## Blockquote

For epigraphs, pull citations, and extended external quotations. Styled with an accent-alt left border and italic body text.

**Syntax** — Standard markdown `>` blockquote.

<div class="example">

> The best way to predict the future is to design it.
>
> — Buckminster Fuller

</div>

```markdown
> Quote text goes here.
>
> — Attribution
```

---

## Tables

Full-width tables with a colored header, alternating row fills, and text set at `--fs-small` (9pt).

<div class="example">

| Command | Default | Description |
|---------|---------|-------------|
| `preview` | port 3579 | Live preview server with hot reload |
| `build` | pdf | Renders to HTML or PDF |
| `run` | — | Full validated PDF pipeline |
| `lint` | — | CSS print-safety checks |
| `validate` | — | Post-build PDF compliance check |

</div>

```markdown
| Column A | Column B | Column C |
|----------|----------|----------|
| Value    | Value    | Value    |
```

---

## Two-Column Layout

Dense reference content benefits from a two-column layout. Use `@section .two-column` to trigger the CSS columns property.

**Syntax** — `@section .two-column` … `@column-break` … `@end-section`

<div class="example">
<div class="two-column">

The two-column layout divides the content area into two equal columns with a hairline rule between them. Text flows from the bottom of the left column to the top of the right column automatically.

Use two-column layout for glossaries, index-style reference lists, comparison tables that don't fit in a single-column table, and any content where the parallel structure benefits from visual alignment.

Avoid using two-column for narrative prose — it creates a choppy reading experience and complicates page breaks. Save it for genuinely list-like or reference content.

Add `@column-break` on its own line anywhere inside the section to force subsequent content into the right column early.

</div>
</div>

```markdown
@section .two-column
Left column content flows here until it reaches
the bottom, then continues in the right column.

@column-break

Content after the break always starts in the
right column regardless of left column height.
@end-section
```

---

## Numbered Steps

A zero-padded ordered list for sequential procedures — character creation, workflow steps, setup instructions. Each step is prevented from splitting across a page break.

**Syntax** — `<ol class="steps">` with `<li>` children. The CSS counter handles numbering automatically; do not add numbers in the HTML.

<div class="example">
<ol class="steps">
<li>Pick a typeface for your book. Update <code>--font-body</code> and <code>--font-display</code> in <code>§ 1 BRAND TOKENS</code>.</li>
<li>Set your accent color. Change <code>--color-accent</code> to your primary brand hue.</li>
<li>Run <code>print-md preview design-guide</code> to see all changes live in the browser.</li>
<li>Delete any component chapter you don't use. Keep the guide focused on what your book ships.</li>
<li>Commit both the guide and the book stylesheet together — they share the same CSS file.</li>
</ol>
</div>

```html
<ol class="steps">
  <li>First step — the CSS counter adds the number automatically.</li>
  <li>Second step — each item avoids splitting across a page break.</li>
  <li>Third step — no need to number items in the HTML source.</li>
</ol>
```

---

## Glossary

A definition list for rules terms, jargon, and key concepts. Use at the end of a chapter or as a standalone reference section.

**Syntax** — `<div class="glossary">` containing `<div class="glossary-term">` / `<div class="glossary-def">` pairs.

<div class="example">
<div class="glossary">
<div class="glossary-term">Trim size</div>
<div class="glossary-def">The final dimensions of the printed page after cutting. All content must stay within the safe area inside the trim boundary.</div>
<div class="glossary-term">Bleed</div>
<div class="glossary-def">Extra artwork that extends 0.125in beyond the trim edge. Required for any element that touches the page boundary so trimming variation does not leave a white sliver.</div>
<div class="glossary-term">Running header</div>
<div class="glossary-def">The chapter title that appears in the top margin of every body page. Captured automatically from each H1 via CSS <code>string-set</code>.</div>
</div>
</div>

```html
<div class="glossary">
  <div class="glossary-term">Term</div>
  <div class="glossary-def">Definition of the term goes here.</div>
  <div class="glossary-term">Another Term</div>
  <div class="glossary-def">Its definition.</div>
</div>
```

---

## Creating Custom Callout Variants

The callout component is designed to be extended. Because `@section` accepts any CSS class name, adding a project-specific callout type (for example, a "Game Master Note" callout) needs no plugin or registration step:

**Step 1 — Add tokens to `§ 1 BRAND TOKENS` in `styles/guide.css`:**

```css
--color-tint-gm:  #f0f0ff;   /* GM note fill  */
--border-gm:      3pt solid #5050c0;
```

**Step 2 — Add CSS rules to `§ 8 YOUR BOOK LAYER`:**

```css
.callout-gm {
  border-left: var(--border-gm);
  background: var(--color-tint-gm);
}
.callout-gm .callout-label { color: #5050c0; }
```

**Step 3 — Use in markdown:**

```markdown
@section .callout-gm
<span class="callout-label">Game Master</span>
This note is only for the GM. Players should not read past this point.
@end-section
```

The same pattern works for any class name — `.callout-lore`, `.callout-safety`, `.callout-example`, etc.
