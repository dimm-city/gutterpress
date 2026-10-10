# website

The Gutterpress project site, published to <https://dimm-city.github.io/gutterpress/>
by `.github/workflows/pages.yml` on every merge to `main`.

It is built with [unify](https://github.com/fwdslsh/unify) on unify's **docs**
template. `unify.yaml` says `extends: unify-docs-template@0.4.0`, so the
template is not copied here: its layout, stylesheet, scripts and All-pages
directory sit beneath `src/`, and a file in `src/` at the same path replaces
the template's. Bump the pin to take a new template release.

    npx @fwdslsh/unify@0.11.14 dev                       # build, watch, serve on localhost:3000
    npx @fwdslsh/unify@0.11.14 build --audit --strict    # what CI runs (plus --base-url)

## What's here

The files the template names as a site's own:

- `src/_includes/head.html`, `nav.html`, `docnav.html` (the sidebar),
  `footer.html`.
- `src/assets/theme.css`: the look, as the template's custom properties. The
  values are the Dimm City palette from
  [gp-dimm-city](https://github.com/dimm-city/gp-dimm-city).
- The pages: `src/index.html` (`class="home"`), `src/guide/*.md`,
  `src/releases/*.md` and `src/404.html`. Link a new page from
  `docnav.html`; `unify audit` fails on a page nothing links to.

And two additions:

- `src/assets/paste-up.css`: the cut-and-paste paper and sticker rules
  (after gp-dimm-city's chrome and card components), in the template's
  `theme` layer so they win over its `base` rules. `head.html` links it.
- `src/assets/share-placeholder.png`: the site's share card, at the path the
  template's layout names for it.

`scripts/gen.mjs` runs before every build and writes `privacy/index.md` from
the repository's root `PRIVACY.md`. That page must stay at `/privacy/`:
Google's OAuth consent screen links to it (ADR 0011).
