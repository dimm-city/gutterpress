# PR388: Field Guide CSS evidence

**Latest result:** [Full 228-page builds of all three sweeps on ff1022bf](rerun-ff1022bf/README.md). The gradient guard holds in the full book, selected print checks pass, and 665 nonfallback page glyph comparisons match. Two diagnostic corrections are recommended. The evidence below is retained as history.

## Historical 8a33992 / 4312289 evidence

The 228-page Field Guide confirms that the opt-in preserves live text for artwork and backgrounds beneath ordinary opaque text. It also demonstrates whole-page fallback boundaries and the documented foreground-ordering limitation. These are deliberately aggressive experiments, not proposed production styles.

## Status and provenance

- Full-book run and three styling sweeps: Gutterpress `8a33992beda5b8cd623cf39713903d0736458d0c`.
- Book: `dimm-city/dc-op-manual` at `11ddc736`, `gp-dimm-city@1.6.3`; CSS in `field-guide/styles/fg-overrides.css`, manuscript and extension unchanged.
- Chromium 155.0.8059.39, Ghostscript 10.06.0, Bun 1.4.1; PDF/X-1a, CGATS21_CRPC1 profile, DTRPG settings, 300 DPI artwork; October 14, 2026.
- Follow-up: `43122898adda788d1a34642cf86602c936ec27fd` adds the gradient fallback. The saved repeating-gradient page was checked again through the new guard and conversion functions. Its final PDF/X is visually correct and pixel-identical to the default reference at the inspected 921×1200 render; all text on that page is now raster, as expected. The output passes `qpdf --check`.
- The full 228-page book was **not** rebuilt on `4312289`. Rescanning its untouched source with the new guards selects **213 split pages and 12 fallback pages**, with page 14 newly falling back. The boundary sweep's conic-gradient page 14 is also detected. These are eligibility counts, not measurements from a new complete build.

## Read and inspect

- [Full report and recommendations](report.md): complete style matrix, confounds, checks, limits, and reproduction commands.
- [Before-fix visual comparison](previews/feature-comparison.jpg): left = Chromium source, middle = preserve PDF/X, right = default PDF/X. Rows show a working alpha background, an opaque foreground cover, a foreground tint, the repeating-gradient failure, and the corrected SVG wordmark fallback.
- [Boundary comparisons](previews/boundary-final-comparison.jpg): geometric glyph clipping, conic-gradient geometry, image-only screen blending on the original tested build.
- [Gradient fix comparison](previews/gradient-fix-comparison.jpg): default reference and new-head fallback side by side.
- Original page 14 PDF proof: [source](proof/p14-source.pdf), [split RGB before fix](proof/p14-split-rgb-before-fix.pdf), [preserve PDF/X before fix](proof/p14-preserve-before-fix.pdf), [default PDF/X](proof/p14-default.pdf), [preserve PDF/X after fix](proof/p14-preserve-after-fix.pdf). Each file contains only original page 14. Subsetting used `qpdf --empty --pages INPUT PAGE -- OUTPUT`, avoiding retained outlines and unused book pages.
- [Historical full-book results](reproduction/results.json), [per-case observations](reproduction/cases.json), [new-head eligibility check](proof/new-head-check.json), [new-head pixel check](proof/new-head-pixel-check.json).
- [Reproduction overlay](reproduction/book/): copy its contents into a checkout of the pinned book, then use the report's commands. It includes the three CSS sweeps, runner, comparison tool, manifests, and SVG fixtures. `compare.ts` models the historical `8a33992` guard; use that pinned build when reproducing historical results.
- [Full-book artifact hashes](proof/full-book-artifacts.json) identify the locally retained full PDFs. The 230.7 MB full output is not included in this packet.
- [SHA256SUMS](SHA256SUMS) records every published evidence file.

## Recommendations after the gradient fix

1. Retain the new shading guard before splitting and keep the untouched-source repeating-gradient regression fixture. Treat the conic fallback as a conservative policy: the tested conic specimen rendered correctly on GS 10.06 before this guard, while the repeating-linear specimen did not. Do not describe the original repeating-gradient defect as still open on `4312289`.
2. Document preserve-text as a mode for artwork beneath opaque text. Foreground covers and tints remain visibly different because all preserved text is drawn on top; provide faithful whole-page output when their composition matters.
3. Report fallback reasons per page. One `opacity:.999` card, text stroke, shadow, mask, or gradient can rasterize an otherwise ordinary page. A combined list of every possible cause does not identify the author's actual fix.
4. Fix the Lixdu weight mismatch upstream. The lab's declaration of a single face for weights `100 900` isolates the pipeline and is not a production font-weight solution.
5. Keep source-image comparisons alongside text checks. Extractable glyphs alone miss gradient distortion and ordering errors; some text effects are already rasterized or omitted by Chromium.
6. Make 300 DPI artwork, fine-rule rasterization, global transparency-group expansion, and output-size costs explicit.

The recorded checks establish the tested PDF structure, selected PDF/X requirements, text retention, and sampled visual behavior. They do not establish full-book ink coverage or a physical press proof.
