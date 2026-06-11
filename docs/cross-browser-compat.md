# Cross-browser compatibility matrix — Paged.js preview (issue #46)

**Date:** 2026-06-10
**Scope:** the live **preview** (`print-md preview` / the viewer's preview pane)
only. PDF export always renders in Chromium (puppeteer-core in the CLI,
Electron's `webContents.printToPDF` in the viewer) and is unaffected.
**Paged.js under test:** 0.4.3 (vendored
`packages/lib/src/assets/vendor/paged.polyfill.js`).

Methodology details, probe mechanics, and the synthetic feature fixture are in
[`docs/compat/pagedjs-cross-browser-audit.md`](./compat/pagedjs-cross-browser-audit.md).
Raw per-engine JSON evidence is in [`docs/compat/audit-results/`](./compat/audit-results/).

## Engines tested

| Engine | Version | How |
|---|---|---|
| Chromium (baseline) | 148.0.7778.96 | Playwright 1.60.0, headless, Linux x64 |
| Firefox (Gecko) | 150.0.2 (Playwright build v1522) | same |
| WebKit (Safari's engine) | 26.4 (Playwright build v2287) | same |

Render-completion signal: the `renderingComplete` CustomEvent dispatched by
`pagedjs-interface.js` after pagination, captured via a Playwright init script
in every frame (works through the preview shell's iframe at `/`). No
timeout-as-success anywhere.

## Projects rendered

| Project | Chromium pages | Firefox pages | WebKit pages | Console/page errors |
|---|---|---|---|---|
| `examples/print-md-user-guide` | **59** | 58 (−1.7%) | 53 (−10.2%) | 0 / 0 / 0 |
| `packages/viewer/tests/integration/fixtures/multichapter` | **3** | 3 | 3 | identical 404 noise¹ in all three |
| `examples/with-design-guide/design-guide` | **63** | 62 | 63 | 0 / 0 / 0 |
| `packages/cli/tests/compat/fixtures/feature-probe` (synthetic) | **4** | 4 | 4 | 0 / 0 / 0 |

All engines: `renderingComplete` fired, reported `totalPages` equals the DOM
`.pagedjs_page` count, single page sheet size `816×1056`, zero collapsed
(0-sized) content pages.

¹ The multichapter fixture ships no stylesheet, and the default preset links
`css/print.css`, so every engine logs the same 404 (Firefox additionally
reports the 404 body as an "XML Parsing Error"). Identical root cause in all
three engines — a fixture artifact, **not** a compatibility divergence.

## Per-feature status

"OK" = measured identical to the Chromium baseline (DOM probes + screenshots),
not assumed.

| Feature | Chromium | Firefox | WebKit | Evidence |
|---|---|---|---|---|
| Named `@page` pages (`cover`/`toc`/`chapter`) | OK | OK | OK | identical `pagedjs_<name>_page` classes; identical content-top insets (cover 0, toc 84px, chapter 240px, default 84px) in all engines |
| `string()` / `string-set` running headers | OK | OK | OK | chapter titles present as margin-box `::after` strings on every content page; counts proportional to page counts (48/47/43 boxes for 59/58/53 pages) |
| `counter(page)` folios | OK | OK | OK | live counter in bottom margin-box `::after` on every content page (58/57/52) |
| Custom properties (`var(--…)`) inside `@page` margin boxes | OK | OK | OK | computed font-family/size/color of margin boxes identical across engines |
| `position: running()` → `content: element()` | OK | OK | OK | sentinel removed from flow and present in `@bottom-left` margin box in all engines (feature-probe; visible in screenshots) |
| Multi-column sections + `@column-break` | OK | OK | OK² | two distinct text bands, forced break lands on the same paragraph, identical section width |
| `:left` / `:right` / `:blank` page selectors | OK | OK | OK | margin asymmetry + suppressed headers on blank pages applied everywhere |
| Tables (header band, zebra striping) | OK | OK | OK | screenshot-compared (user guide "Page Size Reference" table) — identical structure and styling |
| Code blocks / file trees | OK | OK | OK | screenshot-compared, identical |

² Column *balancing* (exact wrap points within columns) follows each engine's
own multicol implementation; structure is correct everywhere.

## Divergences found (all classified)

| # | Divergence | Class | Status |
|---|---|---|---|
| D1 | **Page-count drift**: user guide 59 (Chromium) / 58 (Firefox) / 53 (WebKit). Gradual accumulation, no missing content, no blank pages, all chapter breaks honoured. | (b)/(c) engine font-fallback metrics, not Paged.js, not our CSS | Documented. Mitigation: ship embedded `@font-face` instead of system font stacks (`"Helvetica Neue", Helvetica, Arial` resolves to different Linux fallbacks per engine). With embedded fonts the drift disappears (verified in the Phase-1 audit). The exported PDF (Chromium) is authoritative. |
| D2 | **Font rendering differs** on projects using system font stacks or no stylesheet (multichapter fixture: serif UA default in Chromium/Firefox, sans in WebKit headings differ per UA default). | (b)/(c) UA defaults | Same mitigation as D1; cosmetic only, geometry unaffected. |
| D3 | Trailing 0×0 empty sheet at the end of the design guide. | Paged.js artifact, **identical in all three engines** | Not a cross-browser issue; tracked separately. |

**No category-(a) (fixable-in-our-CSS) divergence was found.** No layout
collapse, no missing running headers/footers, no broken counters, no column
failures, no blank-page divergence in any engine.

## Known limitations / still needs real hardware

1. **Real Safari 17 on macOS/iOS** — Playwright's Linux WebKit 26.4 uses a
   non-Apple font/graphics stack; Safari-specific bugs and iOS viewport
   behaviour are unverified. Needs a macOS runner or manual Safari pass before
   declaring Safari support (0.6.0 PWA milestone).
2. **Chrome for Android** — not installable here; untested.
3. **DC plugin heavy CSS** (clip-paths, drop-shadow composites, `.col-split`
   flex columns) — `examples/dc-design-guide` is not on this branch; not
   covered.
4. **Pixel fidelity** — probes measured DOM geometry and computed styles plus
   spot screenshots; no exhaustive pixel diffing of shadows/clip-paths/font
   rasterisation.
5. **Unused Paged.js features** (`target-counter()`, `:nth()` page selectors,
   `break-before: recto/verso`) — not probed; print-md examples don't use them.
6. Only initial pagination was audited; HMR reload / scroll-sync / viewer
   toolbar behaviours were out of scope.

## Re-running

```sh
# servers
bun packages/cli/src/cli.ts preview examples/print-md-user-guide --open false --port 4121
bun packages/cli/src/cli.ts preview packages/viewer/tests/integration/fixtures/multichapter --open false --port 4122

# probes (from packages/cli; playwright is a devDependency there)
node tests/compat/audit-probe.mjs --url http://127.0.0.1:4121/ --out result.json
node tests/compat/screenshot-probe.mjs --url http://127.0.0.1:4121/ --label userguide

# CI smoke (chromium+firefox+webkit), also run by .github/workflows/preview-cross-browser.yml
node_modules/.bin/playwright test -c tests/compat/playwright.config.ts
```

`playwright` is a **devDependency of `packages/cli` only** — it is not in the
lib's runtime deps and is not bundled into the compiled binary (CLAUDE.md
§1/§3).
