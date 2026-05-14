# CSS Cleanup Review Ledger

This ledger records the current stopping point for safe CSS cleanup in `examples/dc-design-guide` after repeated agent review, source-usage checks, live preview rebuilds, and computed-style verification.

## Safe Cleanup Completed

- `guide.css`
  - removed duplicate `.page.intro` selector branch; kept `.intro`
  - removed no-op `.page.page-toc:not(.dc-toc)` guard; kept `.page.page-toc li::before`
  - removed unused `.page.page-title` / `.page.page-title-full` block
  - removed unused `.page.surviving-the-sprawl` art block
  - removed unused `.page.outcome-table .outcome-table*` block
  - removed dead chapter-specific page hooks for `.page-rules`, `.init`, `.call-home`, `.dream`, `.da-devil`
  - removed dead chapter-02 exclusion layout block
  - removed dead `.page.ideal` / `.page.flaw` page-template block
  - removed dead chapter-03 descendant hooks for `.rolling-die`, `.dream-economy`, `.scenes`, `.the-players`
  - removed dead specialty clearfix `.specialty .dc-card-inner::after`
  - removed dead gear-tech art-positioning rules for `.example-gear-tech p.img-wrapper` and `.example-gear-tech img.bottom-center.art-medkit`
  - removed dead specialty `dc-ability-card` branches; specialty rules now target the live `dc-ability` rows inside `dc-skill-card`
  - removed specialty no-op rules `.specialty { break-before: auto; }` and `.specialty .page { break-inside: auto; }`
- `dc-brand.css`
  - thinned `.dc-note .dc-alert-label` to actual overrides only
  - merged duplicated `.dc-path-shell > h2.dc-spray:first-child` rules
  - removed unused alias selector `.pmd-float-left` from `.img-float-left`
  - removed unused alias selector `.dc-sidebar-label` from `.sidebar-title`
  - removed deprecated unused `.dense .dc-skill-card` compatibility alias
  - removed dead `dc-ability-card` compatibility branch from loose-list normalization; kept live `dc-ability` support
- `page-rules.css`
  - removed the unused chapter-start bottom-center footer suppression selector
  - removed unused `.dc-specialty-art` compatibility alias from `.specialty-art { page: full; }`

## Verification Completed

- Full guide rebuild passes:
  - `bun src/cli.ts build examples/dc-design-guide --format html --out /tmp/dc-design-guide-verify --manifest examples/dc-design-guide/manifest.yaml`
- Live preview verification passed on `http://127.0.0.1:4173/book.html`
- Pagination remained stable at `104` pages through the cleanup loop
- Console remained free of warnings/errors after each safe change set

### Computed-style checks performed

- `.intro`
  - verified `padding-left`
- `.page.page-toc li`
  - verified `list-style-type`, `padding-left`
- `.dc-path-shell > h2.dc-spray:first-child`
  - verified `color`, `background-color`, `clip-path`, `margin-bottom`
- `.dc-note .dc-alert-label`
  - verified `font-family`, `font-weight`, `font-style`, `text-transform`, `display`, `font-size`, `letter-spacing`, `margin-bottom`, `color`
- `.dc-note.warning .dc-alert-label`
  - verified same properties as `.dc-note .dc-alert-label`
- synthetic canonical alias probes
  - `.img-float-left`: verified `float`, `width`, `max-width`, `margin`, `display`
  - `.sidebar-title`: verified `font-family`, `letter-spacing`, `color`, `border-bottom`, `margin`, `padding-bottom`
- chapter-start footer suppression
  - verified left/right/center margin-box `::after` content remained `none`
- specialty card clearfix removal
  - verified `.specialty .dc-card-inner` / `.dc-card-body` / `.dc-skill-card` geometry remained unchanged while the `::after` pseudo reset from table-clearing chrome to no-op
- specialty terminology cleanup
  - verified `dc-ability-card` remained absent before/after
  - verified live specialty `dc-ability` spacing and break behavior were unchanged (`margin-bottom`, `gap`, `break-before`)
- final specialty duplicate cleanup
  - verified `.specialty .page` had no rendered matches
  - verified removing `.specialty { break-before: auto; }` and `.specialty .page { break-inside: auto; }` caused no page-count or computed-style regressions

## No More Safe Cleanup Found

Parallel agent sweeps on `guide.css`, `dc-brand.css`, and `page-rules.css` found no additional changes that were both:

- minimal and local
- supported by current source usage / rendered DOM evidence
- safe enough to apply without broader manual review

## Remaining Rules To Investigate

These are not safe-delete candidates yet. They should be reviewed manually with targeted render checks.

### `guide.css`

- `.page > h2`
  - Broad page-level heading backing rule; likely intentional, but wider than page-template-specific patterns.
- `.page p`
  - Global widow/orphan control across guide pages; likely load-bearing.
- `.page h2, .page h3`
  - Global heading break control; likely load-bearing across many templates.
