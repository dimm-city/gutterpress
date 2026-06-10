# Paged.js cross-browser compatibility audit (issue #46, Phase 1)

**Date:** 2026-06-10
**Scope:** the live **preview** only. PDF export always renders in Chromium
(puppeteer-core in the CLI, Electron's `webContents.printToPDF` in the viewer)
and is unaffected by anything in this document.
**Paged.js version under test:** 0.4.3 (the vendored
`packages/lib/src/assets/vendor/paged.polyfill.js`).

## Verdict (summary)

**No layout collapse and no broken suspect feature was found on Firefox or
WebKit.** All five features flagged in issue #46 rendered correctly and
measurably identically in all three engines. The one real cross-engine
difference is **page-count drift from font-fallback metrics** (WebKit rendered
the user guide ~10% shorter), which is reflow, not breakage. Evidence limits
are listed at the end — notably, this was Playwright's Linux WebKit 26.4, not
Safari 17 on Apple hardware, and Chrome for Android was not tested.

## Methodology

- **Engines** (Playwright 1.60.0, headless, Linux x64):
  - Chromium 148.0.7778.96 (baseline)
  - Firefox 150.0.2 (Playwright build v1522)
  - WebKit 26.4 (Playwright build v2287)
- **Projects rendered** (served by the real preview server,
  `bun packages/cli/src/cli.ts preview <project> --open false --port N`):
  1. `examples/print-md-user-guide` — string-set/string() running headers,
     custom properties in `@page` margin boxes, named pages
     (`chapter`/`cover`/`toc`), `:left`/`:right`/`:blank` pages,
     `.two-column`/`.three-column` utilities.
  2. `examples/with-design-guide/design-guide` — same feature set plus
     `full-bleed` named page and `.two-column` content in flow.
  3. `packages/cli/tests/compat/fixtures/feature-probe` — synthetic fixture
     adding `position: running()` → `content: element()` (used by **no**
     shipped example) and distinctive, measurable values for every suspect
     feature.
- **Render-completion signal:** the `renderingComplete` CustomEvent that
  `pagedjs-interface.js` dispatches on the preview window after pagination —
  captured via a Playwright init script registered before any page script runs
  (init scripts run in every frame, so this works through the preview shell's
  iframe at `/` as well as a direct `/book.html` load). No timeouts were used
  as the success signal.
- **Measurement:** `packages/cli/tests/compat/audit-probe.mjs` evaluates the
  rendered DOM in the preview frame: `.pagedjs_page` count, named-page classes
  and content-area insets, margin-box `::after` computed `content` (this is
  where Paged.js materialises `string()` and `counter(page)`), computed
  font/color of margin boxes that use `var(--…)`, physical relocation of the
  `position: running()` sentinel into margin boxes, computed column-count plus
  measured child x-positions for multi-column sections, page bounding-box
  sizes, console errors, and uncaught page errors.

A DOM-measurement note that matters for anyone re-running this: Paged.js
renders `@page` margin-box content as a **`::after` pseudo-element on
`.pagedjs_margin-content`** — `string()` is pre-resolved to a literal string
per page, `counter(page)` stays live. `textContent` of margin boxes is empty
even when headers render correctly; probes must read
`getComputedStyle(el, "::after").content`. Running **elements**
(`content: element(name)`) are the exception: those are real DOM nodes moved
into the margin box.

## Results matrix

### Whole-document render

| Project | Chromium | Firefox | WebKit |
|---|---|---|---|
| print-md-user-guide pages | **59** | 58 (−1.7%) | 53 (−10.2%) |
| with-design-guide pages | **63** | 62 (−1.6%) | 63 (0%) |
| feature-probe pages | **4** | 4 | 4 |
| Console errors / page errors | 0 / 0 | 0 / 0 | 0 / 0 |
| Page sheet size | 816×1056 | 816×1056 | 816×1056 |
| `renderingComplete` fired | yes | yes | yes |
| Layout collapse (0-sized content pages) | none | none | none |

(The design guide shows one trailing 0×0 empty sheet — present **identically
in all three engines**, so it is a pre-existing Paged.js artifact of that
document, not a compatibility issue.)

### Suspect features (issue #46 list)

Evidence from the feature-probe fixture, cross-checked against the two
examples. "OK" means measured-identical to the Chromium baseline, not assumed.

| Feature | Chromium | Firefox | WebKit | Evidence |
|---|---|---|---|---|
| `@page` named pages + chapter breaks | OK | OK | OK | `pagedjs_<name>_page` classes emitted identically; `@page probe-named { margin-top: 2.5in }` measured as content-top 240px vs default 84px in **all** engines; every chapter `h1` starts a fresh page in all engines |
| Custom properties inside `@page` margin boxes | OK | OK | OK | Margin box computed style `font-family: Georgia, serif; color: rgb(170,34,34); font-size: 12px` (the `var(--probe-*)` token values) identical in all engines; same for the examples' `var(--font-display)`/`var(--color-ink-*)` headers |
| `string()` / `content()` running headers | OK | OK | OK | Chapter titles ("Getting Started", …) present as literal strings in margin-box `::after` content; counts track page counts per engine (e.g. user guide: 48/47/43 header boxes for 59/58/53 pages — proportional, no missing headers) |
| Multi-column layout | OK | OK | OK¹ | `.section.probe-columns` and the design guide's `.two-column`: computed `column-count: 2`, children measured at 2 distinct x-positions, identical section width (648px / 617px) in all engines |
| `position: running()` → `content: element()` | OK | OK | OK | Sentinel paragraph physically removed from page flow (`stillVisibleInFlow: false`) and present in `@bottom-left` margin boxes (`movedToMarginBox: true`) in all engines |
| `counter(page)` folios | OK | OK | OK | `counter(page)` present in bottom margin-box `::after` on every content page in all engines |
| `:left` / `:right` / `:blank` page selectors | OK | OK | OK | Left/right margin asymmetry and suppressed headers on blank pages applied in all engines (user guide) |

¹ Column *balancing* (where text falls within the columns) inherits each
engine's own multicol implementation and differs slightly; the structure
(column count, gap, two distinct text bands, forced `@column-break`) is
correct everywhere. The known Paged.js/WebKit fragility around `.col-split` +
flex fragmentation (project memory) was not re-tested here because no shipped
example exercises it in this branch.

## Classified findings

### F1 — Page-count drift on WebKit (degraded, not broken)

The user guide renders 53 pages on WebKit vs 59 on Chromium. The drift
accumulates gradually (chapter starts at page 4/4/3, then 10/10/8, …,
53/52/47), with no missing content, no blank pages, and every chapter break
honoured.

- **Classification:** engine font-metric / text-measurement difference, **not**
  a Paged.js bug and not a print-md pattern. The stylesheets request
  `"Helvetica Neue", Helvetica, Arial, sans-serif`; on Linux each engine
  resolves a different fallback with different metrics, so lines wrap
  differently and pages fill differently. Firefox's −1 page is the same
  phenomenon at smaller magnitude.
- **Impact:** preview page numbers on non-Chromium browsers will not match the
  exported PDF (which is always Chromium-paginated).
- **Recommended handling:**
  1. Document as a known limitation in the user guide: *"the preview in
     Safari/Firefox may paginate slightly differently from the exported PDF;
     the PDF (Chromium) is authoritative."*
  2. Projects that need pixel-faithful cross-browser previews should ship
     embedded `@font-face` fonts rather than system font stacks (the DC design
     guide already does; the generic examples do not).
  3. The CI smoke test allows ±20% page-count deviation from the Chromium
     baseline; tighten if/when examples move to embedded fonts.

### F2 — Trailing 0×0 sheet in the design guide (cross-engine, pre-existing)

One zero-sized `.pagedjs_page` with no content appears at the end of
`with-design-guide/design-guide` in **all three engines**.

- **Classification:** Paged.js upstream artifact (or a print-md content/CSS
  edge at end-of-document) — explicitly **not** a cross-browser issue.
- **Recommended handling:** track separately; out of scope for #46.

### F3 — No WebKit/Firefox blockers found in Paged.js 0.4.3 for the shipped feature set

Every feature in the issue's suspect list works because Paged.js does the
paged-media work itself in JS and emits plain block DOM + ordinary CSS
(classes, custom properties, `::after` content), which all three engines
handle. The historical "Paged.js breaks outside Chromium" reports mostly
predate 0.4.x or involve features print-md does not use (e.g. `:nth()` page
selection, `target-counter()` cross-references — **not** audited here, see
limitations).

## Test infrastructure added (this worktree)

| Path | What it is |
|---|---|
| `packages/cli/tests/compat/audit-probe.mjs` | Evidence-gathering script: renders a running preview in all three engines, waits for `renderingComplete`, emits a JSON feature-probe report. Used to produce this audit; re-runnable. |
| `packages/cli/tests/compat/preview-smoke.spec.ts` | Playwright test: renders user guide + design guide + feature probe in chromium/firefox/webkit; asserts render completes, page count > 0 and equals the event's `totalPages`, zero collapsed content pages, no uncaught errors, page count within ±20% of the Chromium baseline. **Status: 3/3 passing locally.** |
| `packages/cli/tests/compat/playwright.config.ts` | Runner config; starts the three preview servers via `webServer` (ports 4111–4113). |
| `packages/cli/tests/compat/fixtures/feature-probe/` | Synthetic project exercising `position: running()`, custom props in margin boxes, named pages, `string()`, `@column-break`. |
| `docs/compat/proposed-ci-preview-cross-browser.yml` | **Proposed** GitHub Actions job (not active; existing workflows untouched). |

Run locally:

```sh
bun install && bun run build:lib
cd packages/cli
node_modules/.bin/playwright install --with-deps chromium firefox webkit
node_modules/.bin/playwright test -c tests/compat/playwright.config.ts
```

## What was NOT verified (evidence limits)

Be explicit about these before claiming Safari/Firefox support:

1. **Real Safari 17 on macOS/iOS.** Playwright's WebKit 26.4 on Linux is a
   newer WebKit with a non-Apple font/graphics stack. Safari 17-specific bugs
   (and iOS viewport/scrolling behaviour) are **unverified**. A macOS runner
   (`macos-latest` + the same spec) or manual Safari testing is still needed
   before 0.6.0.
2. **Chrome for Android.** Not installable in this environment; untested.
3. **`examples/dc-design-guide`** does not exist on this branch (only
   `print-md-user-guide`, `with-design-guide`, `with-validation`), so the
   issue's reference to it was satisfied with `with-design-guide` + the
   synthetic fixture. The DC plugin's heavier CSS (clip-paths, drop-shadow
   composites, `.col-split` flex columns) is therefore **not** covered.
4. **Visual fidelity** beyond geometry: probes measured DOM structure,
   computed styles, and bounding boxes — not pixel rendering. Shadows,
   clip-paths, and font rasterisation were not screenshot-diffed.
5. **Features print-md examples don't use** (`target-counter()`,
   `break-before: recto/verso`, `:nth()` page selectors) were not probed.
6. **Interactive preview behaviours** (HMR reload, scroll sync, the viewer
   toolbar) were out of scope; only initial pagination was audited.

## Suggested user-guide note (for later inclusion)

> The live preview runs in your browser. Safari and Firefox may place page
> breaks slightly differently from the exported PDF because each browser
> measures text differently — the PDF, which always renders in Chromium, is
> the authoritative layout. To minimise the difference, embed your fonts with
> `@font-face` instead of relying on system fonts.
