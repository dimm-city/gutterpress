# Gutterpress 0.11.18 versus PR388: actual Field Guide PDF comparison

PR388 provides a real but narrow benefit: it keeps ordinary text sharp and searchable when the page needs transparent artwork behind it. It does not make arbitrary CSS effects supported in print, and it is not a general repair for the warnings in 0.11.18. Some effects already looked right in 0.11.18, but their pages lost live text; this feature changes that tradeoff.

The distinction matters for this book. With the original `gp-dimm-city@1.6.3` font declarations, Type 3 text blocks the useful splits. With the explicitly documented lab font control, the benefit is substantial. A proper upstream font correction is preferable to shipping the lab's all-weights font declaration. The author reports such a correction in [gp-dimm-city#39](https://github.com/dimm-city/gp-dimm-city/pull/39); that dependency update is not part of these pinned-book measurements.

## Direct measurements

| Full-book case | Live-text pages: old → PR | Size MB: old → PR | Size change | PR split / fallback |
|---|---:|---:|---:|---:|
| Original fonts, original styling | 204 → 204 | 114.60 → 74.49 | 35.0% smaller | 9 / 11 |
| Isolated sweep, lab font control | 199 → 211 | 140.43 → 45.16 | 67.8% smaller | 21 / 4 |
| Combined sweep, lab font control | 0 → 205 | 1125.73 → 235.46 | 79.1% smaller | 213 / 12 |
| Boundary sweep, lab font control | 0 → 212 | 1125.32 → 191.26 | 83.0% smaller | 222 / 3 |
| Original fonts, combined effects | 0 → 0 | 1125.84 → 1095.14 | 2.7% smaller | 8 / 217 |

Every row is a pair of complete 228-page exports. “Live-text pages” means pages with extractable text, not a judgment that every effect on the page paints correctly. Art-only and blank pages are excluded from that count. All sizes are decimal MB.

The original-font book gains no live-text pages: the same 11 text-bearing transparent pages fall back in both versions. Its nine split pages contain only artwork. The original-font advanced-effects control has the same problem on a much larger scale. This is specifically the pinned 1.6.3 book, not a claim that the reported upstream font fix cannot help.

The three styling sweeps use identical experimental CSS and the same Lixdu font control in both exporters. The original-font effects control removes only that font declaration from the combined sweep. It shows the production-font prerequisite; within each A/B pair the fonts are held constant, so the measured text-preservation gain is attributable to the export path.

## Does a simpler approach achieve the same benefit?

I also compared four selected real-book pages using stock 0.11.18, 0.11.18 with only Ghostscript's rasterization resolution set to 300 DPI, and PR388. This is a separate four-page control, not another full-book run.

| Export | Size | Live-text pages | Foreground cover |
|---|---:|---:|---|
| Stock 0.11.18 | 22.16 MB | 0/4 | Preserved |
| 0.11.18 adjusted with `-r300` | 7.27 MB | 0/4 | Preserved |
| PR388 preserve-text | 6.17 MB | 3/4; fourth page is art-only | Covered words incorrectly appear |

Most of this control's size saving can be obtained by reducing whole-page raster resolution. That simpler change does **not** preserve text. PR388's distinct value is retaining real glyphs and their sharp edges; it should be justified on that basis, not merely as compression machinery. The adjusted baseline is an experimental export setting, not a shipped 0.11.18 option.

The four source pages are original-font p6, isolated p7, combined p1 and combined p4. See [independent audit](resolution-control/audit/summary.json), [resolution comparison](resolution-control/previews/compare-p2.jpg), [paint-order comparison](resolution-control/previews/compare-p4.jpg), and [reproduction wrapper](reproduction/pr388-gs-300).

### Ink-channel control

The same callout crop gives a print-specific benefit beyond searchability. PR388 renders its black lettering as pure K in this specimen. Stock 0.11.18 already has some K-only glyph interiors, but the raster/JPEG output introduces CMY values around and within the lettering; reducing the old raster to 300 DPI increases that contamination. This is not evidence that every old black pixel is rich black. The stock-old dark pixels have a median maximum CMY channel of only 3/255 (90th percentile 13/255), so the measured advantage is cleaner separation, not universally heavy four-color black.

Among crop pixels with K at least 128/255, the fraction with each C/M/Y channel at most 2/255 is **45.3% stock old, 15.3% adjusted old300, and 100% PR**. This is a defined dark-pixel statistic, not a semantic glyph mask or a print-quality score. The channel images show that the dark pixels correspond to the callout lettering, with no dark background/shadow in this rectangle. See [old channel planes](resolution-control/ink-control/v0.11.18-plates.png), [PR channel planes](resolution-control/ink-control/pr388-plates.png), and [raw measurements and commands](resolution-control/ink-control/measurements.json).

