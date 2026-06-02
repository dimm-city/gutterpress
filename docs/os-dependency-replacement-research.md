# OS Dependency → npm Replacement Research

> Status: research / proposal (no code changed). Compiled 2026-06-01.
>
> Goal: map every operating-system dependency print-md currently shells out to,
> and identify the best Node.js / WASM / pure-JS replacement for each — with
> honest pros, cons, and limitations. The driving requirement is **eliminating
> the *system* dependency** (no `brew install` / `apt install` / system PATH
> tool), evaluated against this repo's hard constraints: the CLI is compiled
> with `bun build --compile` into a single self-contained binary, and the viewer
> bundles the lib into Electron.

---

## 1. Current OS dependencies and exactly how they're used

Every external tool is spawned through `packages/lib/src/lib/exec.ts`
(`execCapture` / `run`) or probed via `tool-probe.ts`. The canonical inventory
lives in `packages/lib/src/lib/diagnostics.ts`.

| OS tool | Where | What it does | Required? |
|---|---|---|---|
| **Chromium / Chrome / Edge** (puppeteer-core) | `lib/chromium.ts`, PDF render | Renders HTML+Paged.js → PDF (`page.pdf()`) | **Required** (every render) |
| **qpdf** | `lib/ghostscript.ts` `stripAnnotations`; 9 checks | `--flatten-annotations=all` (PDF/X); `--check`, `--list-all-objects`, `--json=1` (validation) | Required for PDF/X strip; optional for checks |
| **gs (Ghostscript)** | `lib/ghostscript.ts`; 2 checks | RGB→CMYK PDF/X conversion + ICC + TAC limiting; `/Creator` stamp; `-sDEVICE=inkcov` ink coverage | Required for `--format pdfx`; optional otherwise |
| **pdfinfo** (Poppler) | `pdf-parse.ts`; 4 checks | Page size in points (`-box`) | Optional (checks) |
| **pdffonts** (Poppler) | `pdf-parse.ts`; 1 check | Font list + embedded flag | Optional |
| **pdfimages** (Poppler) | `pdf-parse.ts`; 3 checks | Raster image list + dimensions + DPI (`-list`) | Optional |
| **pdftotext** (Poppler) | `pdf-parse.ts`; 2 checks | Per-page text extraction (`-f N -l N`) | Optional |
| **identify** (ImageMagick) | 3 asset checks | Image dimensions, DPI, alpha, color space | Optional |
| **grep** | 2 checks | Raw byte-scan PDF for `/Transparency`, `/SMask`, `/DeviceRGB`, … | Optional |
| **markdownlint-cli2** | `checks/source/markdownlint.ts` | Lint markdown source | Optional |
| **htmlhint** | `checks/source/htmlhint.ts` | Lint generated HTML | Optional |

Three tiers of difficulty emerge:

- **Trivial pure-JS wins:** grep, markdownlint-cli2, htmlhint.
- **Solid pure-JS / prebuilt wins:** Poppler suite (pdfinfo/pdffonts/pdfimages/pdftotext), ImageMagick `identify`.
- **Hard / not fully replaceable:** Ghostscript PDF/X CMYK conversion, and Chromium (cannot be removed without abandoning Paged.js).

---

## 2. The easy wins (pure JS, zero OS dependency, high confidence)

### grep → `node:fs` `readFile("latin1")` + `String.includes`

No package needed. The two checks (`transparency.ts`, `color-spaces.ts`) only
scan for literal ASCII markers in the PDF's uncompressed bytes.

```js
import { readFile } from "node:fs/promises";
const data = await readFile(pdfPath, "latin1"); // latin1 = lossless byte↔char
const hasTransparency = data.includes("/Transparency");
```

- **Pros:** zero deps, exact behavioral equivalent of grep, bundles with nothing.
- **Limitation (identical to grep):** markers inside FlateDecode-compressed
  streams are invisible to a raw scan. grep had the same blind spot, so this is
  a like-for-like swap, not a regression. Use `latin1`/`Buffer`, **never** `utf8`.
- **Confidence: HIGH.**

### markdownlint-cli2 → `markdownlint` core library

The engine behind the CLI is already pure JS. Import it directly; do **not**
shell out and don't even need the cli2 wrapper.

