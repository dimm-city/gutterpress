# Components

<div class="lede">Reusable layout blocks authored with triple-colon container syntax. Each section shows the markdown source, a live rendered example, and the CSS class that controls the styling.</div>

---

## Callout: Note

Use for supplementary information that expands on the body text but isn't required reading. Default callout type.

**Syntax** — `::: callout-note … :::`

<div class="example">
<div class="callout-note">
<span class="callout-label">Note</span>
This is a note callout. Use it for tips, clarifications, or extra context that supports the body paragraph above. Keep notes to two or three sentences — longer content belongs in a sidebar or an appendix.
</div>
</div>

```markdown
::: callout-note
<span class="callout-label">Note</span>
Your note text here.
:::
```

---

## Callout: Warning

Use for information the reader must act on before proceeding. The altered color draws the eye before the reader moves past.

**Syntax** — `::: callout-warning … :::`

<div class="example">
<div class="callout-warning">
<span class="callout-label">Warning</span>
This action cannot be undone. Verify all settings before proceeding, and keep a backup of any files you intend to overwrite.
</div>
</div>

```markdown
::: callout-warning
<span class="callout-label">Warning</span>
Your warning text here.
:::
```

---

## Callout: Tip

Use for positive guidance — best practices, shortcuts, or "nice to know" improvements. Green accent signals a safe, optional action.

**Syntax** — `::: callout-tip … :::`

<div class="example">
<div class="callout-tip">
<span class="callout-label">Tip</span>
Run `print-md preview` with `--verbose` to see exactly which files are being watched and when rebuilds fire. Useful for diagnosing slow hot-reload cycles.
</div>
</div>

```markdown
::: callout-tip
<span class="callout-label">Tip</span>
Your tip text here.
:::
```

---

## Sidebar

A floated aside for supplementary reference material. Sidebars run 38% width, float right, and allow body text to wrap alongside. Keep them to 60–120 words.

**Syntax** — `::: sidebar … :::`

<div class="example">
<div class="sidebar">

**Design note.** This sidebar uses `.sidebar` from `guide.css`. In production you'd replace this placeholder text with a genuine aside — a worked example, a historical note, or a cross-reference — that rewards the reader who pauses but doesn't interrupt those who don't.

</div>

Body text flows alongside the sidebar, demonstrating the float behavior. The sidebar occupies 38% of the column width; the remaining 62% holds the paragraph. At the end of the sidebar the text reverts to full-width flow. Use a `:::` container with `break-inside: avoid` around a sidebar + its accompanying paragraph if you need to prevent them from splitting across a page break.

</div>

```markdown
::: sidebar
**Sidebar heading.** Sidebar body text (60–120 words).
:::

Body paragraph that flows alongside the sidebar.
```

---

## Pull Quote

A large-format excerpt from the body text, set off with accent rules above and below. Use sparingly — one per chapter at most.

**Syntax** — `::: pull-quote … :::`

<div class="example">
<div class="pull-quote">
<p>The measure of good design is whether the reader notices the design at all.</p>
<span class="attribution">— Design Guide, Chapter 2</span>
</div>
</div>

```markdown
::: pull-quote
The measure of good design is whether the reader notices the design at all.

<span class="attribution">— Source, Chapter N</span>
:::
```

---

## Spec Block

A key/value data panel for reference material: product specs, character stats, API parameters, recipe ingredient lists. Stays on one page.

**Syntax** — Raw HTML block inside a `::: container … :::` fence.

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
::: container
<div class="spec-block">
  <div class="spec-block-title">Spec Title</div>
  <div class="spec-row">
    <span class="spec-key">Key</span>
    <span class="spec-val">Value</span>
  </div>
</div>
:::
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

Dense reference content benefits from a two-column layout. Use `::: two-column … :::` to trigger the CSS columns property.

**Syntax** — `::: two-column … :::`

<div class="example">
<div class="two-column">

The two-column layout divides the content area into two equal columns with a hairline rule between them. Text flows from the bottom of the left column to the top of the right column automatically.

Use two-column layout for glossaries, index-style reference lists, comparison tables that don't fit in a single-column table, and any content where the parallel structure benefits from visual alignment.

Avoid using two-column for narrative prose — it creates a choppy reading experience and complicates page breaks. Save it for genuinely list-like or reference content.

Add `---{.column-break}` (no space before `{`) anywhere inside the container to force subsequent content into the right column early.

</div>
</div>

```markdown
::: two-column
Left column content flows here until it reaches
the bottom, then continues in the right column.

---{.column-break}

Content after the break always starts in the
right column regardless of left column height.
:::
```
