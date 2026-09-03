# {{NAME}}

> {{DESCRIPTION}}

A Gutterpress **theme** — a layered CSS architecture, not a look. The colours
and the typeface are placeholders you will replace in an afternoon; the
arrangement of the files is the part worth keeping.

```
{{SLUG}}/
├── gutterpress.json          what this package declares to Gutterpress
├── components.yaml           the catalog: what an author can opt into
├── snippets/                 insertable recipes for the components
└── styles/
    ├── tokens.css            :root only. Palette, type, spacing.
    ├── base.css              element baseline. Bare p/h2/table/code.
    ├── components.css        named components + their public tokens.
    ├── page-templates.css    .page.* layouts — arrangement WITHIN a page.
    ├── page-rules.css        @page geometry, margin boxes, running heads.
    └── book.css              this book's overrides. Loads last.
```

Every file opens with an **OWNS / MUST NOT CONTAIN** header. Those headers are
the actual contract — they live in the files precisely so they travel with the
code instead of sitting in a document nobody opens at the moment they are
about to add a rule to the wrong sheet.

## Try it

```sh
gutterpress theme import ./{{SLUG}} ../my-book
gutterpress theme apply {{SLUG}} ../my-book
gutterpress preview ../my-book
```

Both theme commands take the book directory as their second POSITIONAL
argument, not a `--dir` flag.

Then in a chapter:

```markdown
@section .{{PREFIX}}callout
### Before you start
Everything in here stays together on one page.
@end-section
```

## Why six files

Gutterpress ships three built-in themes of about sixty lines each. They style
bare elements and stop, which is the right size for a plain book and is not an
architecture. The first book that needs components outgrows one in a week, and
then re-derives this arrangement from scratch — badly, usually twice.

The split is by OWNERSHIP, and the value is that it answers one question
instantly: **where does this rule go?**

| I want to change… | File |
|---|---|
| the brand — a colour, a typeface, the type scale | `tokens.css` |
| what a plain paragraph or table looks like | `base.css` |
| a named thing an author opts into | `components.css` |
| how one page arranges its content | `page-templates.css` |
| margins, folios, running heads | `page-rules.css` |
| one chapter of one book | `book.css` |

If a rule seems to belong in two of them, it is usually two rules.

## The token pattern

This is the mechanism the whole architecture rests on, demonstrated end to end
by the callout component:

```css
/* tokens.css — the brand */
:root { --{{PREFIX}}accent: #2f5d8a; }

/* components.css — the component's own public token, then bare consumption */
:root { --{{PREFIX}}callout-accent: var(--{{PREFIX}}accent); }
.{{PREFIX}}callout { border-inline-start: 3px solid var(--{{PREFIX}}callout-accent); }

/* book.css — one chapter wants a different one */
#ch-appendix { --{{PREFIX}}callout-accent: var(--{{PREFIX}}accent-warm); }
```

Three properties make it work, and losing any one of them collapses it:

1. **The default lives at `:root`, exactly once.** So the component looks
   right in any book with no setup, and there is one place to change it.

2. **Components consume `var(--x)`, never `var(--x, fallback)`.** An inline
   fallback is a second copy of the default. It will drift from the `:root`
   one, and when it does the component will look correct everywhere except
   the one place somebody overrode the token.

3. **Overrides only ever RESET a token.** Never
   `#ch-appendix .{{PREFIX}}callout { border-color: … }`. The token is the
   seam between "what the component is" and "what this book wants"; writing
   past it welds them together, and the next change to the component breaks
   the book.

A variant is the same move made inside the package:
`.{{PREFIX}}callout-warning` resets one token and inherits everything else.

## The conventions that are load-bearing

### 1. One prefix, and it is yours

Every component class, page-template class and custom property here starts
with `{{PREFIX}}`. A book loads core, this theme and any number of plugins
into one flat CSS namespace; nothing scopes them for you.

`gp-` is reserved for Gutterpress core — taking it silently overrides core's
own vocabulary.

`base.css` is the deliberate exception: styling bare `p` and `table` is
exactly a theme's job, because a theme IS the book's look. A PLUGIN doing the
same thing would be leaking its opinions into every book that installed it.
That asymmetry is the whole difference between the two kinds of package.

### 2. Declare the layer order once, and adopt it per whole sheet

`tokens.css` opens with:

```css
@layer tokens, base, components, templates, pages, book;
```

Each sheet then puts everything it owns inside its layer. The cascade is
settled by that one line rather than by which file `styles:` lists last, so
splitting a sheet or reordering the manifest can no longer silently flip who
wins.

The trap, and it catches everyone once: a rule left OUTSIDE all the layers is
fully unlayered, and unlayered CSS beats layered CSS at any specificity. So
one stray rule at the bottom of `components.css` will out-rank every rule in
`book.css`. Adopt the convention for a whole sheet at a time.

These layers are unlayered relative to Gutterpress core (which uses
`gp.marker` and `gp.vocab`), so every rule here still beats core exactly as it
did before layers existed.

### 3. Authors write semantic markdown

The author's entire styling vocabulary is the component name:
`@section .{{PREFIX}}callout`. Not `{.blue}` on a paragraph, not `{.compact}`
on a table, not a `<div>`.

The reason is maintenance, not purity: a variant expressed as a class the
author retypes must be found and replaced across every chapter when it
changes. A variant expressed as a component name plus a CSS rule changes in
one place, and chapters written afterwards get it for free.

### 4. `@page { size }` is not optional, and it must match the manifest

`page-rules.css` opens by declaring the trim:

```css
@page { size: 6in 9in; }
```

That line is load-bearing in the most literal sense. With no `size:` anywhere
in the book's CSS, Chromium falls back to US Letter and prints the whole book
at the wrong trim, with no error — this is the one failure in the stack that
costs money rather than time.

The manifest's `preset:`/`page:` remains the source of truth: it is what
`gutterpress validate` measures the produced PDF against, and what the publish
targets check. The CSS line is the instruction that satisfies it. Change one,
change the other — and let validate catch you when you forget.

### 5. Keep the catalog honest

`components.yaml` enumerates what an author can opt into and which tokens are
public. Anything not listed there is internal and may change.

Nothing in core reads the entries yet, so it is a discipline rather than a
check — which is exactly why adding the entry at the same moment you add the
component is worth the habit.

## Further reading

- `docs/contextual-cascade-principle.md` — the pattern these files implement,
  with more worked examples.
- `docs/native-engine-styling-guide.md` — cascade layers, `@page`, GCPM, and
  what the engine does with them.
