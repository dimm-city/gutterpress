# Print colour pipeline review (2026-11-04)

Scope: the `--format pdfx` colour pipeline and every statement the repo makes
about CMYK, total ink coverage, ICC profiles, PDF/X structure and DriveThruRPG's
print rules. Read: `packages/cli/src/lib/ghostscript.ts`, `black-text-gray.ts`,
`pdf-parse.ts`, `presets.ts`, `engine.ts`, `engine/compiler/postprocess.ts`,
`engine/compiler/tier2.ts`, `engine/shared/print-area.ts`, every check under
`checks/pdf/`, `schema/manifest.types.ts`, `docs/publishing.md`,
`docs/engine/ENGINE.md`, `docs/docker.md`, ADR 0008, the user guide
(`examples/gutterpress-user-guide/01, 03, 06, 08`), `examples/academic-paper/paper.md`,
the CHANGELOG and the website copy.

Method: code reading, the measurements recorded in gutterpress #331 and #419, and
sRGB->CMYK conversions through the shipped `packages/cli/profiles/CGATS21_CRPC1.icc`
with LittleCMS (Pillow). Ghostscript was not available in the review session, so
no new gs measurement was taken; where a Ghostscript behaviour is asserted from
its documentation rather than from a measurement in this repo it is marked
VERIFY. `ghostscript.com`, `ghostscript.readthedocs.io` and the DriveThru /
IngramSpark help centres did not resolve from the review environment.

Reference numbers used below:

