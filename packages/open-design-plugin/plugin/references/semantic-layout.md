# Semantic layout

The stable Gutterpress authoring surface, and the CSS habits that survive
pagination. Verified against the Gutterpress source that ships this package,
2026-07-28.

## Markers

`markdown-it-paged` is the layout primitive layer. Markers are lines beginning
with `@`, and the plugin is inert in a document that uses none of them.

```text
@chapter  [name] [key=value ...] [#id] [.class ...]
@spread   [name] [key=value ...] [#id] [.class ...]
@page     [name] [key=value ...] [#id] [.class ...]
@section  [name] [key=value ...] [#id] [.class ...]
@continue
@end-section
@page-break
@column-break
```

What they emit:

| Marker | Output |
|---|---|
| `@chapter` | `<div class="chapter …">`, plus `data-chapter-label` when named |
| `@spread` | `<div class="spread …" data-spread="name">` |
| `@page` | `<div class="page …" data-page="name">` |
| `@section` | `<div class="section …" data-section="name" data-region="…">` |
| `@continue` | closes the open `@section` and opens a matching continuation |
| `@end-section` | closes the nearest open `@section` |
| `@page-break` | `<div class="gp-page-break" aria-hidden="true">` |
| `@column-break` | `<div class="gp-column-break" aria-hidden="true">` |

A chapter's label propagates to its child pages as `data-chapter-label`, so CSS
can reach it from any descendant with `attr(data-chapter-label)` — that is the
supported way to render running chapter chrome, not a hand-maintained duplicate
on every `@page`.

Markers are the canonical block surface. The `:::name … :::` container syntax
was removed in May 2026 — do not reintroduce it or write Markdown that assumes
it.

## Prefer semantics to presentation

Reach for these in order:

1. An existing CSS custom property in the stylesheet that owns the component.
2. An existing reusable component rule.
3. A new **semantic** class on a marker (`@section .stat-block`) plus a rule for
   it in a stable stylesheet.
4. Raw presentational HTML in the Markdown — last resort only, and never as a
   substitute for a rule that a class could carry.

Custom properties are how a variant stays reusable: define the knobs once on the
component, then set them in a modifier class rather than duplicating the whole
rule.

## Contextual Cascade

Gutterpress's general CSS architecture pattern is documented in
[`docs/contextual-cascade-principle.md`](https://github.com/dimm-city/gutterpress/blob/main/docs/contextual-cascade-principle.md),
with a worked example under `examples/with-design-guide/`. The short version:
a component defines its own defaults, and *context* (an ancestor section, page,
or chapter class) adjusts them by re-setting custom properties — not by writing
a more specific override of every declaration.

## Selectors that do not survive pagination

Pagination rewrites the document into generated page/sheet boxes. Never target
that generated structure:

- **No engine-generated selectors** (`.gp-*` sheets, strips, and margin
  boxes). They describe a layout artifact, not your content, and they change
  with the engine.
- **No page-ordinal targeting.** "The third page" is an output of pagination;
  styling it changes pagination, which changes which page is third.

`gutterpress lint` additionally flags, as an error, **remote `url()`** —
`http(s)://` and protocol-relative references, which may not be reachable at
print time. And it warns on properties that can force rasterization in print:
`filter`,
`backdrop-filter`, `mix-blend-mode`, `background-blend-mode`, `isolation`,
`animation`, `transition`, `will-change`, `clip-path`.

Ask the user to run `gutterpress lint <book>` after a substantial CSS change.

## Ownership

- **Chapter/page/section chrome** belongs to the stylesheet that owns the
  component — usually the shared component sheet in a multi-book repository.
- **Book-specific positioning and break tuning** belongs to that book's own
  stylesheet, listed last.
- **Generic authoring behavior** — something broadly useful to any author
   writing plain Markdown — belongs in Gutterpress core, not in a per-book override.
  If you find yourself solving the same layout problem in every book, say so in
  your report instead of copying the workaround again.
