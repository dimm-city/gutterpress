# Field Guide advanced CSS PDF export tests

**Historical full-book test: `8a33992`.** See the README for the targeted verification of subsequent fix `4312289`.

PR #388 preserves live body text with translucent backgrounds and artwork, but it is not a general solution for arbitrary CSS compositing. The real book exposes a repeating-gradient regression, the documented foreground-ordering limitation, and several common styles that rasterize an entire page. The updated SVG pattern-text fallback fixes the disappearing-wordmark regression.

The combined experiment remains active in `field-guide/styles/fg-overrides.css`. This is an experimental worktree, not production styling. The manuscript and pinned extension were not edited.

## Tested build and artifacts

- Book: `dimm-city/dc-op-manual`, base `11ddc736`, branch `codex/pdfx-field-guide-stress`.
- Gutterpress PR #388: `8a33992beda5b8cd623cf39713903d0736458d0c`.
- Extension: `gp-dimm-city@1.6.3`.
- Chromium 155.0.8059.39, Ghostscript 10.06.0, Bun 1.4.1, tested October 14, 2026.
- PDF/X-1a, CGATS21_CRPC1 profile, DTRPG settings, 300 DPI split artwork.

The full 228-page output and source PDFs are retained locally; their sizes and SHA-256 digests are in [full-book-artifacts.json](proof/full-book-artifacts.json). This packet includes compact visual and PDF proof:

- [Source / preserve / default comparison](previews/feature-comparison.jpg).
- [Clipping, conic, and image-blend comparison](previews/boundary-final-comparison.jpg).
- Original page 14: [source](proof/p14-source.pdf), [split before CMYK](proof/p14-split-rgb-before-fix.pdf), [preserve PDF/X before fix](proof/p14-preserve-before-fix.pdf), [default PDF/X](proof/p14-default.pdf), [preserve PDF/X after fix](proof/p14-preserve-after-fix.pdf).
- [Results](reproduction/results.json), [case observations](reproduction/cases.json), [text retention](proof/text-retention.json), [embedded fonts](proof/preserve-fonts.txt), and [qpdf check](proof/qpdf-check.txt).
- [Initial selected validation checks](proof/fg-pr388-postvalidate.json) and [successful metadata rerun](proof/fg-pr388-postvalidate-metadata.json).
- [Book overlay and runnable CSS sweeps](reproduction/book/), including the experimental manifests and SVG wordmarks.

All page references below are original PDF page numbers. The 20-page sample maps to `1,2,4,5,6,7,8,9,10,12,13,14,15,17,18,19,138,159,192,200`. Other sample maps are saved beside their PDFs.

## Main findings