| Colour | gs 10.06 via `convertToPdfxCmyk` (#331) | LittleCMS, CRPC1, perceptual |
|---|---|---|
| `#000000` | C47 M42 Y40 K100 = 229% | C50 M46 Y44 K100 = 240% |
| `#1a1512` | C44 M40 Y39 K94 = 217% | — |
| `#1e1d1c` | — | C42 M36 Y33 K85 = 196% |
| `#901a12` | C2 M92 Y65 K48 = 207% | C0 M88 Y65 K37 = 190% |

The two columns agree to within ~10% TAC: the build does convert through
CRPC1, and CRPC1 caps TAC at about 240% on its own.

Vendor facts relied on (DriveThru Partners, "Quick Specifications for Print
Books", as quoted by the preset and #331): CMYK only; PDF/X-1a:2001 or
PDF/X-3:2002; total ink coverage <= 240%; "Use the CGATS21_CRPC1.icc color
profile to keep your book in range"; rich black C60 M40 Y40 K100; text <= 24pt
is 100% K only (section "Black Text Density"). CGATS 21-2 CRPC1 is the
coldset-newsprint reference printing condition, the smallest gamut of the seven
(ISO/PAS 15339-2). Its ICC registry name is `CGATS21-2-CRPC1`; `CGATS TR 001`
is the registry name for SWOP.

---

## Severity 1 — wrong measurements and inert code

### 1. `pdf.print.ink-coverage` measures the page MEAN, not TAC

- `lib/pdf-parse.ts` `getPerPageInkCoverage`: `gs -sDEVICE=inkcov` prints the
  mean coverage of each ink over the page as a fraction. The check sums the four
  means (`tac: p.sum * 100`) and compares the sum with `ink.maxTac`.
- Total Area Coverage is a per-PIXEL maximum. A page with a 400% solid on 10% of
  its area reports "40% TAC" and passes. The #419 test used a full-page solid,
  the one case where mean = max.
- Same false statement in: `checks/pdf/ink-coverage.ts` (name and message),
  `examples/academic-paper/paper.md` §6.7 ("reports the mean coverage" and then
  calls the sum TAC), user guide 06-validation ("the 240% ink limit"),
  `docs/docker.md` ("per-page ink-coverage validation"), ADR 0008, CHANGELOG
  0.11.22 (#419 entry), the user guide requirements table (01-getting-started).

Fix: rasterise each page to CMYK at a low resolution (`-sDEVICE=tiff32nc -r72`
or `psdcmyk`), compute `max(C+M+Y+K)` per page, flag pages whose max exceeds
`maxTac + tacTolerance`. Keep `inkcov` only as a cheap "ink used on this page"
figure if it is still wanted, and label it as a mean. Until then rename the
finding so it does not say "Total ink coverage". Add a unit test on a
synthetic page where mean and max differ (small 400% patch on a white page).

### 2. The UCR / BG "GCR for TAC limiting" in `pdfx-def.ps` is inert

- `lib/ghostscript.ts` `makePdfxDefPs`: defines `/UCR`, `/BG`, installs them via
  `<< /UCRFunction { UCR } /BGFunction { BG } >> setpagedevice`, defines
  `/MaxTAC` (never referenced), comment "custom GCR for TAC limiting".
- PostScript undercolour-removal / black-generation procedures act only in the
  legacy non-ICC conversion path (`-dUseFastColor`); with ICC colour management
  (the default, and what `-sOutputICCProfile` engages) they are ignored. VERIFY
  in Ghostscript's colour-management documentation; the repo's own measurement
  already shows it: with this UCR in force `#000` (K=1, remove 100% of CMY)
  would come out 0/0/0/100, and #331 measured 47/42/40/100.
- So `maxTac` passed into `convertToPdfxCmyk` does nothing, and every statement
  that `maxTac` is "what a PDF/X build holds the ink to" is false:
  `schema/manifest.types.ts:25`, user guide 06-validation options table,
  CHANGELOG 0.11.23 ("maxTac is also what a PDF/X build holds the ink to"),
  `docs/schema-autocomplete.md`. The ink IS bounded, by the output profile:
  CRPC1's B2A table tops out near 240%.

Fix: delete the UCR/BG/MaxTAC block and the `maxTac` parameter of
`convertToPdfxCmyk` (and its call in `build-runner.ts`). Document: "the output
profile sets the ink limit; CGATS21_CRPC1 holds it to about 240%". Make
`maxTac` a check threshold only. When `pdfx.icc` is not the shipped CRPC1,
log a warning that the configured `maxTac` is not enforced by the conversion.
Update the `ghostscript.test.ts` expectations for the definition file.

### 3. The PDF/X OutputIntent identifier names the wrong printing condition

- `makePdfxDefPs`: for `x1a`, `/OutputConditionIdentifier (CGATS TR 001)`;
  `CGATS TR 001` is the ICC characterization-data registry name for SWOP. The
  embedded `/DestOutputProfile` is CRPC1, registry name `CGATS21-2-CRPC1`. For
  `x3` the identifier is the FILE name `CGATS21_CRPC1`. `/OutputCondition` and
  `/Info` are the file name too.
- A conforming PDF/X consumer may cross-check the identifier against the
  registry and the embedded profile. `checks/pdf/pdfx-structure.ts`
  `getPdfxOutputIntentIssues` only asserts `/S /GTS_PDFX` and that
  `/DestOutputProfile` resolves; the integration tests only assert "no issues".
  ENGINE.md §11 "there is no silent non-conformant PDF" is therefore not true.

Fix: write `CGATS21-2-CRPC1` for both flavours when the shipped profile is in
use; derive the identifier from the profile (a small table keyed by the ICC
description, falling back to the profile description string plus a build
warning when the profile is unknown), set `/OutputCondition` to a readable
"CGATS 21-2 CRPC1 (ISO 15339-2)". Extend `getPdfxOutputIntentIssues` to
report an identifier that does not match the embedded profile's description,
and assert the value in `pdfx-markers.integration.test.ts`.

### 4. TrimBox is the sheet, not the trim, on every `dtrpg` build

- Two geometry models disagree. `engine/shared/print-area.ts` is the manifest's
  `page.bleed`: in-sheet bleed on the top, bottom and outside edges, none at
  the spine (what DriveThru specifies). `engine/compiler/tier2.ts` `PageTrim`
  is the CSS `@page { bleed }` model: symmetric, outside the trim,
  `media = trim + 2*bleed + 2*slug`.
- `lib/engine.ts` `buildNativePdf` passes no `bleedPt`/`slugPt` to the
  compiler, so `g.bleed` comes only from CSS. A book with no CSS `bleed` (every
  gp-dimm-city book) gets `postprocess.ts:92` `set("TrimBox", media)`: the PDF
  declares an 8.625 x 11.25in trim. DriveThru does not read TrimBox, so it
  prints; the file is wrong for any other vendor, and `pdf.print.bleed` is
  switched off in the preset to hide it (`presets.ts:135`).
- `checks/pdf/bleed.ts` assumes bleed on both horizontal edges
  (`mediaW - trimW < bleedSize * 2 * 0.9`), so even a correct dtrpg TrimBox
  (bleed on one horizontal edge) would warn.
- `examples/academic-paper/paper.md` §4.9 ("`MediaBox`, `BleedBox` and
  `TrimBox` from the geometry of Section 6.5") describes only the CSS path.

Fix: thread `page.bleed` and `page.gutter` (the resolved print area) into
`postprocess`; write TrimBox per page, mirrored by page parity (no inset at the
binding edge), `BleedBox = MediaBox`; teach `pdf.print.bleed` the three-edge
model and re-enable it for `dtrpg`; correct the paper and the preset comment.
Keep the CSS `@page { bleed }` path working; when both exist, say which wins.

## Severity 2 — fragile or undocumented colour-management assumptions

### 5. The conversion profile is assumed, not verified

- `-sOutputICCProfile` is relied on as the RGB->CMYK conversion profile for
  pdfwrite. #331 shows it is honoured by gs 10.06; published experiments on gs
  9.27 found it ignored for vector colour in pdfwrite. Chromium is pinned
  (`REQUIRED_MILESTONE`); Ghostscript has no minimum version. The integration
  test only asserts red -> M, Y > 0.7, which any CMYK profile satisfies. The
  downstream design system's comments record `#000 -> C72 M68 Y67 K88 = 295%`,
  the signature of Ghostscript's `default_cmyk.icc`, so at some point this
  pipeline did convert through the wrong profile.
- Rendering intent and black-point compensation are left to Ghostscript's
  defaults and not documented.
- `-dOverrideICC=true` discards embedded SOURCE profiles: an AdobeRGB or
  ProPhoto JPEG is treated as sRGB and shifts. Not documented.

Fix: log the resolved profile's description at conversion time; make the
integration test assert the CRPC1 signature (`#000` -> K 100, C 45..52,
TAC <= 245) so a profile that is silently ignored fails CI; warn when gs < 10.
Do NOT change `-dRenderIntent`, `-dBlackPtComp` or `-dOverrideICC` in a fix PR
(that changes every book's colour); document the current behaviour in
`docs/publishing.md` ("images are converted as sRGB; Ghostscript's default
rendering intent") and record the open decision.

### 6. K-only black text: provenance and threshold

- `presets.ts` labels `blackText: k-only` "CONVENTION ... Not a DriveThru
  rule"; the user guide (08-publishing), `docs/schema-autocomplete.md`, #331
  and the check's own message say DriveThruRPG requires it. DriveThru's spec
  does state it ("Black Text Density": text at 24pt or below is 0/0/0/100).
  Tag it SPEC everywhere.
- `black-text-gray.ts` `MAX_CHANNEL = 0.12`, `MAX_SPREAD = 0.04` catches
  `#1e1d1c` but not the warm dark inks a design system uses for headings and
  labels (`#2f2622` prints C36 M36 Y33 K76 on four plates). The
  `pdf.print.black-text` remedy "make the text black (#000)" fights any palette
  with a warm ink.

Fix: add `pdfx.blackText: k-only-neutral` (any low-chroma text,
`max - min <= 0.04`, rewritten to DeviceGray at its luminance, so dark greys
print on the K plate alone), keep `k-only` as is, and make the check's advice
name the new mode. Fix the provenance tag in `presets.ts`.

### 7. The `book` preset also defaults to CRPC1

- `BOOK_PRESET.pdfx.icc = profiles/CGATS21_CRPC1.icc` with `ink.maxTac: 400`.
  A generic trade book built `--format pdfx` is compressed to a newsprint-gamut
  profile. CRPC1 is right for `dtrpg` only because DriveThru names it.

Fix (docs in this PR; a profile change is a product decision): state in
`docs/publishing.md` and the preset comment that the profile sets the gamut
and the ink limit, that CRPC1 is DriveThru's small-gamut condition, and that a
coated-stock vendor needs its own profile via `pdfx.icc` (GRACoL2013 CRPC6 and
ECI ISO Coated v2 are redistributable).

## Severity 3 — documentation that is stale, contradictory or misleading

- User guide 03-visual-elements "Use RGB ... Ghostscript handles CMYK conversion
  automatically": true mechanically; add that the target is a small-gamut
  condition, that saturated sRGB shifts (dE 10-16 for neon magenta/indigo), and
  how to soft-proof (Acrobat Output Preview with `profiles/CGATS21_CRPC1.icc`).
- User guide 06-validation "Asset checks ... unsupported color profiles": no such
  check exists (`checks/asset/`: approved-fonts, extensions, font-license,
  image-alpha, file-size). Remove.
- User guide 08-publishing tip validates `my-book-pdf.pdf --target dtrpg`: the RGB
  file fails `color-spaces` and both `pdfx-*` checks by construction; name
  `-pdfx.pdf`. Also: the plain PDF is saved with `useObjectStreams: true`
  (`postprocess.ts`), and `color-spaces`, `transparency` and `bleed` are
  raw-byte scans, so against a plain PDF they silently miss compressed
  dictionaries. Either decompress before scanning (qpdf `--qdf`) or state that
  these checks are meaningful only on the PDF/X artifact.
- 300 DPI: `docs/publishing.md` "DriveThruRPG asks for 300 DPI colour images" vs
  `presets.ts` "DriveThru's quick spec does not state one". Pick one.
- `commands/build.ts:23` `--icc` "required for --format pdfx" and
  `examples/with-design-guide/design-guide/101-publishing.md` say the same; the
  preset supplies a default. Stale.
- `checks/pdf/color-spaces.ts` calls Separation/DeviceN "not allowed": PDF/X-1a
  permits spot colours; DriveThru forbids them. Label it a vendor rule.
- `website/site/index.html` "ICC profile for offset printers": the shipped
  profile is a newsprint reference condition used by a digital POD vendor.
- `docs/engine/ENGINE.md` §11 "no silent non-conformant PDF": items 3 and 5.
- `docs/docker.md:108` "per-page ink-coverage validation": item 1.

---

## Work list for the fix PR

Code
- [x] `pdf-parse.ts` / `ink-coverage.ts`: per-pixel max TAC (item 1), unit test with mean != max.
- [x] `ghostscript.ts`: remove UCR/BG/MaxTAC; drop `maxTac` from `convertToPdfxCmyk` and its caller (item 2); warn when the profile is not CRPC1.
- [x] `ghostscript.ts`: correct OutputConditionIdentifier / OutputCondition, derived from the profile (item 3).
- [x] `pdfx-structure.ts`: identifier <-> profile consistency finding (item 3); assert in the integration test.
- [x] `engine.ts` + `postprocess.ts` + `bleed.ts` + `presets.ts`: three-edge TrimBox/BleedBox from `page.bleed`/`page.gutter`, mirrored per page; bleed check updated and re-enabled for dtrpg (item 4).
- [x] `ghostscript.integration.test.ts`: assert the CRPC1 signature for `#000`; log the profile description at build time; warn on gs < 10 (item 5).
- [x] `black-text-gray.ts` + `black-text.ts` + `manifest.types.ts` + schema: `k-only-neutral` (item 6).
- [x] `presets.ts`: `blackText` provenance SPEC (item 6); `book` preset comment (item 7).
- [x] `commands/build.ts`: `--icc` help text.
- [x] `color-spaces.ts`: message wording (vendor rule).

Docs
- [x] `docs/publishing.md`: ink limit comes from the profile; CRPC1 gamut; soft-proofing; sRGB assumption; rendering intent note; 300 DPI provenance.
- [x] `docs/schema-autocomplete.md`, `schema/manifest.types.ts`: `maxTac` is a check threshold.
- [x] User guide 01 (requirements table: ink row), 03 (colour-space section), 06 (asset-check example; ink row; checks table), 08 (validate the pdfx file).
- [x] `examples/academic-paper/paper.md` §4.9 and §6.7.
- [x] `docs/docker.md`, `docs/engine/ENGINE.md` §11, ADR 0008 wording, website copy.
- [x] CHANGELOG under Unreleased: one line per behaviour change.

## Outcome

Every item in the work list was implemented, with these deliberate
differences and omissions:

- **Item 4, plumbing.** `lib/engine.ts` is unchanged. The compiler already
  reads the manifest's print area from the book's `gp-print-area` meta
  (`engine/compiler/build.ts`), so `postprocess` takes `printArea.bleed` from
  there. `page.gutter` is not threaded: it is a safe-area inset at the binding
  edge, and the TrimBox does not depend on it. When a CSS `@page { bleed }` or
  slug exists it wins (that sheet was grown around the trim on every side);
  `postprocess.ts` and `docs/publishing.md` say so.
- **Item 4, the bleed check.** Re-enabling `pdf.print.bleed` needed more than
  the three-edge rule: its raw-byte scan cannot see page dictionaries in the
  plain PDF's object streams, so it would have reported "could not parse
  MediaBox" there. It now reads every page's boxes with pdf-lib
  (`inspectPdf`). The `dtrpg` publish target's overlay was not changed, so a
  `book`-preset book validated for `dtrpg` keeps the check off (that preset
  has no in-sheet bleed).
- **Item 1.** `inkcov` is removed rather than kept: the CMYK raster
  (`pamcmyk32`, 72 DPI) already gives the C/M/Y/K of each page's heaviest spot,
  which the finding now prints, so a mean figure added nothing.
- **Item 3, the table.** Only `CGATS21_CRPC1.icc` -> `CGATS21-2-CRPC1` is in
  the profile table. I did not add GRACoL or FOGRA entries whose exact ICC
  description strings I could not check against the files. The
  identifier-vs-profile finding judges only a profile in that table; for any
  other profile it stays silent, because a third-party file's legitimate
  registry name (for example `FOGRA39` over "Coated FOGRA39 ...") would
  otherwise be an error.
- **Item 3, a small factual correction.** The x1a identifier the code wrote
  was `CGATS TR001` (no space), not `CGATS TR 001` as quoted above. Both name
  SWOP, so the finding stands.
- **Item 6, threshold.** `k-only-neutral` uses `max - min <= 0.04` as decided.
  That does not cover the example given for this item: `#2f2622` has a spread
  of 13/255 = 0.051, so it stays four-colour and `pdf.print.black-text` still
  warns about it. The check's advice says a coloured ink stays four-colour.
  Near-black text still goes to `0 g` (100% K) under `k-only-neutral`, as under
  `k-only`.
- **Item 5.** `-dRenderIntent`, `-dBlackPtComp` and `-dOverrideICC` are
  unchanged, as decided; `docs/publishing.md` documents the current behaviour
  and records the open decision.
- **Item 7.** The `book` preset still defaults to CRPC1, as decided; only its
  comment and the docs changed.
- **Severity 3, raw-byte scans.** `pdf.print.color-spaces` and
  `pdf.print.transparency` still scan raw bytes. `docs/publishing.md` and the
  user guide say they are meaningful only on the `-pdfx.pdf` file, the second
  option the review allowed.
- **`docs/schema-autocomplete.md`.** It did not claim that the conversion
  holds the ink to `maxTac`; the claim was in `manifest.schema.json`'s `maxTac`
  description, which is corrected. schema-autocomplete gained the
  threshold-only sentence and `k-only-neutral`.
- **Released CHANGELOG entries** (0.11.22, 0.11.23) are left as history; the
  Unreleased entries correct them.
- **Not verified locally.** Ghostscript and qpdf are not installed in the
  session that made the fix, so the integration tests skip here and run in CI:
  that `pamcmyk32` writes ink amounts (0 = no ink), that the converted file
  keeps the per-page TrimBox, CRPC1's separation of `#000`, the written
  identifier, and the qpdf success path with the real profile. A local
  `--format pdf` build of `examples/with-print-effects` writes TrimBoxes
  `[0 9 612 801]` on odd pages and `[9 9 621 801]` on even pages, and
  `pdf.print.bleed` passes on it.
- **Seen but not changed** (outside this review): the user guide's
  validation chapter lists "ink coverage estimates" among the heuristic
  checks, but no heuristic check measures ink; the website copy also claims
  PDF/A output.


## Addendum (2026-11-04, after the first CI run of the fix PR)

CI (Ubuntu 24.04, Ghostscript 10.02.1) failed the two integration tests the fix
added. Reproduced in a container with the same `ghostscript` package:

- **Ghostscript 10.02.1 ignores the output profile for pdfwrite's vector
  colour.** With the build's exact arguments, `#000` separates to
  `0.722 0.675 0.671 0.882 k` (C72 M68 Y67 K88 = 295%), red to `0 0.996 1 0 k`,
  `#c026d3` to `0.404 0.851 0 0 k` (C41 M85): Ghostscript's `default_cmyk.icc`,
  and exactly the figures gp-dimm-city's token comments record. Adding
  `-sDefaultCMYKProfile`, `-dRenderIntent=1`, or dropping `-dOverrideICC`
  changes nothing. DeviceGray (`0 g`, `0.5 g`) and DeviceCMYK fills pass
  through untouched, so the K-only text path is unaffected. Ghostscript 10.03.0
  and newer honour the profile: Artifex bug 707350, fixed by commit 7ddd455a2
  ("pdfwrite - fix OutputICCProfile", 2023-11-30; pdfwrite reset the device
  profile to the default whenever ColorConversionStrategy was set). Measured:
  10.05.0 (Ubuntu 25.10's package) and 10.06.0 (#331) both separate `#000` to
  C47 M42 Y40 K100 = 228%. So the plugin's "wrong" TAC figures (Finding 1 of its audit)
  were right for the Ghostscript its author had; the pipeline's output depends
  on the Ghostscript version, and nothing said so.
- **Fix.** No flag fixes 10.02.1, so the build requires the release that has
  the fix: it warns when `gs --version` is below 10.03.0, naming the
  consequence and the packages that are new enough. (An intermediate revision
  measured instead of assuming, converting a `#000` swatch before every build
  and reading the separation back; once the fix was traced to one release
  that was more machinery than the fact needed, and it was removed.) CI runs
  the Checks job on
  Ubuntu 26.04 (ghostscript 10.06.0 from apt) and the Docker image moves to
  Debian 13 (`node:22-trixie-slim`, ghostscript 10.05); nothing is compiled or
  fetched outside the distributions' packages, and the Checks job and the
  image both assert `gs --version` is 10.03 or newer. An earlier revision of
  this PR built 10.06.0 from Artifex's source tarball in CI and in the image;
  that worked but was a dependency to maintain, and the packaged versions make
  it unnecessary. The install docs name the versions.
- **Artifex's snap ruled out.** The first CI attempt installed the 10.06.0
  snap in devmode: `gs --version` answered, and every conversion, in the
  tests that had passed on apt's 10.02.1 as well, failed with
  `GPL Ghostscript 10.06.0: Unrecoverable error`. snapd gives a snap a private
  `/tmp`, and that is where Gutterpress and its tests stage files. The docs no
  longer suggest it. The integration tests keep asserting CRPC1's signature, so a CI
  Ghostscript that stops honouring the profile fails loudly.
- **`inkcov` was never a mean either.** Measuring a 72% cyan solid with
  `-sDEVICE=inkcov` reports 1.0: the device reports the share of the page each
  ink touches, not the amount. Item 1 and the paper's "mean coverage" were both
  wrong about what the old check measured; the per-pixel raster replaces it.
- **The TrimBox test literal was wrong, not Ghostscript.** pdf-lib's
  `setTrimBox(x, y, width, height)` with `(0, 9, 135, 126)` writes
  `[0 9 135 135]`, which is the intended three-edge box; 10.02.1 preserved it
  exactly. The expectation now reads `[0, 9, 135, 135]`.
- **UCR/BG confirmed inert (item 2).** With the block deleted, 10.02.1 writes
  the same `0.722 0.675 0.671 0.882 k` the plugin measured when the block was
  present.
- **Not verified here.** The container could not execute the downloaded 10.06.0
  binary (its policy forbids running fetched code), so 10.06.0's behaviour
  rests on #331 and on CI, which now runs it.
