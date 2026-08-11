# Migration: `.gutterpress-continued` is now `.md-continued` (2026-08-11)

`@continue` closes the currently open `@section` and reopens a matching one,
tagging the reopened block with an extra class. That class was
`gutterpress-continued`; it is now **`md-continued`**.

## What changed

```html
<!-- before -->
<div class="section gutterpress-continued" data-section="Notes">
<!-- after -->
<div class="section md-continued" data-section="Notes">
```

## How to migrate

Only books that **style** the class need to do anything — rename the selector:

```css
.gutterpress-continued { … }   →   .md-continued { … }
```

Nothing else changes: the marker, the DOM shape, `data-section`, and the
"reopen without repeating the heading" behaviour are all identical.

## Why

`@continue` is a `markdown-it-paged` marker, and that plugin is published
standalone — it is not Gutterpress. Every other class it emits already uses
the plugin's own `md-` prefix (`md-page-break`, `md-column-break`), so
`gutterpress-continued` was the one place the plugin branded its output with
a consumer's name. Renaming it makes the plugin's emitted DOM consistent and
leaves nothing in it that only makes sense inside Gutterpress.

See also `docs/migrations/2026-08-gp-image-classes.md` — the same principle,
applied to the author-facing image vocabulary.