**Repeating gradients are corrupted by the split artwork pass.** On the Vibe callout, page 14, uniform diagonal stripes become irregular stripes and broad solid-color gaps. The unchanged source and default PDF/X preserve them. The error is already present in the RGB split, before CMYK conversion. The build still succeeds. [Posted inline on PR #388](https://github.com/dimm-city/gutterpress/pull/388#pullrequestreview-5521659589) at the `pdfimage24 -dFILTERTEXT` call.

```css
.dc-vibe-callout {
  background: repeating-linear-gradient(35deg, #ffffcc 0 8pt, #33ccee 8pt 16pt);
  box-shadow: 2pt 3pt 5pt #0006;
}
```

**Foreground artwork changes the appearance of text beneath it.** Page 4 deliberately covers part of the opening sentence with an opaque pseudo-element. Preserve-text reveals that sentence above the cover. On page 13, a translucent pink foreground overlay stops tinting the underlying text. Default conversion preserves both. These are concrete examples of the PR's documented text-on-top limitation; neither page triggers fallback.

**Fallback has a large effect on ordinary book design.** A single card at `opacity:.999` rasterizes all ten cards on page 12. Soft text shadows, text strokes, gradient text, masks on text and text blending also force whole-page fallback. A page that looks almost entirely opaque can therefore lose all searchable text.

**Font setup can hide whether the feature was exercised.** In the original book, the guard identifies Type 3 text on 215 pages; 11 of its 20 transparent pages would be blocked. The lab declares the existing Lixdu face at weights `100 900` to prevent synthetic bold from overwhelming the tests. This does not create real font weights and is not a typography fix to ship. Stroked Lixdu and stroked Tomorrow still produce Type 3 glyphs. A production fix should use an available face/weight or a deliberate typography change upstream.

**The new SVG guard works.** The pattern-filled WIRED PATTERN wordmark on page 138 and alpha-gradient ARCANE GRADIENT wordmark on page 159 remain visible after PDF/X conversion. Both pages now fall back, so the wordmarks lose live text instead of disappearing.

## Styling outcomes

“Split” means artwork becomes a 300 DPI raster while eligible text remains live. “Fallback” means the entire physical page is rasterized. “Source limitation” means the effect or live glyphs are already absent from Chromium's PDF.

| Style or boundary | Real-book location | Observed result |
|---|---|---|
| RGBA panel, outer and inset soft shadows | Credits, p1 | Split; appearance and live body text preserved |
| Alpha image and polygon clip | Credits art, p1 | Split; clip and translucency preserved |
| Translucent callout behind opaque type | Citizen File, p7, isolated sweep | Split; works when the unrelated stroked heading is removed |
| Translucent table rows and .25pt colored rules | Scars, Size, and Survival, p9 | Split; text stays live, rules are raster |
| Layered radial and linear alpha backgrounds | Ideal, p17 | Split; background geometry and live text preserved |
| Image gradient mask, grayscale, drop shadow | Vibe art, p13 | Split; artwork effects preserved |
| Screen blend and .7 opacity on image only | Vibe art, boundary p13 | Split; appearance preserved with live body text |
| Rotation of opaque text | Chapter opener, isolated p5 | Split; works without the soft text shadow used in the combined sweep |
| Geometric clip crossing heading glyphs | Image Is Everything, boundary p8 | Split; clipped glyphs stay clipped in final PDF/X |
| `overflow:hidden` cutting a body-text line | Scars, Size, and Survival, isolated p9 | Split; clipping remains in the RGB split |
| Hard opaque text shadow | Contents, isolated p2 | Live text; this specimen does not require transparency splitting |
| Soft text shadow | Contents p2, opener p5; isolated p10 | Fallback; Chromium emits `ca=0` text paints for these effects |
| Opaque text stroke on Lixdu | Citizen File, p7 | Fallback; Type 3 glyphs |
| Opaque and RGBA strokes on real-bold Tomorrow | Isolated p15 and p18 | Both fallback via Type 3, so stroke alpha is not the deciding factor |
| `opacity:1` on heading | Ideal, p17 | Split; live text preserved |
| `opacity:.999` on one heading or card | Isolated p19; combined p12 | Whole-page fallback |
| `opacity:.9999` | Boundary p17 | Whole-page fallback |
| `opacity:.999999` | Boundary p18 | Split; Chromium quantizes this specimen to opaque PDF paint. Do not treat this value as a portable workaround |
| `opacity:0` | Boundary p19 | Heading absent in source and final, as intended; body text survives |
| `opacity:.15`, low-alpha text color | Combined p10/p18; boundary p15 at alpha .5 | Whole-page fallback |
| `mix-blend-mode:multiply` on text | Origins Matter, p15 | Whole-page fallback |
| CSS background clipped to text | Image Is Everything, p8 | Fallback; appearance retained, live text lost |
| Mask gradient on text | Chapter 3 opener, p192 | Fallback; appearance retained, live text lost |
| `filter:drop-shadow()` on heading | Think Big, p19 | Heading already rasterized by Chromium; body remains live after splitting |
| `backdrop-filter:blur()` over actual prose | Isolated Vibe, p13 | Source limitation: Chromium emits the cyan overlay but no backdrop blur. The split also has the foreground-tint limitation |
| Repeating linear gradient | Vibe callout, p14 | Visible split regression; default conversion preserves the stripes |
| Direct conic-gradient background | Boundary Vibe callout, p14 | Geometry survives RGB split and final PDF/X on GS 10.06; CMYK reduces saturation |
| Opaque foreground cover | Metropolis, p4 | Covered text reappears; documented ordering limitation |
| Translucent foreground tint | Vibe, p13 | Underlying text becomes untinted; documented ordering limitation |
| SVG opaque pattern fill | Wirephreak opener, p138 | New fallback guard preserves appearance |
| SVG alpha-gradient fill | Technosorcerer opener, p159 | New fallback guard preserves appearance |
| Full-page artwork without text | p6 and other opener plates | Split completes without adding live text or losing the artwork |

The combined sweep deliberately includes interactions. It cannot prove independent success for the p7 callout or p12 opaque card because another effect forces their pages to fall back. `isolated.css` separates those cases. The first conic pseudo-element did not yield a visible specimen; `boundary.css` paints the conic directly and is the verified conic test. Full per-case observations are in [cases.json](reproduction/cases.json).

## Book-wide checks

The combined source and final PDF/X both have 228 pages. Of 225 pages flagged transparent, 214 were split and 11 fell back: **2, 5, 7, 8, 10, 12, 15, 18, 138, 159, 192**. The three signature-padding pages were not transparent.

The source has live text on 217 pages; final PDF/X has live text on 206. The 11 losses are exactly the fallback pages. All other text-bearing pages retain their glyph content. Poppler reported four extra extracted characters across pages 68 and 145; PDF.js operator inspection confirmed identical ordered glyph sequences (1,981 and 1,653 glyphs). Existing double-painted labels and tiny coordinate rounding changed Poppler's duplicate suppression. Visual inspection found no new glyph duplication.

All 10 fonts in the final output are embedded. Selected PR validation checks pass for structure, page dimensions, bleed, font embedding, transparency, color spaces, PDF/X metadata and output intents. Independent `qpdf --check` returned 0 with no syntax or stream-encoding errors. Two metadata checks initially failed because sandboxed Bun child-process capture returned empty qpdf output; rerunning those checks outside that restriction passed. Both results are retained with the artifacts.

The source is **92,268,391 bytes**; final PDF/X is **230,696,123 bytes**, about **2.50×** larger. This run contains blends that cause Chromium to wrap almost the entire book in transparency groups. The isolated sweep flags only 25 pages transparent, showing how one blend can expand the split scope substantially.

Default conversion was tested on the 20-page sample, not the complete book. All 20 sample pages lose live text under that path. Detailed visual comparisons cover the experimental pages and an unaffected p200 control. This is feature validation, not print-shop certification: it does not establish full-book TAC compliance or a physical press proof.

## Recommendations

1. Keep the new gradient guard ahead of the split artwork pass, and keep the real repeating-gradient callout as a regression fixture. Commit `4312289` adds this safeguard; the follow-up check described in the README confirms fallback on the saved source. The original full-book run below remains pinned to `8a33992`.
2. Use preserve-text for backgrounds and artwork beneath opaque text. Keep foreground covers and tints out of eligible pages; use a faithful whole-page fallback where the composition depends on them.
3. Surface fallback reasons per page. “Type 3 font,” “text alpha,” “text shadow” and “patterned text” lead to different author fixes. Counts alone conceal the effect of one styled card on a whole page.
4. Resolve the production font-weight mismatch upstream. Do not adopt the lab's all-weights declaration as an unexplained style fix.
5. Keep visual source comparisons alongside text checks. Extractable glyphs cannot establish correct layering, gradients, masks or appearance, and Chromium can rasterize text before Gutterpress receives it.
6. Treat artwork resolution and output size as explicit tradeoffs. Fine rules become raster, and a blend in one part of a book can make the rasterization scope much larger than expected.

## Reproduce

Check out `dimm-city/dc-op-manual` at `11ddc736`, then copy the contents of `reproduction/book/` into that checkout. The scripts below live under `tools/pdfx-stress/` after that copy. The original sweep results are pinned to Gutterpress `8a33992beda5b8cd623cf39713903d0736458d0c`.

Use a checkout of the pinned PR with its dependencies installed. The test runner applies a sweep to `fg-overrides.css`, renders through the CLI, saves the applied CSS and commit, then restores the previous sheet even when a build fails. It does not publish anything.

```sh
python3 tools/pdfx-stress/run.py --pr-root /tmp/gutterpress-pr388-realbook --sweep combined --pdfx
python3 tools/pdfx-stress/run.py --pr-root /tmp/gutterpress-pr388-realbook --sweep isolated --pdfx
python3 tools/pdfx-stress/run.py --pr-root /tmp/gutterpress-pr388-realbook --sweep boundary --pdfx
```

The boundary manifest restricts source files to the existing front matter and Citizen File chapter; it adds no test prose. For a controlled comparison using one untouched source PDF, the tested comparison tool calls the PR's split and conversion functions, preserves both RGB stages, and writes default and preserve PDF/X:

```sh
bun tools/pdfx-stress/compare.ts /tmp/gutterpress-pr388-realbook \
  .print-md/build/pdfx-stress/experimental-source.pdf \
  .print-md/build/pdfx-stress/recheck 1,2,4,7,8,9,13,14,17,18,19,138,159,192
```

The runner leaves final PDF/X post-validation separate so a failed check does not discard the diagnostic PDF. To repeat the selected checks, use `gutterpress validate` from the same PR checkout with `--phase post --only pdf.structure.qpdf,pdf.print.page-size,pdf.print.bleed,pdf.print.embedded-fonts,pdf.print.transparency,pdf.print.color-spaces,pdf.print.pdfx-metadata,pdf.print.pdfx-markers` and the emitted PDF path. These do not replace visual inspection.
