# The Contextual Cascade Principle

**The recommended CSS architecture pattern for Gutterpress projects.**

This document explains the pattern, why it exists, and how to apply it. For a worked end-to-end implementation, see the [design-guide example](../examples/with-design-guide/design-guide/).

---

## TL;DR

Authors write **semantic markdown** — no styling decoration on tables, paragraphs, headings, or images. They wrap content in `@section .dc-NAME` to opt into a named component variant.

Components are defined in **one CSS file** (typically `dc-components.css`) and expose their look via **CSS custom properties** with sane defaults. The components consume their own variables; the bare element selectors work everywhere.

Per-book overrides live in a project's **override CSS** (typically `fg-overrides.css`) and use **natural selector chains from the document's structure** — `#chapter-id`, `.page.template-name`, `.section.dc-component` — to set the custom properties that drive variants.

```markdown
@section .dc-citizen-file       ← author opts into the component
| Name | Value |                ← plain markdown table
|------|-------|
| Strength | 12 |
@end-section
```

```css
/* Component — dc-components.css. Looks right anywhere. */
.section.dc-citizen-file table {
  --dc-data-table-th-display: none;
  --dc-data-table-cell-padding: 3pt 4pt;
}

/* Optional per-book override — fg-overrides.css. Used only when one
   chapter wants the same component to look slightly different. */
#ch-fast-play .section.dc-citizen-file table {
  --dc-data-table-cell-padding: 2pt 3pt;  /* tighter for the quickstart */
}
```

---

## Why this pattern

Other approaches break down quickly in print/long-form authoring:

| Anti-pattern | What it costs |
|---|---|
| Per-element class attributes (`{.dc-table-blue}` on every table) | Authors retype variant intent dozens of times per chapter. Markdown becomes noisy. Changing a variant means find/replace across MD files. |
| Utility variant classes on wrappers (`.dc-accent-blood` on `@chapter`) | Same as above one level up. The class is meta-styling vocabulary the author has to learn AND repeat. |
| HTML wrappers in markdown (`<div class="warning">...</div>`) | Defeats the purpose of using markdown. Breaks markdown lint, formatters, and tooling that doesn't understand the HTML. |
| Raw element styling deep in chapter-context CSS (`.page.chapter-04 h4 { color: red }`) | Component styling is now coupled to chapter context. Drop the section into chapter 5 and it loses its look. Not reusable across books. |

The Contextual Cascade pattern solves these by inverting where the styling intent lives:

- **In the markdown:** only the section component name. Stable across projects, books, chapters.
- **In the CSS:** the section component selector + optional natural selector chain (chapter id → page template → section) to scope per-book overrides.
- **In the component:** CSS custom properties that any ancestor context can set without touching the component's own rule body.

The result: markdown is **portable** (the same section can move between books and look the same), CSS is **composable** (new variants = new rules, not retrofits), and authors **don't have to learn** the styling vocabulary — they pick from a menu of section component names.

**The scope of the per-element anti-pattern — and the image exception.** The
first anti-pattern above condemns per-element classes as a vehicle for
*variant/component identity* — restyleable intent that should live in CSS
context. Core's `gp-*` image classes (`{.gp-right .gp-small}` — see the user
guide's Chapter 3) are not that: which side an image sits on and how large
it prints is *per-instance layout intent*, a decision made once per image by
the author, exactly like the paragraph order it sits in. There is no "change
every gp-right in chapter 4" scenario for a context rule to absorb. Placement
classes on images are therefore the sanctioned surface, not a violation —
the anti-pattern still applies the moment a class starts naming a *look*
(`{.dc-photo-vintage}`) rather than a *placement*.

---

## The three layers of context

`@section .dc-X` is the **minimum viable parent** for a variant. Chapter and page selectors are layered on top only when a variant needs scope-specific overrides.

| Layer | Macro | CSS selector | When you use it |
|---|---|---|---|
| **Section** ★ | `@section .dc-component-name` | `.section.dc-component-name` | Always. The canonical handle for any component variant. Works in any chapter, any page, even outside a chapter. |
| **Page** | `@page .template-name` | `.page.template-name` | When a variant repeats across **every section on a given page template**, or for print-page concerns (running headers, page geometry). |
| **Chapter** | `@chapter #ch-name ch="N"` | `#ch-name` | When a variant repeats across **every section/page in a chapter**, or for chapter-wide identity (accent color, counter context). |

### Progressive cascade in action

```css
/* Section component baseline — reusable across any book */
.section.dc-fiction-excerpt {
  --dc-fiction-margin: 0.5in;
}
.section.dc-fiction-excerpt p {
  font-style: italic;
  margin-left: var(--dc-fiction-margin);
}

/* Page-template override — slightly different margin on full-bleed art pages */
.page.full-bleed .section.dc-fiction-excerpt {
  --dc-fiction-margin: 0.25in;
}

/* Chapter override — one specific chapter wants the fiction in a different color */
#ch-prologue .section.dc-fiction-excerpt p {
  color: var(--ink-smoke);
}
```

You only write the layers you actually need. Most components only ever need their section-level rule.

---

## Building a library of section components

Each section component bundles a complete variant — typography, table styling, callout colors, image sizing, etc. — keyed off a single class. Adding a section component to a book is just:

```markdown
@section .dc-citizen-file        ← character profile form styling
@section .dc-npc-stat            ← NPC stat block styling
@section .dc-card-grid           ← compact card grid layout
@section .dc-fiction-excerpt     ← prose excerpt styling
```

Authors reuse these across pages, chapters, and books without needing to know anything about the CSS. New variants in a project = new `.dc-something` section component added to your project's `dc-components.css`, available everywhere it's referenced.