```js
import { lint } from "markdownlint/sync";
const results = lint({ files: ["doc.md"], config: { default: true } });
if (Object.values(results).some(a => a.length)) console.error(results.toString());
```

- `markdownlint` **0.40.0**, MIT, **ESM-only, Node ≥20**. Built-in `.toString()`
  gives CLI-equivalent text output for free.
- **Pros:** same engine as the CLI, no native deps, inline config avoids on-disk
  config discovery (good for `--compile`).
- **Cons:** ESM-only (non-issue — the lib is already pure ESM).
- **Confidence: HIGH.**

### htmlhint (CLI) → `htmlhint` library

Same package, programmatic API — just call it instead of spawning.

```js
import { HTMLHint } from "htmlhint";
const messages = HTMLHint.verify(html, HTMLHint.defaultRuleset);
```

- `htmlhint` **1.9.2**, MIT, dual CJS/ESM, Node ≥18.
- **⚠️ Gotcha:** `HTMLHint.verify(html, {})` (empty object) applies **NO** rules
  and does *not* fall back to defaults; a partial ruleset does not merge with
  defaults. Pass `HTMLHint.defaultRuleset` (or spread it) explicitly.
- **Confidence: HIGH.**

---

## 3. Poppler suite + qpdf inspection → `pdfjs-dist` (+ `unpdf`)

All PDF *inspection* (reading a finished PDF) can move to Mozilla's PDF.js.
**`pdfjs-dist`** (6.x, **Apache-2.0**, pure JS, no `.wasm`) is the primary engine;
**`unpdf`** (MIT, ~2 MB, inlined worker, single-file) is a thin wrapper that
bundles cleanest for the `--compile` constraint — reach into its
`getDocumentProxy()` for the native PDF.js APIs unpdf doesn't surface.

| Capability (current tool) | PDF.js replacement | Confidence |
|---|---|---|
| Page size in pts (`pdfinfo -box`) | `page.getViewport({scale:1})` → width/height in points | **High** |
| Per-page text (`pdftotext -f -l`) | `page.getTextContent()` / `unpdf.extractText()` | **High** |
| Outlines/bookmarks (`qpdf --list-all-objects` regex) | `doc.getOutline()` | **High** |
| TOC link annotations | `page.getAnnotations()` filter `subtype==="Link"` | **High** |
| Page labels | `doc.getPageLabels()` | **High** |
| Font list + embedded (`pdffonts`) | `commonObjs` + `/Resources/Font` walk | **Medium** |
| Image dims + DPI (`pdfimages -list`) | `unpdf.extractImages()` (dims) + `getOperatorList()` CTM math (DPI) | dims High / **DPI Low–Med** |
| Structure check (`qpdf --check`) | full parse-and-iterate as a "loadable?" gate | **Low** (no true parity) |

- **Pros:** pure JS, Apache-2.0, no WASM (so no Bun `--compile` WASM bug), and the
  high-level nav APIs (`getOutline`/`getAnnotations`/`getPageLabels`) are *more
  reliable* than the current regex-over-qpdf-dump approach.
- **Cons / limitations:**
  - **Image DPI** has no direct API — must read the image's placed size from the
    content-stream transform matrix (`getOperatorList`) and divide pixels by
    placed inches. Highest accuracy risk of the set.
  - **`qpdf --check`** has no pure-JS equivalent. PDF.js can only tell you "does
    it parse"; it will not flag the subtle xref/stream-length defects qpdf
    reports on otherwise-openable files. This check degrades from "conformance"
    to "is it broken."
  - Font enumeration only reliably surfaces fonts that render visible text.
