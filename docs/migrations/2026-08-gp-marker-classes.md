# Migration: marker classes are now `gp-*` (2026-08-11)

The classes Gutterpress's layout markers emit are now `gp-`-prefixed, matching
the rest of the product's vocabulary.

| Old class | New class | Emitted by |
|---|---|---|
| `md-page-break` | `gp-page-break` | `@page-break` |
| `md-column-break` | `gp-column-break` | `@column-break` |
| `pmd-continued` (v0.8.3 and earlier), later `md-continued` | `gp-continued` | `@continue` |

## How to migrate

Only books that **style** these classes need to act — rename the selectors:

```css
.md-page-break   { … }   →   .gp-page-break   { … }
.md-column-break { … }   →   .gp-column-break { … }
.md-continued    { … }   →   .gp-continued    { … }
.pmd-continued   { … }   →   .gp-continued    { … }
```

Markers, DOM shape, `data-*` attributes and behaviour are all unchanged.

**If you are upgrading from v0.8.3 or earlier, `.pmd-continued` is the class
you have.** It was live in v0.8.3 — the most recent release these classes ever
shipped in — so rename it to `.gp-continued` rather than deleting it. The
intermediate names (`gutterpress-continued`, `md-continued`) only ever existed
between releases; you will only have those if you tracked an unreleased build.

## Why

`markdown-it-paged`, the standalone package this code began as, was **absorbed
into Gutterpress** at 0.10.0. The inlined copy had grown to 812 lines against
upstream's 433 (+88%), was never installed from npm, and carried Gutterpress-only
editor plumbing. Keeping a third-party label on it blocked ordinary cleanup and
left two prefixes (`md-`, `gp-`) meaning the same thing.

There is now one prefix. `markers.js` owns the structural DOM; the author
utility vocabulary lives in `gutterpress-css.ts`. Both are Gutterpress.

This supersedes the short-lived `.gutterpress-continued` → `.md-continued`
rename, which shipped earlier in 0.10.0's pre-release on the assumption that
`md-` belonged to a separate package. Since 0.10.0 has not shipped, `md-continued`
never reached a release; books upgrading from 0.9.x rename directly from
`gutterpress-continued` to `gp-continued`.

The library export also changed: `PAGED_CSS` → `MARKER_CSS`.
