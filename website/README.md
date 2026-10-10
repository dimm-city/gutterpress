# website

The Gutterpress project site, published to <https://dimm-city.github.io/gutterpress/>
by `.github/workflows/pages.yml` on every merge to `main`.

It is built with [unify](https://github.com/fwdslsh/unify) on unify's built-in
**blog** template. `unify.yaml` says `extends: blog`, so the template is not
copied here: its files sit beneath `src/`, and a file in `src/` at the same
path replaces the template's.

    npx @fwdslsh/unify@0.11.14 dev                       # build, watch, serve on localhost:3000
    npx @fwdslsh/unify@0.11.14 build --audit --strict    # what CI runs (plus --base-url)

## What's here

- `src/index.html`, `src/404.html` — the home and not-found pages.
- `src/posts/*.md` — blog posts. Frontmatter needs `title`, `description`,
  `date` (with a time, e.g. `2026-10-09T00:00:00Z`, or it is left out of
  `feed.xml`) and `schema: BlogPosting`.
- `src/_layout.html`, `src/_includes/nav.html` — the page chrome, replacing
  the template's.
- `src/assets/theme.css` — the look, as custom properties (unify's theme
  contract): the Dimm City palette from
  [gp-dimm-city](https://github.com/dimm-city/gp-dimm-city).
- `src/assets/stickers.css` — the cut-and-paste paper and sticker rules, in
  the template's `theme` layer so they win over its `base` rules.
  `assets/style.css` itself is the template's.
- `scripts/gen.mjs` — runs before every build and writes `blog.html`, the
  home page's latest-posts list, and `privacy/index.md` from the repository's
  root `PRIVACY.md`. That page must stay at `/privacy/`: Google's OAuth
  consent screen links to it (ADR 0011).