- **Rejected alternatives:**
  - **`mupdf`** (mupdf.js WASM) is technically the best single-package fit — it
    natively does *all* of these including fonts, image DPI, a real object tree,
    and integrity repair — but is **disqualified twice**: **AGPL-3.0** licensing,
    and an open Bun bug ([#18145](https://github.com/oven-sh/bun/issues/18145))
    where `bun build --compile` can't load `mupdf-wasm.wasm` at runtime.
  - **`pdf-lib` / `@cantoo/pdf-lib`** are creation/editing libs — keep only as an
    optional capability for raw object-graph walks; they cover none of the
    text/font/DPI/integrity needs.
  - **`pdf2json`** offers nothing PDF.js doesn't, on a lagging forked PDF.js base.

---

## 4. ImageMagick `identify` → `sharp` (viewer) / pure-JS combo (CLI)

`identify` is used by 3 asset checks for image dimensions, DPI, alpha, and color
space. There is no single pure-JS lib covering all of it, and the best
all-in-one (`sharp`) conflicts with the `--compile` rule.

**`sharp`** (Apache-2.0; libvips is LGPL-3.0) covers everything in one
`.metadata()` call — `width`, `height`, `density` (DPI), `space`
(srgb/cmyk/b-w), `channels`, `hasAlpha`, `hasProfile`, plus `.stats()` for ink
coverage. It ships **prebuilt binaries** (no system ImageMagick/libvips), but:

- It is **native code** resolved at runtime via platform-specific optional deps
  (`@img/sharp-*`) using `node_modules` path resolution — exactly the pattern
  CLAUDE.md rules 1 & 3 warn breaks under `bun build --compile`. **Not viable in
  the standalone CLI binary.**
- It is viable in the **Electron viewer** with `asarUnpack` (the native `.node`
  and shared libs can't load from inside an asar).
- Linux baseline: glibc ≥2.26 (x64) / musl ≥1.2.2 (Alpine), CPU with SSE4.2 —
  so "no extra install" but not literally zero-OS.

**Pure-JS combo** (zero native, fits `--compile`), at the cost of more glue:

| Capability | Pure-JS replacement | Note |
|---|---|---|
| Dimensions | `image-size` or `probe-image-size` | pure JS, header-only |
| DPI / density | `exifr` (JPEG/TIFF `XResolution`); PNG needs manual `pHYs` chunk read | `pngjs` does **not** expose pHYs |
| Alpha | `pngjs` (PNG `alpha`); TIFF via `ExtraSamples` tag | per-format |
| Color space | `utif2` (TIFF `PhotometricInterpretation`); JPEG APP14 marker logic; PNG color type | hand-rolled JPEG CMYK detection |
| Ink coverage | **no good pure-JS answer** — would need full pixel decode (slow) or be dropped/gated to sharp | — |

- **Recommendation:** use `sharp` in the **viewer** (one call, covers 1–5); use
  the **pure-JS combo** in the **compiled CLI** for caps 1–4, and either drop
  image ink-coverage there or gate it behind an optional sharp path.
- **Confidence:** sharp caps 1–4 **High**; pure-JS color space **Medium**; ink
  coverage **Medium / no pure-JS**.

---

## 5. The hard ones

### 5a. Ghostscript PDF/X CMYK conversion — **cannot be replaced in pure JS**

The `convertToPdfxCmyk()` path (RGB→CMYK, ICC output intent, PostScript UCR/BG
for TAC limiting, PDF/X-1a/X-3 keys, font subset/embed) is deeply
Ghostscript-specific. Verdict from research:

- **`mupdf`** can *rasterize* to CMYK but **cannot rewrite a vector PDF's content
  streams into DeviceCMYK with a chosen ICC output intent** and has no UCR/BG /
  TAC / PDF/X authoring API. **Not viable** for conversion.
- **Pure-JS color libs** (`color-convert`, lcms wrappers, pdf-lib) cannot walk a
  PDF's content streams/images/shadings and re-encode them to CMYK + embed an
  output intent. Building this is essentially reimplementing Ghostscript's
  `pdfwrite`. **Not viable.**
- **The only zero-system-dependency path is WASM Ghostscript** — i.e. you don't
  replace gs, you *embed* it. **`@okathira/ghostpdl-wasm`** (v1.1.0, Nov 2025) is
  the only currently-maintained build; `Module.callMain([...gsArgs])` takes the
  same argument surface, so the existing `ghostscript.ts` + `pdfx_def.ps` port
  nearly verbatim.
  - **Cons / risks:** single-maintainer (supply-chain risk); **AGPL-3.0** —
    bundling imposes AGPL obligations on distribution (needs explicit user
    sign-off); PDF/X output is **unverified** end-to-end (must smoke-test against
    the existing `pdfx-structure.ts` check); WASM gs is slower/heavier; the
    standard `inkcov` driver is likely **not** in the published build's driver
    set (would need a fork rebuild with `inkcov` added).
- **`/Creator` metadata stamp** *is* trivially replaceable with **`pdf-lib`**
  (`setCreator()`), pure JS, MIT.

**Recommended posture:** keep PDF/X **optional and lazy-loaded** (aligns with
"reduce complexity" + rule 2). Default pipeline produces a clean RGB PDF; CMYK/
PDF/X requires either a system `gs` *or* an opt-in WASM gs module. **Confidence:
HIGH that no pure-JS replacement exists; MEDIUM that WASM gs is production-ready.**

### 5b. Ink coverage (`gs -sDEVICE=inkcov`)

- **Option A:** fork `@okathira/ghostpdl-wasm` adding the `inkcov` driver, reuse
  existing parsing. **Option B:** render each page to a CMYK pixmap with
  `mupdf.js` and average channels (mupdf's sweet spot, but AGPL).
- Either way results are approximate (inkcov itself is). **Confidence: Medium-High.**

### 5c. Chromium — **cannot be removed without abandoning Paged.js**

**Paged.js is a JS polyfill that runs *inside* a live browser DOM and reads
computed layout from the browser's real layout engine.** There is no pure-JS or
WASM engine in 2026 that both (a) renders modern HTML/CSS at Chromium fidelity
and (b) supports CSS Paged Media. PDFium-WASM renders *existing* PDFs, not HTML.
`@react-pdf/renderer`, `pdfmake`, `jsPDF`+`html2canvas`, VMPrint, Servo/Blitz —
all either aren't HTML renderers, lack Paged Media, or aren't production-ready.

The realistic win is removing the **system-browser requirement**, not the binary:

1. **Keep system Chromium detection as the CLI default** (current state — zero
   bytes, full fidelity). **HIGH confidence / correct.**
2. **Add opt-in bundled Chromium via Playwright** (`PLAYWRIGHT_BROWSERS_PATH=0`
   hermetic install) for CI / browserless machines — ~120 MB browser fetched
   outside the `--compile` binary (first-run/post-install download). Removes the
   *system* dependency; does not fit inside the single executable. Reject
   `@sparticuz/chromium` (Linux/Lambda-only).
3. **Viewer: render via Electron's own Chromium** (`webContents.printToPDF()` /
   hidden `BrowserWindow`) instead of spawning external Chrome — the viewer
   already *is* Chromium. **Zero extra bytes, full fidelity, full Paged.js — the
   highest-leverage win in this report** (desktop app only; doesn't help the CLI).
4. **Only if Paged.js is abandoned:** WeasyPrint (Python) has native Paged Media
   and needs no browser, but it executes **no JavaScript** (so no Paged.js),
   swaps Chromium for a Python+Pango+Cairo toolchain, and would require
   re-authoring every DC spread. Different heavy dependency, not elimination.

---

## 6. Master map: tool → replacement → verdict

| OS dependency | Best replacement | Zero system dep? | Fits `bun --compile`? | Confidence | Notes |
|---|---|---|---|---|---|
| grep (PDF scan) | `node:fs` readFile + includes | ✅ | ✅ | HIGH | exact equivalent; compressed-stream blind spot = same as grep |
| markdownlint-cli2 | `markdownlint` lib | ✅ | ✅ | HIGH | ESM-only, Node ≥20 |
| htmlhint (CLI) | `htmlhint` lib `verify()` | ✅ | ✅ | HIGH | pass `defaultRuleset` explicitly |
| pdfinfo (page size) | `pdfjs-dist` `getViewport` | ✅ | ✅ | HIGH | — |
| pdftotext | `pdfjs-dist` `getTextContent` | ✅ | ✅ | HIGH | spacing differs from poppler (fine for the heuristic) |
| qpdf (outlines/links/labels) | `pdfjs-dist` `getOutline`/`getAnnotations`/`getPageLabels` | ✅ | ✅ | HIGH | more reliable than regex dump |
| pdffonts | `pdfjs-dist` font walk | ✅ | ✅ | MEDIUM | only fonts that render text |
| pdfimages (dims) | `unpdf.extractImages` | ✅ | ✅ | HIGH | — |
| pdfimages (DPI) | `pdfjs-dist` `getOperatorList` CTM math | ✅ | ✅ | LOW–MED | custom code, accuracy risk |
| qpdf --check | `pdfjs-dist` parse-gate | ✅ | ✅ | LOW | no true parity |
| identify (all) — viewer | `sharp` `.metadata()` | ⚠️ prebuilt, libc baseline | ❌ (native) | HIGH | use in viewer w/ asarUnpack |
| identify (dims/DPI/alpha/space) — CLI | `image-size`/`probe-image-size` + `exifr` + `utif2` + `pngjs` | ✅ | ✅ | MED–HIGH | multi-lib glue; PNG DPI = manual pHYs |
| identify (ink coverage) | `sharp` `.stats()` only | ❌ | ❌ | MED | no pure-JS answer; drop or gate |
| gs `/Creator` stamp | `pdf-lib` `setCreator()` | ✅ | ✅ | HIGH | — |
| gs inkcov | fork gs-WASM +inkcov, or mupdf CMYK pixmap | ✅ (WASM) | ⚠️ WASM-load | MED-HIGH | approximate |
| **gs PDF/X CMYK conversion** | **`@okathira/ghostpdl-wasm` (embed, not replace)** | ✅ (WASM) | ⚠️ WASM-load + AGPL | MED | no pure-JS option exists; keep PDF/X optional |
| **Chromium (render)** | **cannot remove** — Playwright (no system dep) / Electron printToPDF (viewer) | ⚠️ bundled binary | ❌ | HIGH | Paged.js requires a real browser |

---

## 7. Recommended phasing

1. **Phase 1 — free wins (no downside):** grep, markdownlint, htmlhint →
   pure JS. Removes 2 optional system deps and aligns lint with the lib's ESM.
2. **Phase 2 — PDF inspection:** move pdfinfo/pdffonts/pdfimages/pdftotext +
   qpdf-inspection checks to `pdfjs-dist`/`unpdf`. Removes Poppler entirely and
   most of qpdf. Accept degraded `qpdf --check` (parse-gate) and DPI (best-effort)
   — or keep those two checks optional-system-tool if strict parity matters.
3. **Phase 3 — images:** `sharp` in the viewer (asarUnpack); pure-JS combo in the
   CLI for dims/DPI/alpha/space; gate image ink-coverage behind optional sharp.
4. **Phase 4 — hard deps (decision required):**
   - PDF/X CMYK: keep optional; offer opt-in WASM gs **after** an AGPL sign-off
     and a PDF/X smoke test. qpdf `--flatten-annotations` (PDF/X strip) stays
     coupled to the same optional path.
   - Chromium: keep system detection as default; optionally add Playwright
     hermetic browser for browserless environments; switch the **viewer** to
     `webContents.printToPDF()` (independent, high value, do anytime).

**Net result if all phases land:** the *default RGB pipeline* and *all
validation checks* run with **zero system dependencies**; only **PDF/X (CMYK)**
and **HTML rendering** retain a heavy dependency — PDF/X as an opt-in WASM/system
gs, and rendering as a bundled-or-system Chromium that Paged.js fundamentally
requires.

---

## Appendix: key sources

- PDF.js / unpdf: <https://www.npmjs.com/package/pdfjs-dist>, <https://github.com/unjs/unpdf>
- mupdf disqualifiers: AGPL <https://www.npmjs.com/package/mupdf>; Bun bug <https://github.com/oven-sh/bun/issues/18145>
- WASM Ghostscript: <https://www.npmjs.com/package/@okathira/ghostpdl-wasm>
- sharp: <https://sharp.pixelplumbing.com/install/> (prebuilt platforms, asarUnpack, libc baseline)
- pure-JS image libs: `image-size`, `probe-image-size`, `exifr`, `utif2`, `pngjs`
- Paged.js requires a browser: <https://github.com/pagedjs/pagedjs/>
- Playwright hermetic browsers: <https://playwright.dev/docs/browsers>
- markdownlint: <https://github.com/DavidAnson/markdownlint>; htmlhint: <https://github.com/htmlhint/HTMLHint>
</content>
</invoke>