The check uses Ghostscript 10.06 `tiff32nc` at 600 DPI with `UseFastColor=true` to inspect the existing CMYK/Gray colorants without ICC remapping; [device documentation](https://ghostscript.readthedocs.io/en/gs10.06.0/Devices.html) and [color-option documentation](https://ghostscript.readthedocs.io/en/gs10.06.0/Use.html) describe these choices. It is not a physical registration or press simulation.

## What the actual pages show

| CSS/effect | 0.11.18 result | PR388 result | Support conclusion |
|---|---|---|---|
| Translucent panels and box shadows behind ordinary opaque text | Appearance survives; transparent page becomes a bitmap | Appearance survives and eligible text remains live | Useful improvement, subject to font eligibility and paint order |
| Alpha artwork, clipped/masked images, image-only filters or blending | Artwork can paint, but transparency can rasterize the page's text | Eligible text can survive alongside the raster artwork | Useful for artwork; not a general guarantee for every filter/blend |
| Rotation and geometric clipping of ordinary text | Can lose live text when the page also has transparency | Eligible glyphs remain live | Supported in the tested specimens |
| Opacity/blending/soft shadows or masks on text, gradient text, stroked Type 3 text, SVG pattern/gradient wordmarks | Whole-page raster output | Same whole-page fallback | No live-text improvement for those pages |
| `filter` on a text-bearing element | Chromium has already rasterized the affected text | Cannot reconstruct those glyphs | Warning still applies |
| `backdrop-filter` | Tested blur was absent in the source PDF | Cannot add an effect Chromium did not print; foreground tint also exposes paint-order limit | Not established as supported |
| Opaque foreground cover or translucent tint over text | Cover/tint is preserved | Text is redrawn above the artwork, revealing covered words or losing tint | Unsafe for these compositions; keep faithful whole-page output |
| Repeating/conic gradient on a transparent page | Whole-page rendering preserves the tested gradient | Conservative fallback uses the same path and loses live text | Guard prevents a new split failure; not a new CSS capability |
| Opaque repeating gradient | Stripe pattern is distorted | Identical distortion | Still unreliable |
| Opaque conic gradient | Paints on Ghostscript 10.06 | Identical output | This specimen already worked; PR adds no benefit |

These are tested outcomes, not promises about every use of a CSS property. Opacity boundaries depend on what Chromium emits: `.9999` triggers fallback in the boundary sweep, while `.999999` was quantized to opaque in this specimen. That value is not a portable workaround. One unsupported glyph can cause an entire page to fall back; one blend elsewhere can cause Chromium to mark much of the book transparent.

### Proof worth opening

- **Actual text benefit:** [600 DPI callout crop](isolated/previews/callout-type-compare.png) and [full p7 comparison](isolated/previews/compare-p007.jpg). Source / 0.11.18 / PR388. PR text has clean glyph edges; old output shows raster stair-stepping.
- **Paint-order cost:** [combined p4](combined/previews/compare-p004.jpg) reveals words hidden by the source's opaque overlay; [combined p13](combined/previews/compare-p013.jpg) and [isolated p13](isolated/previews/compare-p013.jpg) lose foreground tint on the text.
- **Artwork cost:** [p6 brick detail at 600 DPI](production-fonts/previews/brick-detail-compare.png) visibly softens in PR output. The [illustration crop](production-fonts/previews/illustration-detail-compare.png) changes less. Do not equate 720-to-300 output DPI with proportional loss of original photo detail: many source plates are already around 262–352 PPI, while the brick tile is 2,550px wide at a CSS repeat width of 1.5in (nominally 1,700 PPI). Its fine detail is independently reduced by the 300 DPI page raster. Some artwork/gradient tones also differ between the two print-output paths (for example combined p17), so matching the ICC profile does not imply identical rendered color. The source image listing does not enumerate this pattern background; [asset and CSS evidence](background-resolution.json) records it separately.
- **Gradient boundary:** [opaque repeating-gradient comparison](opaque-gradients/previews/compare-1.jpg) shows the same irregular bands in both outputs; [opaque conic comparison](opaque-gradients/previews/compare-2.jpg) paints in both. Both output pages are pixel-identical old versus new at 1000px high. These were extracted from a fresh real-book source, with shadows removed and original fonts retained.
- **Conservative gradient fallback:** [combined p14](combined/previews/compare-p014.jpg) and [boundary p14](boundary/previews/compare-p014.jpg). The split guard does not confer a benefit over old whole-page conversion here.

## Recommendations

1. **Keep the feature as a focused opt-in.** Describe it as preserving eligible opaque text over flattened artwork. Do not advertise general support for risky CSS or make it the default for arbitrary book designs.
2. **Validate and adopt the upstream font correction.** The reported change in gp-dimm-city#39 needs a book run with that dependency. The lab font range exists to exercise the renderer, not to supply missing font weights. Preserve conservative fallback for genuine stroked/pattern/translucent text.
3. **Give authors a page-level fallback override.** One intentional cover/tint should not force an entire otherwise eligible book back to whole-page rasterization. Until then, authors need to avoid such compositions or retain the default for the book. Automatic support for arbitrary paint order would require a materially more complex design; the current split cannot supply it.
4. **Report useful benefit, not just split count.** Separate pages gaining live text, art-only pages re-encoded, and text pages falling back. A zero-gain book should make that explicit. Consider skipping art-only splits or exposing artwork resolution/compression as a separate choice.
5. **Separate resolution/compression policy from text preservation.** The four-page control shows a cheaper path to most size savings. Retain or expose enough artwork quality for fine rules and textures; document JPEG/resampling effects as well as nominal DPI.
6. **Correct the file-size comparison in the docs.** My earlier 92→235 MB number compared RGB source against CMYK PDF/X, not 0.11.18 against PR388. It does not demonstrate overhead caused by this feature. The direct A/B measurements above replace that inference. File size depends on source content and rasterization policy; “the file grows” is not a universal outcome.
7. **Finish qualifying the gradient diagnostic.** The latest head changes the opaque warning to “can print blank,” which is appropriate. The transparent-page warning still contains “on a page without transparency it would print blank.” The new opaque controls disprove that certainty: one paints and one distorts. Warn about possible missing/distorted output and advise visual inspection.
8. **Fix the fallback integration assertion.** The test at `ghostscript.flatten.integration.test.ts:461` compares RGB source to CMYK output with a `<1` mean-error threshold. It failed here at 1.2388117647 in both conversion modes. An instrumented rerun measured default versus preserve at **0**, pixel-identical, and passed when that comparison was asserted instead. Compare the two conversion paths directly for fallback equivalence, while retaining separate source/geometry checks. [Original failure, diagnostic reproduction, and fixture PDFs](integration-threshold/).

## Validation and reproducibility

Baseline: `v0.11.18` / `dfc3645781d5917eb16894d58a691ccd1d87745c`. Measured PR renderer: `42091eccba9111df036e440a247830e0e7d84fb8`. The PR advanced during these long exports to `7c692ab4df03a43e102eb7d9f02a68980504e276`; [the saved delta](head-update-7c692ab4.patch) changes diagnostics/docs, a test's warning expectation, version strings and changelog, with **no rendering or eligibility changes**. The measured outputs therefore apply to that rendering implementation without claiming a fresh full build at the new SHA.

Book base `11ddc736`, `gp-dimm-city@1.6.3`; Chromium 155.0.8059.39, Ghostscript 10.06.0, Bun 1.4.1. PDF/X-1a, the same CGATS21_CRPC1 ICC bytes, K-only rewrite and 240% configured TAC setting in both exporters. No dependency/plugin/manuscript edits.

Each exact-version exporter receives the **same source PDF bytes** for its pair. The compiler, black-text rewrite, ICC and dependency lock are unchanged between the compared implementations. Three sources are the verified complete-book sweep outputs; the original-font source is the retained original book; the original-font effects source and opaque controls were freshly generated through the 0.11.18 CLI. Both paths run their actual annotation stripping, black-text rewrite and PDF/X conversion functions. PR additionally runs its actual eligibility checks and split. This isolates the feature rather than introducing a pagination/font change between sides.

All ten full outputs contain 228 pages, preserve every source page box, have zero live transparency, list all remaining fonts as embedded, and pass `qpdf --check`. There are no lost live-text pages relative to 0.11.18 and no unexpected retained-glyph sequence mismatches. The intended fallback pages lose live text as declared. [Compact checks](checks-summary.json) and per-case `audit/` folders contain the evidence.

The independent audit checks actual output page counts/boxes, exact ordered Unicode glyph sequences, font embedding, final transparency, PDF/X metadata/output-intent channels, embedded-image dimensions and PPI, and `qpdf --check`. Exact text retention does not establish correct artwork compositing. Personal visual claims are confined to the listed specimens and crops; [the visual-review record](visual-review.json) lists them. The full-book audits cover structure and glyph retention.

The selected downloadable PDFs are page extracts for visual proof. `qpdf --empty` extraction does not retain the full book's catalog metadata/output intent, so the extracts are not separately certified PDF/X files. Extraction checks compare them to the corresponding full-output pages. Full PDFs remain in the book worktree; paths, sizes and SHA-256 hashes are recorded in each export and audit JSON.

For the old combined and boundary exports, the job supervisor exited with signal 15 while its Ghostscript child continued to completion. The completed 228-page PDFs passed independent structural/content checks; their export manifests were reconstructed from the finished files and source hashes. These two records explicitly omit unobserved process exit/timing values. The conversion function has no PDF-changing step after Ghostscript returns. See each `v0.11.18/recovery.json`.

Observed export times are included where captured in the JSON, but cases ran concurrently and some source generation/auditing overlapped. They are not controlled performance benchmarks. These runs do not establish PDF/X-3 behavior, every Ghostscript/Chromium version, peak ink coverage or a physical press proof. The configured TAC value alone is not proof of measured ink coverage.

See [final independent audit](final-summary.json), [provenance](provenance.json), [summary](summary.json), [CSS-warning comparison](warning-comparison.json), and [reproduction scripts](reproduction/). Scripts preserve the executed absolute paths; adjust root constants for another machine. The 300 DPI control uses only the included Ghostscript wrapper, leaving the baseline source code unchanged.
