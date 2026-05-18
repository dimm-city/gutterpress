# Core Directives Reference

Print-md controls page layout through **Layout Markers** — `@` markers for page breaks
and content grouping, provided by `markdown-it-paged`.

> **Note:** The `:::name ... :::` triple-colon container block syntax was removed
> 2026-05-17. See
> [docs/migrations/2026-05-removing-container-syntax.md](migrations/2026-05-removing-container-syntax.md)
> for the migration path. The canonical author surface is the `@`-marker family documented below.

## Layout Markers

### @page

Starts a new page. Optionally accepts CSS class names:

```markdown
@page

Content starts on a new page.

@page chapter

Content starts on a new page with the "chapter" CSS class.

@page chapter right-align

Multiple classes can be combined.
```

Emits: `<div class="page">` (or `<div class="page chapter">`, etc.)

### @page-break

Forces a hard page break without wrapping content. Use `@end-section` to close
an open `@section` without a page break.

```markdown
Some content here.

@page-break

This starts on the next page.
```

Emits: `<div class="md-break"></div>`

### @spread

Starts a two-page spread group. Content within a spread is logically grouped:

```markdown
@spread

## Map Section

![World Map](assets/map.png){.full-width}

Additional map details...
```

Emits: `<div class="spread">`

### @section

Groups content to avoid page breaks within the section. Close with `@end-section`:

```markdown
@section

## Character Stats

| Stat | Value |
|------|-------|
| HP   | 45    |
| AC   | 16    |

This table and heading stay together on one page.

@end-section
```

Emits: `<div class="region">`

### @column-break

Forces a column break inside a multi-column section:

```markdown
@section .two-column

First column content.

@column-break

Second column content.

@end-section
```

### @end-section

Closes the current open `@section` or `@page` without starting a new page:

```markdown
@section

Content grouped here.

@end-section

Content after the section, same page.
```

## Preventing Page Breaks

Use `@section` to keep content together:

```markdown
@section
This content will try to stay together on one page
and avoid breaking across pages.
@end-section
```

Or in custom CSS:

```css
.keep-together {
  break-inside: avoid;
  page-break-inside: avoid;
}
```

## Quick Syntax Reference

### Layout Markers

```markdown
@page                         Start a new page
@page chapter                 New page with CSS class
@page-break                   Hard page break
@end-section                  Close current @section or @page
@spread                       Start a two-page spread
@section                      Group content (avoid breaks)
@column-break                 Force a column break (inside multi-column sections)
```

## Implementation Notes

- Layout markers (`@spread`, `@page`, `@section`, `@end-section`, `@page-break`, `@column-break`) are provided by the inlined `markdown-it-paged` plugin (`packages/cli/src/lib/markdown/markdown-it-paged.js`)
- The `implicitPage` option defaults to `false`, so `@section` outside an open `@page` does not get an implicit page wrapper
- CSS classes `.page`, `.spread`, `.section`, `.md-page-break`, `.md-column-break` are emitted directly by the plugin and styled via the inlined `PAGED_CSS` named export
- H1 headings automatically create page breaks and set running headers
