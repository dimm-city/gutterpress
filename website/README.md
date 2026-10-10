# website

The Gutterpress project site, published to <https://gutterpress.dimm.city/>
by `.github/workflows/pages.yml` on every merge to `main` that touches this folder,
the user guide or `PRIVACY.md`.

It is built with [unify](https://github.com/fwdslsh/unify) on unify's **docs** template,
laid out the way unify's own documentation site (<https://unify.fwdslsh.dev/>,
`examples/unify-docs` in the unify repository) is: `site/` beside `scripts/gen.mjs` and
`unify.yaml`. The template is **extended**, not copied (`extends:
node_modules/unify-docs-template`; `package.json` pins it and the unify CLI).

    npm ci
    npx unify dev                       # build, watch, serve on localhost:3000
    npx unify build --audit --strict    # what CI runs

## It renders the real user guide, not a copy

`scripts/gen.mjs` publishes `examples/gutterpress-user-guide/` at every build through the
docs template's importer: each chapter lands at `docs/<name>` (its number prefix
dropped), a link leaving the guide goes to GitHub, and the book's cover, table of
contents and manifest are left out. Edit a chapter and the site changes on the next
build. Two things that only make sense in one printed book are adapted for web pages:
Gutterpress layout markers (`@section .lede`, `@end-section`) are dropped, and `{#id}`
anchors become links to the page and heading unify publishes. The script also writes the
sidebar (`_includes/docnav.html`), the docs index (`docs/index.md`) and the privacy page
(`privacy/index.md`, from the root `PRIVACY.md`; it must stay at `/privacy/` because
Google's OAuth consent screen links to it, ADR 0011).

## What is this site's own

- `site/_includes/head.html`, `nav.html` and `footer.html`, the files that name it.
- `site/assets/theme.css`: the template's custom properties, set for the look: a 1920s
  newsroom paste-up after dark, in the Dimm City inks (riso black and crimson, from
  [gp-dimm-city](https://github.com/dimm-city/gp-dimm-city)).
- `site/assets/site.css`: the paste-up itself — galleys of yellowed newsprint pasted up on a
  dark desk under a lamp, taped down, with typed notes, a rubber stamp and red grease
  pencil. It is unlayered, so it wins over the template's layered stylesheet.
- Its own pages: `index.html`, `install.md`, `about.md`, `releases/*.md`, `404.html`, and
  `plugins.html`, which searches npm in the browser the way the desktop app does (one query
  per keyword, `gutterpress` and `markdown-it-plugin`), after unify-docs' templates page.
- `site/assets/share-placeholder.png`, the share card, at the path the template's layout
  names.
