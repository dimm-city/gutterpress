@chapter #ch-layout .layout ch="2"

# Layout & Composition

@lede

Multi-column splits, floated art, sidebar wrappers, and page-break utilities.

@end-lede

@page

## Layout Utilities Reference

| Syntax | Effect | Notes |
|--------|--------|-------|
| `@section .two-column` … `@end-section` | Two equal columns with column rule | H1/H2 span both cols; H3/H4 flow inside |
| `@section .three-column` … `@end-section` | Three narrow columns | Best for short reference entries |
| `@sidebar` … `@end-sidebar` | Right-floated aside at 38% width | Emits `.dc-sidebar`; add `class="inset"` for full-height page-inset treatment |
| `@column-break` | Force next column | Use inside `@section .two-column` / `.three-column` |
| `![]{.dc-img-float-right}` | Float image right, 44% width | Text wraps left |
| `![]{.dc-img-float-left}` | Float image left, 44% width | Text wraps right |
| `@section .pmd-no-break` | Prevent block splitting across pages | — |
| `## Heading {.pmd-break-before}` | Force new page before element | — |

@section .two-column

**Two-column behavior:** text fills the left column top-to-bottom and overflows right automatically. A two-column block can break across pages — wrap in `@section .pmd-no-break` to keep it together.

**Image float behavior:** floated image occupies 44% of column width; after the float clears, text returns to full width. Add a blank line below the float to clear it explicitly if following content crowds the image.

**Sidebar wrapper:** `@sidebar` emits `.dc-sidebar`. Use `@sidebar class="inset"` when the page template needs the full-height inset sidebar treatment. Use raw HTML only when you need a structure the sidebar contains, not to author the sidebar shell itself.

@end-section

@section .two-column

```markdown
@section .two-column

Left column content.

@column-break

Right column content.

@end-section
```

```markdown
@sidebar
> [!NOTE]
> Free counters trigger only once per round.

@end-sidebar

Body text wraps to the left of the sidebar automatically.
```

@end-section

@section .two-column

```markdown
@sidebar class="inset"
### Sidebar

Inset sidebar content for page templates like rules references.
@end-sidebar
```

```markdown
@section .pmd-no-break
Content that must not split across a page break.
@end-section

## New Section {.pmd-break-before}
```

@end-section

---

## See It In Action

These examples show the above layout utilities applied to real book pages using actual Dimm City Field Guide content.

- [Chapter Openers](#ch-example-chapter-opener) — two-column opener layout with column-break between fiction and rules columns
- [Specialty Profile](#ch-example-specialty-profile) — two-column ability spreads and image floats alongside skill cards
- [Rules & Mechanics](#ch-example-rules) — sidebar wrappers with rules callouts beside body prose
- [Dream Master Pages](#ch-example-dm-npcs) — sidebar float with portrait and field notes in citizen-file pages
- [Gear & Tech](#ch-example-gear-tech) — three-column gear tables and floated art plates
