@chapter #ch-reference .reference .chapter-02 ch="2"

# Markdown Reference

:::lede
All markdown-it syntax features with DC authoring context.
:::

---

## Page Layout Markers

The `@` marker system controls page flow and generates semantic HTML wrappers. Markers accept `#id`, `.class`, and `key=value` attributes, enabling chapter-scoped CSS rules without touching global selectors.

**Full attribute syntax** — `@marker #id .class key=value`

| Marker | HTML emitted | Purpose |
|--------|-------------|---------|
| `@chapter #id .class` | `<div class="chapter [class]" id="id">` | Wraps all following content until next `@chapter` |
| `@page #id .class` | `<div class="page [class]" id="id">` | Explicit page container with a named CSS target |
| `@break` | `<div class="md-break" aria-hidden="true"></div>` | Hard page break without generating a wrapper div |
| `@section #id .class` | `<div class="region [class]" id="id">` | Region block — groups content, avoids page split |
| `@spread #id .class` | `<div class="spread [class]" id="id">` | Two-page spread — keeps left and right pages paired |

```markdown
@chapter #ch-augmerc .augmerc   → <div class="chapter augmerc" id="ch-augmerc">
@page #pg-skills .skills        → <div class="page skills" id="pg-skills">
@section #sec-counters .counters → <div class="region counters" id="sec-counters">
```

Chapter IDs enable precise CSS scoping without specificity battles: `.chapter#ch-augmerc table { table-layout: fixed; }`

---

## Dimm City Plugin Markers

The Dimm City plugin (`dimm-city-plugin.js`) extends the `@` marker system with game-specific block wrappers. These markers auto-close any previously open block of the same type.

| Marker | Closes on | Purpose |
|--------|-----------|---------|
| `@sidebar class="…"` | `@end-sidebar` | Wraps content in a `dc-sidebar` sidebar |
| `@end-sidebar` | — | Explicitly closes the current sidebar |
| `@specialty {.classname}` | Next `@specialty` or `@end-specialty` | Wraps a full specialty section; class sets the specialty code (`.augmerc` → `AUG`) |
| `@end-specialty` | — | Explicitly closes the current specialty block |
| `@sidebar-box` | `@end-sidebar-box` | Wraps content in a `dc-prose-panel dc-sidebar-box` callout |
| `@end-sidebar-box` | — | Explicitly closes the current sidebar box |
| `@definition` | `@end-definition` | Wraps content in a `dc-prose-panel dc-definition-block` definition callout |
| `@end-definition` | — | Explicitly closes the current definition block |
| `@procedure` | `@end-procedure` | Wraps an ordered list in a `dc-steps` procedure block |
| `@end-procedure` | — | Explicitly closes the current procedure block |
| `@learning-path variant="N"` | Next `@learning-path` or `@end-learning-path` | Groups skill cards under a spray header; path index and code auto-increment |
| `@end-learning-path` | — | Explicitly closes the current learning-path block |
| `@skill variant="N"` | Next `@skill` or `@end-skill` | Starts a skill card; content becomes card body |
| `@end-skill` | — | Closes the current skill card |

**Variant values** — `variant="1"` through `variant="5"` select different clip-path shapes for the skill-card shell and the learning-path shell.

**Optional skill attributes** — `id="slug"` sets an anchor on the card wrapper. For long abilities, use `@continue`.

**Example — skill card:**

```markdown
@skill variant="1"
#### Punishing Counter
> See an opening, ya take it.
1. **0 AP** *Steel Says No:* When an enemy in reach makes a basic attack, your Backbiters knock the strike off line.
2. **2 AP** *Bullet to Blood:* When an enemy you can see makes a ranged basic attack, you slip the shot.
##### Openings are invitations to take a chunk out 'em.
@end-skill
```

**Example — learning path:**

```markdown
@specialty {.augmerc}

@learning-path variant="2"
### Biting Distance
> If you can touch it, you can maul it.
- Punishing Counter
- Rage Hit
- Dirty Work

@skill variant="1"
#### Punishing Counter
> See an opening, ya take it.
1. **0 AP** *Steel Says No:* When an enemy in reach attacks, your Backbiters knock the strike off line.
@end-skill

@end-learning-path
```