- `.page.toc li`
  - Might be a legacy class shape next to `.page.page-toc`, but `page-rules.css` still uses `.page.toc` patterns.
- `.page.credits strong`
  - Could be alias cleanup, but current front-matter generation may still emit `.credits` directly.
- `.page:is(.page-rules, .init, .call-home, .dream, .da-devil)`
- `.toc { text-wrap: pretty; }`
- `.toc h2 { text-wrap: balance; }`
- `.toc ul li { text-wrap: pretty; }`
  - Likely ignored by Paged.js, but preview/browser impact was not explicitly signed off.
- `.specialty .dc-flavor::after`
  - On the current specialty render the pseudo computes `content: none` with only a margin change; looks suspicious, but not removed because the source of the pseudo may still be shared elsewhere.
- `.specialty .dc-flavor`
- `.specialty .dc-card-body`
- `.specialty .dc-skill-card .dc-card-body .dc-card-inner`
- `.specialty .dc-card-tab`
- `.specialty .dc-ability`
- `.specialty .dc-ability-text`
- `.specialty .dc-ap`
- `.specialty .dc-path-shell > p`
- `.specialty .dc-path-shell ul li`
  - These were checked against base component rules and current computed styles; they are still materially different on the rendered specialty pages and are therefore treated as load-bearing density overrides, not safe duplicates.

### `dc-brand.css`

- `.sidebar-title`
  - Still retained intentionally; it is emitted by `src/lib/markdown/containers.ts`, so it is not a dead alias.
- `.dc-roll-table*` family
  - Deprecated-looking, but still tied to plugin output / docs and not safely removable locally.
- `.dc-ability`
  - Still live and intentionally retained: plugin output uses `dc-skill-card` as the outer component and `dc-ability` as the inner ability row structure.
- `.specialty-intro > h3`
- `.specialty-intro > p`
- `.specialty-intro > ul, .specialty-intro > ol`
  - Partial shell rules that may still support bare specialty-intro content.
- `.dc-learning-path h2.dc-spray`
  - Possibly shadowed by `.dc-path-shell > h2.dc-spray:first-child`, but not safe to remove without confirming all learning-path title output shapes.
- `.dc-roll-lucid`
- `.dc-roll-surreal`
  - May be orphaned or doc-drifted, but current rendered usage was not fully ruled out.
- `.dc-roll-table-compare-stage`, `.dc-roll-table-col`, `.dc-roll-table-col-label`, `.dc-roll-table-col-label code`
- `.dc-specimen-table`, `.dc-specimen-row`, `.dc-specimen-label`, `.dc-specimen-value`, `.dc-specimen-head`
  - Likely specimen/legacy support rules; no safe local delete without broader support-scope decision.

### `page-rules.css`

- `.page.citizen-file, .page-break.citizen-file`
  - Active-looking page assignment; actual rendered usage should be confirmed before any pruning.
- `@page citizen-file:left`
  - Looks like a possible no-op margin block, but needs page-geometry verification.
- `.page-break.intro, .page-break.page-intro, .page.intro, .page.page-intro`
  - Intro/front-matter assignment aliases may be reducible, but only after built HTML class-shape confirmation.
- `.page-break.toc, .page.toc, .page.page-full-bleed, .page.cover, .page.back-cover, .page-break.credits, .page.credits`
  - Some branches may be legacy aliases, but not enough evidence yet.
- `.pagedjs_page.pagedjs_named_page.pagedjs_chapter-start_page .pagedjs_margin-bottom-left > .pagedjs_margin-content::after`
- `.pagedjs_page.pagedjs_named_page.pagedjs_chapter-start_page .pagedjs_margin-bottom-right > .pagedjs_margin-content::after`
  - Highly specific Paged.js override; still verified as load-bearing enough to keep.
- `@page chapter-end`
  - May be redundant with default left/right footers, but named-page precedence makes this manual-review only.
- `.specialty-art, .dc-specialty-art`
  - `.specialty-art` is live; `.dc-specialty-art` alias was removed.
- `@page :blank`
  - Blank-page safety behavior; low-frequency, high-risk to touch.
- `@page clean`
  - Reserved documented extension point; unused in examples is not enough to delete.
- `.page > *`
  - Broad stacking rule; likely required to keep content above page/background layers.
- `.page img`
  - Generic image reset may still prevent overflow in unscoped content.
- `.page, .page-break { z-index: 1; ... }`
  - Not a safe delete: `.page` becomes positioned later in the file, so the `z-index` is live.

## Operational Rule

Continue using this policy for future cleanup:

1. Identify one tiny candidate set.
2. Confirm source usage with grep.
3. Confirm rendered usage with live DOM probes.
4. Capture before-state computed styles for any surviving canonical selector.
5. Apply the smallest patch.
6. Rebuild and reload the full guide.
7. Re-run computed-style checks and console/page-count verification.

If a candidate cannot pass that bar cheaply, keep it in manual review.
