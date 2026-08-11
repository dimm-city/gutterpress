# Migration: image utility classes are now `gp-*` (2026-08-11)

The five original image/block utility classes were **removed** and replaced
by the composable `gp-*` image vocabulary (positions + sizes + spacing +
shape + pin — see the user guide's Chapter 3, "Common image classes").
There are no aliases: a book still using the old names renders those images
as plain inline images (the classes attach, but no CSS matches them any
more).

## What changed

| Removed class | Write instead |
|---|---|
| `.center` | `.gp-center` |
| `.float-left` | `.gp-left` |
| `.float-right` | `.gp-right` |
| `.full-width` | `.gp-full` |
| `.full-bleed` | `.gp-bleed` |

The replacements are not just renames — they compose with the new axes:

- **Sizes**: `.gp-small` / `.gp-medium` / `.gp-large` (25/50/75% of the
  column; an explicit size overrides the floats' 50% cap).
- **Spacing**: `.gp-tight` / `.gp-loose` float clearance presets (or set
  `--gp-gap` directly in your stylesheet).
- **Shape**: `.gp-shape` wraps text to a floated image's alpha silhouette.
- **Pin**: `.gp-pin` (+ `.gp-top`/`.gp-bottom`/`.gp-left`/`.gp-right`)
  pins an image within its `@page`/`@spread` container.

## How to migrate

Find-and-replace the class names inside `{…}` attribute blocks in your
markdown:

```
{.center}      →  {.gp-center}
{.float-left}  →  {.gp-left}
{.float-right} →  {.gp-right}
{.full-width}  →  {.gp-full}
{.full-bleed}  →  {.gp-bleed}
```

The desktop editor helps: right-click an image → "Set position…" recognizes
the old name and rewrites it to the `gp-*` class in place.

If your own **stylesheet** targets the old names (e.g. `.float-left { … }`
overrides), rename those selectors too — or keep them: author CSS loads
after core CSS, so a book that deliberately defines its own `.float-left`
keeps behaving exactly as that book's CSS says. Only the core-supplied
rules are gone.

## Why no aliases

One vocabulary. Keeping the old five as permanent aliases would have meant
two ways to spell every layout forever — in docs, in the editor UI, in
every book that copies an example — for the cost of a five-line
find-and-replace. The `gp-` prefix is core's documented namespace, so the
new names also can't collide with a book's own utility classes the way
bare `.center` could.
