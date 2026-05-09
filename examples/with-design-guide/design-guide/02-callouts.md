# Callouts and asides

print-md ships with markdown-it container syntax for asides and named
callouts. Use these consistently across the book — the design guide is
the place to lock in the conventions.

## Sidebar

A sidebar is a longer aside, typically 50–150 words, that runs alongside
the main text. Use it for designer's notes, behind-the-scenes commentary,
or a worked example that breaks the body's flow.

::: sidebar
Sidebars get their own visual treatment — usually a tinted background and
a different typeface — so the reader can dip in and out without losing
their place in the body. Keep them tight.
:::

## Wrapper

A wrapper is a generic container without a specific visual treatment,
useful for grouping related content for layout or pagination.

::: wrapper
Anything inside a wrapper is treated as a single block by Paged.js, which
helps keep related paragraphs together across page breaks.
:::

## Specialty

A `specialty` callout is for highlighting a specific named concept —
useful in TTRPG modules, technical handbooks, or cookbooks. Replace this
with whichever named callouts your book actually uses.

::: specialty
Used for one-shot named items: a spell, a recipe, a function signature.
:::

## What to add to your guide

This page is a starter — add a section for every container or attribute
your manuscript actually uses. The guide is most valuable when it's an
exhaustive reference for what works.
