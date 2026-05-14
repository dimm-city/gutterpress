# DC Design Guide — Content Templates Migration Audit

## Purpose

This audit replaces the old redundancy ledger with a current-state migration plan.

Goal:
- remove `css/content-templates.css` from `css/index.css`
- carry forward only rules that are still load-bearing for the design guide
- move surviving rules into the correct owner file
- delete legacy glue that exists only because `content-templates.css` was preserved as historical reference

Success means the design guide still renders correctly after the import is removed, without preserving `content-templates.css` as a permanent architecture layer.

## Target Ownership

Surviving rules should land in one of three places:

| Destination | Owns |
|---|---|
| `dc-brand.css` | reusable Dimm City components, print utilities, and component-owned pagination/layout behavior |
| `page-rules.css` | `@page`, named-page wiring, page wrapper resets tightly coupled to paged-media behavior |
| `guide.css` | design-guide-only specimens, demo page layouts, and example-specific page-template styling |

Delete anything that does not support current canonical authoring or current rendered examples.

## Working Rules

For each selector block currently in `content-templates.css`, apply this test:

1. If it styles a reusable component root or a component-owned utility, move it to `dc-brand.css`.
2. If it is required for paged-media structure or wrapper behavior, move it to `page-rules.css`.
3. If it only exists to make the design guide's demo/example chapters render, move it to `guide.css`.
4. If it only supports retired aliases, obsolete wrapper structures, or historical reference behavior, delete it.

Follow `docs/css-components.md` while moving rules:
- one real base class owns the shell
- variants stay thin
- do not preserve broad internal variable APIs just to keep old structure alive
- do not keep page-template CSS reaching deeply into component internals unless that behavior is truly load-bearing and cannot yet be owned by the component itself

## Current Canonical Inputs

These are the sources of truth for what still matters:

- shipped macros in `README.md`
- current migration guidance in `docs/field-guide-cleanup.md`
- current page-template ownership decisions in `ROADMAP.md`
- current rendered examples in Part 2 of the design guide

Important current decisions:
- the choose-specialty catalog is owned by `.page.choose-specialty`, not a spread wrapper
- `@sidebar`, `@sidebar-box`, `@procedure`, and `@definition` are already shipped
- `:::lede` remains canonical for now; there is no shipped `@lede` macro
- `.dc-definition-block` and `.dc-sidebar-box` already share the small `.dc-prose-panel` shell

## Rule Inventory

### Move To `dc-brand.css`

These are still real reusable systems, even if they currently live in `content-templates.css`:

| Rule group | Why it belongs in `dc-brand.css` |
|---|---|
| `.dc-toc*` print TOC component rules | reusable rendered TOC component, not guide scaffold |
| `.card-cont-marker`, `.card-fwd-marker` | reusable continuation markers |
| `.dc-learning-path` base break control and tail-row guards | component-owned pagination behavior |
| component-owned specialty/learning-path/skill-card density rules that are still load-bearing | these should live with the components they affect, then be simplified over time |
| `.pmd-break-before`, `.pmd-no-break`, `.pmd-col-span`, `.pmd-suppress-footer` | reusable print utilities |

Migration note:
- when moving specialty and learning-path rules, rewrite aggressively instead of carrying forward page-template selectors that reach deep into component internals unchanged

### Move To `page-rules.css`

Keep this set small and structural:

| Rule group | Why it belongs in `page-rules.css` |
|---|---|
| `.pagedjs_sheet` page background/brick texture | paged-media wrapper behavior |
| `.page`, `.page-break` wrapper resets | global paged wrapper behavior |
| `.column-break` | generic page/column break primitive |
| minimal generic `.page` wrapper resets tied to paged output | structural page behavior, not component styling |
| full-page geometry tightly coupled to named-page rendering | paged-media layout behavior |

Do not move ordinary `.page.* h2/h3/p` demo styling here.

### Move To `guide.css`

These are design-guide-only demo/template behaviors:

| Rule group | Why it belongs in `guide.css` |
|---|---|
| hand-authored guide TOC page layout | guide specimen/demo styling |
| chapter opener / intro demo page layouts | example rendering, not reusable component CSS |
| choose-specialty page-template layout | current guide demo page-template ownership |
| ideal/flaw demo layouts | guide-specific example rendering |
| chapter-03 and gear-tech example-specific page layouts | example-local behavior |

Migration note:
- tighten selectors while moving; prefer component-scoped selectors when possible and use page templates to override default compnonent styles when needed

### Delete Instead Of Porting

Delete selectors that only preserve historical baggage:

| Rule group | Why it should be deleted |
|---|---|
| old preview-wrapper mapping for `page-toc` structure | stale wrapper architecture; the guide already has direct TOC ownership |
| legacy alias support selectors with no current source usage | historical only |
| old one-off page classes not exercised by current guide examples | not part of the current guide contract |
| deep page-template selectors that exist only because the old file mixed component and example concerns | should either be rewritten into component ownership or dropped |

## Highest-Risk Regressions

If `content-templates.css` is removed too early, these examples are most likely to regress:

| Priority | Example | Main risk |
|---|---|---|
| 1 | `304-example-specialty-profile.md` | specialty art geometry, learning-path density, skill-card pagination, tail-row guards |
| 2 | `301-example-front-matter.md` | TOC layout, TOC page numbering, front-matter page spacing |
| 3 | `303-example-specialty-overview.md` | choose-specialty two-column grid and full-width intro block |
| 4 | `302-example-chapter-opener.md` | chapter opener layout and `.column-break` behavior |
| 5 | `305-example-rules.md` | `.pmd-break-before` and generic page wrapper behavior |

## Verification Matrix

Minimum checks during migration:

| Check | Example | Verify |
|---|---|---|
| A | Front Matter / TOC | TOC numbering, indent, borders, and target-counter page numbers still render |
| B | Front Matter / Intro | intro width, spacing, and heading readability remain intact |
| C | Specialty Overview | choose-specialty intro spans all columns and cards still flow in two columns |
| D | Specialty Profile | full-page art, learning-path density, and skill-card packing remain stable |
| E | Chapter Opener | `.column-break` still works and opener prose layout stays intact |
| F | Rules & Mechanics | `.pmd-break-before` still forces the intended break |

## Recommended Migration Order

1. Move unambiguous reusable rule groups to `dc-brand.css`:
   - `.dc-toc*`
   - continuation markers
   - `.pmd-*` utilities
   - component-owned learning-path / skill-card pagination helpers
2. Move the minimal paged wrapper scaffolding to `page-rules.css`.
3. Move guide-only page-template/demo layout rules to `guide.css`.
4. Delete stale selector families that were only preserved as historical reference.
5. Remove `@import url("./content-templates.css")` from `css/index.css`.
6. Rebuild and run the verification matrix.

## Blocking Decisions

These questions affect how aggressive the migration can be:

- Which specialty/learning-path density rules are truly component-owned, and which are only compensating for old example layout? - density rules should all be old example layout
- Should the guide TOC remain a guide-only page-template layout, or should more of it be consolidated into the `.dc-toc` component? - the guide should have a TOC that uses the dc-brand TOC component.
- Which remaining `.page.*` example selectors are still legitimate guide demos, and which are just inherited field-guide history? none we can rebuild what we need, if we need it

## Exit Criteria

The migration is complete when all of the following are true:

- `content-templates.css` is no longer imported by `css/index.css`
- every surviving selector from that file has a clear owner in `dc-brand.css`, `page-rules.css`, or `guide.css`
- the verification matrix passes in preview/build output
- no required guide behavior depends on preserving historical reference CSS
