# Migration: removing `:::` container syntax (2026-05-17)

Gutterpress used to ship `markdown-it-container`, which parsed triple-colon
fences (`::: name ... :::`) into a `<div class="name">` wrapper. That plugin
and syntax were **removed** on 2026-05-17. The `@`-prefixed marker family
already built into core (`@page`, `@section`, `@end-section`, `@column-break`,
etc. — implemented in `packages/cli/src/lib/markdown/markers.js`, which was
called `markdown-it-paged` when this was written) is the canonical way to wrap
a block of markdown in a styled `<div>`.

## Why

- `@section` already gives every named container the same capability — an
  addressable `#id` and arbitrary `.class` names — with no separate plugin, no
  per-container registration step, and no Gutterpress-specific plugin API (see
  rule 5 in `CLAUDE.md`). (Keeping a block off a page break is your CSS, not
  the marker: core does not apply `break-inside: avoid` to `.section`. Give the
  section a class and write the rule, as the examples' `.no-break` does.)
- Two competing block-wrapping syntaxes (`:::name` and `@section`) added
  author confusion without adding capability.

## Mapping

| Old (`:::` container) | New (`@` marker) |
|---|---|
| `::: sidebar` … `:::` | `@section .sidebar` … `@end-section` |
| `::: callout-note` … `:::` | `@section .callout-note` … `@end-section` |
| `::: pull-quote` … `:::` | `@section .pull-quote` … `@end-section` |
| `::: two-column` … `:::` | `@section .gp-columns-2` … `@end-section` |
| `::: container` … `:::` (avoid page break) | `@section .no-break` … `@end-section`, plus your own `.no-break { break-inside: avoid }` rule |
| `::: container {.my-class}` … `:::` | `@section .my-class` … `@end-section` |
| `---{.column-break}` | `@column-break` |
| Registering a custom container in `src/lib/markdown/index.ts` | Not needed — `@section` accepts any CSS class directly |

Any content that was inside a `:::` fence purely for HTML wrapping (no
page-break requirement) doesn't need a wrapper at all — standard markdown
already renders raw HTML blocks (e.g. `<div class="spec-block">...</div>`)
as-is.

## Manifest field

`validate.source.allowedCallouts` gated a callout-name validation check that
only made sense for the container-syntax registration model. It is now a
no-op — the field is kept in the schema so older manifests still parse, but
it has no effect. It can be deleted from your `manifest.yaml`; Gutterpress
prints a one-time deprecation warning if it's left in place with entries.

## See also

- [User Guide: Chapter 2 — Writing Your Content](../../examples/gutterpress-user-guide/02-writing-content.md) for the full `@` marker reference, including the core `.gp-columns-2`/`.gp-columns-3` column vocabulary
- [User Guide: Chapter 5 — Plugins](../../examples/gutterpress-user-guide/05-plugins.md) for the plugin pipeline these markers are part of
