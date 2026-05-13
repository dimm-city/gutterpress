# Field Guide Markdown Cleanup

Changes needed in `dc-op-manual/field-guide/` markdown source files to align
with the dc-design-guide canonical patterns. Do not change `field-guide/css/`
— those files are owned by the field-guide build, not the design guide.

---

## 1. Callout class renames (find/replace per file)

All callout containers in the field-guide use short-form class names without
the `dc-` prefix. The design guide canonical names have the prefix. Update all
source files:

| Find (field-guide markdown) | Replace with |
|---|---|
| `::: wrapper {".vibe-callout"}` | `::: wrapper {.dc-vibe-callout}` |
| `{.vibe-callout}` (inline attr) | `::: wrapper {.dc-vibe-callout}` block |
| `::: wrapper {".origin-callout"}` | `::: wrapper {.dc-origin-callout}` |
| `::: wrapper {".human-callout"}` | `::: wrapper {.dc-human-callout}` |
| `::: wrapper {".gear-callout"}` | `::: wrapper {.dc-gear-callout}` |

**Note on `.gear-callout`:** the short form adds `min-height: 3.5in` which
`.dc-gear-callout` intentionally omits. After renaming, verify the gear callout
pages still render at the intended height — if chapter-01 needs extra height,
add a book-specific CSS rule instead of an inline style.

Files to update: `chapter-01.md` (vibe, origin, human, gear), `chapter-05.md`
(gear).

---

## 2. Legacy ability containers → `@skill` / `@continue`

`:::: ability` and `:::: ability-continued` are the pre-plugin authoring
pattern. They produce `.ability` divs with **no active CSS** in the current
stack. Every remaining use must migrate to the plugin macros; prefer
`@continue` over the legacy continuation block.

### `:::: ability` → `@skill`

Old pattern:
```markdown
:::: ability
#### Skill Name | AUG1.1
##### Sub-header text
1. 2 AP — Description text
::::
```

New pattern:
```markdown
@skill variant="1" id="skill-name"
#### Skill Name | AUG1.1
##### Sub-header text
1. 2 AP — Description text
@end-skill
```

### `:::: ability-continued` → `@continue`

Old pattern (inside an `:::: ability` block):
```markdown
@continue
```

The `@continue` macro must be inside an active `@skill` block. It closes the
current card and opens a continuation card with `▸` in the tab.

Files to audit for remaining `:::: ability` / `:::: ability-continued` usage:
`chapter-02.md`, and all `chapter-02 N *.md` specialty files.

---

## 3. Dead containers — delete or replace

| Container | Action |
|---|---|
| `:::: aug` (content container) | Keep until chapter-05 migration is redesigned; no `@aug` macro is planned |
| `:::: ability-continued` | Migrate to `@continue` (see §2) |
| `::: wrapper {".call-home-img"}` | Delete the wrapper; the image inside is already commented out (`chapter-01.md` line ~393) |

---

## 4. Two-column layout — use `@section` with class modifiers

The field guide uses `::: wrapper {.two-column-list}` and
`:::: wrapper {.two-column .dc-terms}` as layout containers. The canonical
replacement path is `@section` with the same layout classes attached.

| Find | Replace with |
|---|---|
| `::: wrapper {.two-column-list}` | `@section .two-column-list` |
| `:::: wrapper {.two-column .dc-terms}` | `@section .two-column .dc-terms` |

Use `@break` or a following `@page` marker to close the region when needed.

---

## 5. Glossary entries — use `@definition`

The `.terms .item` pattern produces a glossary entry with a bold term and
definition paragraph. The design guide equivalent is `@definition`.

Old pattern (chapter-04, chapter-05 glossary pages):
```markdown
::: wrapper {.item}
**Term:** Definition text here.
:::
```

New pattern:
```markdown
@definition
**Term:** Definition text here.
@end-definition
```

The `.item.violet` modifier has no CSS backing — it is currently invisible. If
highlighted entries are needed, use a inline `style` on the specific entry or
add a field-guide-specific rule in `book-sections.css` after the design guide
cleanup is complete.

---

## 6. Art positioning — use `dc-art-bottom`

Images pinned to the bottom-center of a page use `{.bottom-center}` as an
image attribute. This should become `{.dc-art-bottom}` once the CSS is added
to `dc-brand.css` (tracked in design guide CSS work).

| Find | Replace after CSS lands |
|---|---|
| `![img](../img/placeholder-plate.png){.bottom-center}` | `![img](../img/placeholder-plate.png){.dc-art-bottom}` |
| `::: wrapper {.bottom-center}` | `::: wrapper {.dc-art-bottom}` |

Files: `chapter-01.md`, `chapter-03.md`, `chapter-05.md`.

---

## 7. Specialty opener syntax — no change needed

The specialty opener (`.specialty-intro`, `.specialty-art`) already works. No
markdown change required. The design guide will document the `::: wrapper`
syntax as the canonical form.

---

## What does NOT change

- `book-sections.css`, `field-guide.css`, `book-pages.css` — field-guide
  internal CSS, not owned by design guide
- `@page` annotations with chapter-specific classes (`.chapter-01`, `.ideal`,
  `.flaw`, `.citizen-file`, etc.) — chapter layout, not design system
- `.specialty-spread` / `.specialty-card [specialty-name]` — keep as-is;
  the per-specialty names are layout hooks for `book-sections.css`
- `.ideal-list` / `.flaw-list` — chapter-01 specific page template; stays in
  `book-sections.css` scope, not a design guide element
- `.weapon-01`, `.item.right-side` — chapter-05 layout hacks; stay in
  `book-sections.css`