---

## Container Blocks

Triple-colon fences wrap content in a styled `<div>`. The word after `:::` sets the container type; `{.class}` applies additional classes.

| Container | Effect |
|-----------|--------|
| `:::two-column` | Two equal CSS columns with column rule |
| `:::three-column` | Three narrow columns — best for short reference entries |
| `@sidebar` | Right-floated aside at 38% width |
| `:::callout` | Styled information panel with labeled type |
| `:::pull-quote` | Large centered excerpt with decorative rules — **deprecated:** use `> [!PULLQUOTE]` instead |
| `:::wrapper {.class}` | Generic wrapper — applies any CSS class |

```markdown
:::two-column
Left column content.
---{.column-break}
Right column content.
:::

@sidebar class="inset"
**Sidebar note.** Supplementary content that doesn't interrupt the body flow.
@end-sidebar

:::callout
<span class="callout-label">Note</span>
Standard informational callout.
:::

> [!PULLQUOTE]
> The measure of good design is whether the reader notices the design at all.
>
> — Design Guide

:::wrapper {.dc-note}
<span class="dc-alert-label">Note</span>
<p>Content gets the `.dc-note` class on its wrapping div.</p>
:::
```

> **Note:** `:::pull-quote` is the legacy container path. Use `> [!PULLQUOTE]` (GFM alert syntax) as the preferred authoring form — it is shorter and consistent with other callout types.

---

## Element Attributes

`markdown-it-attrs` adds `{#id .class attr="value"}` to most elements. Attribute block must immediately follow the element with no space.

```markdown
## Section Heading {#my-anchor .custom-class}
![Alt text](image.png){.img-float-right}
This sentence has a **key term**{.custom-span} highlighted.
```

---

## Standard Markdown

All GFM features are available. Smart typography is enabled by default.

**Inline:** `**bold**` · `*italic*` · `***bold italic***` · `` `code` ``

**Headings:** `# H1` (chapter title) · `## H2` (section, accent border) · `### H3` (sub-section) · `#### H4` (item heading, uppercase small)

```markdown
- Unordered list item      1. Ordered list item
  - Nested item               2. Second item

> Blockquote text.         | Col A | Col B |
> — Attribution            |-------|-------|
                           | A     | B     |
```

````markdown
```language
Fenced code block.
```
````

---

## Smart Typography

Auto-converts common ASCII sequences to proper typographic characters. No manual Unicode entry required.

| Input | Output | Name |
|-------|--------|------|
| `--` | – | En dash |
| `---` | — | Em dash |
| `...` | … | Ellipsis |
| `"text"` | "text" | Curly double quotes |
| `'text'` | 'text' | Curly single quotes |

---

## Footnotes

Footnotes are supported via `markdown-it-footnote`. References appear inline at the point of use; definitions can be placed anywhere in the file and render at the end of the content flow.

**Syntax** — `[^label]` inline + `[^label]: definition` anywhere in the file.

```markdown
Here is a sentence with a footnote.[^fn-1]

A second sentence references a different note.[^fn-2]

[^fn-1]: The footnote definition. Can go anywhere in the source file.
[^fn-2]: A second, independent footnote. Labels can be numbers, words, or abbreviations.
```

---

## See It In Action

These examples show the above markdown syntax and plugin markers used in real book pages using actual Dimm City Field Guide content.

- [Front Matter & TOC](#ch-example-front-matter) — page markers, `@chapter`, front-matter class
- [Chapter Openers](#ch-example-chapter-opener) — `@chapter-opener`, `@specialty`, two-column with column-break
- [Specialty Profile](#ch-example-specialty-profile) — `@learning-path`, `@skill`, `@continue` in context
- [Rules & Mechanics](#ch-example-rules) — container blocks, element attributes, outcome macro
- [Dream Master Pages](#ch-example-dm-npcs) — `@section`, sidebar containers, NPC stat block authoring
