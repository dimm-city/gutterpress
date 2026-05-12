@chapter #ch-layout .layout .chapter-02 ch="2"

# Layout & Composition

:::lede
Multi-column splits, floated art, sidebar wrappers, and page-break utilities.
:::

---

## Layout Utilities Reference

| Syntax | Effect | Notes |
|--------|--------|-------|
| `:::two-column` … `:::` | Two equal columns with column rule | H1/H2 span both cols; H3/H4 flow inside |
| `:::three-column` … `:::` | Three narrow columns | Best for short reference entries |
| `:::sidebar` … `:::` | Right-floated aside at 38% width | Generates `.dc-sidebar` |
| `---{.column-break}` | Force next column (no space before `{`) | Use inside `:::two-column` / `:::three-column` |
| `![]{.img-float-right}` | Float image right, 44% width | Text wraps left |
| `![]{.img-float-left}` | Float image left, 44% width | Text wraps right |
| `:::container {.pmd-no-break}` | Prevent block splitting across pages | — |
| `## Heading {.pmd-break-before}` | Force new page before element | — |

**Two-column behavior:** text fills the left column top-to-bottom and overflows right automatically. A two-column block can break across pages — wrap in `:::container` to keep it together.

**Image float behavior:** floated image occupies 44% of column width; after the float clears, text returns to full width. Add a blank line below the float to clear it explicitly if following content crowds the image.

**Sidebar wrapper:** `:::sidebar` generates `.dc-sidebar`. Use `.dc-sidebar` as the canonical class name in raw HTML — do not use `.sidebar` directly.

```markdown
:::two-column

Left column content.

---{.column-break}

Right column content.

:::
```

```markdown
:::sidebar
<div class="dc-note">
  <span class="dc-note-label">Note</span>
  <p>Free counters trigger only once per round.</p>
</div>
:::

Body text wraps to the left of the sidebar automatically.
```

```markdown
:::container {.pmd-no-break}
Content that must not split across a page break.
:::

## New Section {.pmd-break-before}
```

---

## See It In Action

These examples show the above layout utilities applied to real book pages using actual Dimm City Field Guide content.

- [Chapter Openers](#ch-example-chapter-opener) — two-column opener layout with column-break between fiction and rules columns
- [Specialty Profile](#ch-example-specialty-profile) — two-column ability spreads and image floats alongside skill cards
- [Rules & Mechanics](#ch-example-rules) — sidebar wrappers with rules callouts beside body prose
- [Dream Master Pages](#ch-example-dm-npcs) — sidebar float with portrait and field notes in citizen-file pages
- [Gear & Tech](#ch-example-gear-tech) — three-column gear tables and floated art plates
