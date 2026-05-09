# Page templates

The book uses three primary page templates, controlled via the `@page`,
`@break`, and `@spread` directives provided by `markdown-it-paged`.

## Default page

The default `@page` is a single column with 0.75-inch margins on all
sides, page number at the bottom outside corner, and the running header
showing the chapter title.

## Section opener (`@page chapter`)

Each chapter starts with a section opener that drops the running header,
hides the page number, and uses a larger top margin so the chapter title
breathes. Insert one with:

```
@page chapter
```

at the top of the chapter file (after the frontmatter or `# Chapter
Title`).

## Spread (`@spread`)

For full-bleed art or two-page diagrams, use `@spread`. Paged.js will
ensure the layout starts on an even (left) page. Insert one with:

```
@spread
```

## Forced break (`@break`)

Use `@break` to push the next block onto a new page. Useful when the
content needs to land on a recto (right) for visual reasons.

## Sample full page

Add a representative full page of body content here so designers can see
how leading, hyphenation, and widows behave at scale. Lorem ipsum
filler is fine for the guide; what matters is that the rendered visual
matches the production typography.
