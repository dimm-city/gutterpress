@chapter #ch-layout .layout .chapter-02 ch="2"

# Layout & Composition

::: wrapper {.dc-intro}
Multi-column splits, floated art, sidebar wrappers, and page-break utilities.
:::

---

## Two-Column Layout

The `:::two-column` container divides its content into two equal CSS columns with a hairline column rule. Use it for glossaries, reference lists, FAQ entries, and any content with short items that benefit from side-by-side flow.

**Syntax** — `:::two-column` … `:::`

```markdown
:::two-column

**Left column** — text runs from the bottom of the first column to the top of the second automatically, based on the available height.

---{.column-break}

**Right column** — everything after the column-break directive starts here regardless of how much space remains in the first column.

:::
```

**Specimen**

:::two-column

**Column flow** — text fills the left column top-to-bottom and overflows into the right column automatically.

**Column break** — add `---{.column-break}` (no space before `{`) to push subsequent content into the right column unconditionally.

---{.column-break}

**Headings inside** — H3 and H4 work inside two-column blocks. H1 and H2 span both columns because they carry a full-width border rule.

**Page breaks** — a two-column block can break across pages. Wrap the block in `:::container` to keep it together.

:::

---

## Image Floats

Float an image alongside body text using `.img-float-right` (canonical: `.pmd-float-right`) or `.img-float-left` (canonical: `.pmd-float-left`). The floated image occupies 44% of the column width; body text wraps around the remaining 56%.

**Syntax** — apply via markdown-it-attrs on the image:

```markdown
![Alt text](img/placeholder-plate.png){.img-float-right}

Body paragraph flows to the left of the floated image...
```

```markdown
![Alt text](img/placeholder-plate.png){.img-float-left}

Body paragraph flows to the right of the floated image...
```

After the float clears, text returns to full column width. Add a blank line or a `:::container` block below the float to clear it explicitly if the following content crowds the image bottom.

---

## Sidebar Wrapper

The `:::sidebar` container floats content as a right-aligned aside at 38% of the text column width. Body text wraps to the left of the sidebar until it clears the bottom of the sidebar element. The `:::sidebar` container generates a `.sidebar` element, aliased to `.dc-sidebar`. Use `.dc-sidebar` as the canonical class name when authoring raw HTML.

**Syntax** — `:::sidebar` … `:::`

```markdown
:::sidebar

<div class="dc-note">
  <span class="dc-note-label">Note</span>
  <p>Free counters trigger only once per round. Pick the one that hurts most.</p>
</div>

:::

A body paragraph flows to the left of the sidebar. The text wraps around the floated aside automatically and returns to full width once the sidebar clears.
```

**Specimen**

:::sidebar

<div class="dc-note">
  <span class="dc-note-label">Sidebar</span>
  <p>Floated right at 38% width. Use for supplementary notes, cross-references, or rules clarifications that support but don't interrupt the body flow.</p>
</div>

:::

A body paragraph flows to the left of the sidebar. Use sidebars for rules reminders, cross-reference pointers, or any short block that relates to but doesn't interrupt the surrounding prose.

---

## Column Break

The `---{.column-break}` directive forces a column break inside a `:::two-column` or `:::three-column` block. Content after the break starts at the top of the next column.

**Syntax** — no space between `---` and `{`:

```markdown
:::two-column

First column content ends here.

---{.column-break}

Second column content starts here.

:::
```

---

## Page Break Utilities

Control page breaking with class attributes on headings and containers.

| Class / Syntax | Applied via | Effect |
|----------------|-------------|--------|
| `:::two-column` | container | Two equal columns with column rule |
| `:::three-column` | container | Three narrow columns for dense lists |
| `.img-float-right` (canonical: `.pmd-float-right`) | `![]{.img-float-right}` | Float image right, 44% width |
| `.img-float-left` (canonical: `.pmd-float-left`) | `![]{.img-float-left}` | Float image left, 44% width |
| `.no-break` | `:::container {.no-break}` | Prevent block splitting across pages |
| `.break-before` (canonical: `.pmd-break-before`) | `## Heading {.break-before}` | Force new page before element |
| `---{.column-break}` | Inside column block | Force remaining content to next column |

**Prevent page split** — wrap any block that must stay together:

```markdown
:::container {.no-break}
Content that must not split across a page break.
:::
```

**Force new page** — add `.pmd-break-before` (alias: `.break-before`) to any heading:

```markdown
## New Section {.pmd-break-before}
```