---

## Authoring rules (what NOT to do)

- ❌ **No per-element class attributes for styling.** `{.dc-warning}` on a paragraph, `{.compact}` on a table, `{.large}` on an image — all forbidden. Variants come from the section.
- ❌ **No utility variant classes on `@chapter`, `@page`, or `@section`.** `.dc-accent-blood` is a variant label the author has to retype. Use semantic names (component names, chapter ids, page template names) and let the CSS read the structure.
- ❌ **No raw HTML in markdown.** No `<div>`, `<span class="...">`, etc. for styling. Use macros and section components instead.
- ❌ **No raw values in per-book selector chains.** Always set a component's CSS custom property, never a raw color/spacing value. The component owns its own rules; per-book CSS only chooses variants.

---

## Worked example: a custom callout variant

You want chapter 4 of your book to render `> [!NOTE]` callouts with a blood-red accent instead of the default hud-blue. Here's how it goes:

**1. Author writes normal markdown — no decoration:**

```markdown
@chapter #ch-rules ch="4"

> [!NOTE]
> Combat starts when initiative is rolled.
```

**2. The default callout component (in `dc-components.css`) already reads from a custom property:**

```css
.dc-callout {
  border-left: 3px solid var(--dc-callout-accent, var(--hud-blue));
  background: var(--dc-callout-bg, var(--paper-stain));
}
```

**3. Your book-specific override in `fg-overrides.css` sets the property via the chapter id:**

```css
#ch-rules .dc-callout {
  --dc-callout-accent: var(--blood);
}
```

That's it. Every `> [!NOTE]` in chapter 4 — and every future one added — picks up the blood accent automatically. No markdown changes. No class application. One CSS rule.

If you later decide ALL callouts on `.page.combat-summary` pages should have a thicker border, you'd add:

```css
.page.combat-summary .dc-callout {
  --dc-callout-border-width: 5px;
}
```

And the component picks it up the same way.

---

## Worked example: a section component carrying multiple sub-rules

The `.dc-citizen-file` section component in the DC design guide demonstrates a section that bundles styling for `h4`, `p`, `table`, `td`, `thead` — all elements inside it adapt:

```markdown
@section .two-column .col-split .dc-citizen-file

#### Name
Choose a name.

#### Species
You're not human...

| | |
|-------|-------|
|  | childhood |
|  | adolescence |

@end-section
```

In `dc-components.css`:

```css
.dc-citizen-file h4 { /* form label styling */ }
.dc-citizen-file p { /* form helper text styling */ }
.dc-citizen-file thead { display: none; }    /* hide markdown table headers */
.dc-citizen-file td:first-child { /* checkbox cell styling */ }
/* ... etc */
```

Authors write `@section .two-column .col-split .dc-citizen-file` once and **every element inside it** picks up form-styling. The same section component dropped into any other chapter/page/book produces the same character-sheet look — no setup required.

See the [design-guide example](../examples/with-design-guide/design-guide/) for a worked implementation of components and their markdown usage.

---

## Adopting this pattern in your Gutterpress project

1. **Components live in one file**, conventionally `css/dc-components.css` (or `css/<your-brand>-components.css`). Each component is `.section.dc-X` plus its descendant rules.

2. **Default values use `var(--dc-X, fallback)`** so components work without any per-book setup, but expose every variant axis as a CSS custom property.

3. **Per-book overrides go in a separate file**, conventionally `css/fg-overrides.css` (or `css/<book-name>-overrides.css`), and use natural selector chains (`#ch-id`, `.page.template`, `.section.dc-component`) to set the component's custom properties.

4. **Authors write semantic markdown only.** Section names describe purpose (`.dc-citizen-file`, `.dc-npc-stat`, `.dc-fiction-excerpt`), not appearance.

5. **New variant needed?** Add ONE rule in the overrides file. Markdown stays untouched.

---

## Reference: the design-guide example

The [`with-design-guide`](../examples/with-design-guide/) example is the reference implementation of this pattern. It demonstrates:

- A layered stylesheet (`design-guide/styles/guide.css`) built on a
  custom-property token layer (`--color-*`, `--font-*`, `--fs-*`) that the
  component rules consume
- Named component classes (`.callout`, `.callout-note`, `.cover-*`, `.chapter-*`)
  that authors opt into from markdown
- The full markdown-author authoring surface across its numbered chapters

Note that this example does not use the `.section.dc-*` / `var(--dc-X, fallback)`
naming from the illustrations above; it uses the brand-agnostic
`--color-*`/`.callout-*` vocabulary instead. The *shape* of the pattern is the
same — a token layer, component rules that consume it, and per-book overrides
that reset the tokens — only the prefix differs.

Files to study:
- [`design-guide/styles/guide.css`](../examples/with-design-guide/design-guide/styles/guide.css) — the token layer and the component rules that consume it
- [`design-guide/03-components.md`](../examples/with-design-guide/design-guide/03-components.md) — markdown demonstrating the component authoring patterns
- [`design-guide/06-markdown-reference.md`](../examples/with-design-guide/design-guide/06-markdown-reference.md) — the full author-facing markdown surface

---

## Glossary

- **Section component** — a `.dc-X` class applied to an `@section` wrapper that brings a complete variant for the elements inside it.
- **Component custom property** — a CSS variable like `--dc-callout-accent` that a component reads via `var()` and any ancestor context can set.
- **Per-book override** — a CSS rule in the project's overrides file that uses a chapter id / page template / section component selector chain to set component variables for that specific book's needs.
- **Natural selector chain** — a CSS selector composed from the document's existing semantic structure (chapter id, page template class, section component class) without inventing new utility classes.
