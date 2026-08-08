# Native-only migration plan (delete Paged.js, rename Folio → Gutterpress)

Status: agreed plan. Supersedes the draft that circulated as "A/B".

## Decisions

**`--format html`** — ship the **self-contained `book.html` plus the viewer bundle**, which paginates it in the browser on load. Reason: `book.html` is *already* a complete self-contained artifact (`asset-inline.ts` inlines all CSS and fonts; images are document-relative), so publishing is one file copy plus one `<script>` tag — no headless Chromium at build time, no DOM serialization.

**The paginated view is the default, always.** The exported page includes the viewer script unconditionally, and every reader with JS sees pages — the same sheets, folios, and margin chrome as print. The underlying document being continuous is an implementation detail of how the viewer works, not a reading mode we offer or advertise. If JS is genuinely unavailable, the document remains readable as-is (a true graceful fallback, plus the linked PDF) — but that is a degradation, never the presentation, and nothing in the artifact or docs frames it as one.

**Desktop preview** — do **not** port anything into the desktop. Rename `pagedjs-interface.js` → `preview-interface.js` and `pagedjs-bridge.js` → `preview-bridge.js` **in the CLI**, retarget ~20 lines of engine-touching code inside them, and inject them for `engine: "native"` too. Reason: the desktop already talks only the `gutterpress:cmd/reply/event` protocol — 144 of ~2,260 lines of the desktop preview stack name an engine at all — so the fix belongs in the shared CLI asset that both front-ends already load.

---

## Why — the easy wins the draft missed

**1. The draft's "reimplement the interface against `window.Folio`" is aimed at the wrong repo half.**
`pagedjs-interface.js` (874 lines) is a **CLI asset**, injected by `packages/cli/src/preview/file-watcher.ts:144-156`. The desktop consumes it only through `postMessage`. Measured coupling in the desktop renderer:

| File | lines | `.pagedjs_` refs | real coupling |
|---|---|---|---|
| `preview-client.ts` | 379 | 1 (comment) | none |
| `block-overlay-controller.svelte.ts` | 398 | 1 (comment) | none |
| `context-menu-controller.svelte.ts` | 774 | 2 (comments) | none |
| `BlockEditOverlay.svelte` | 222 | 1 (comment, line 28) | none |
| `page-nav-controller.svelte.ts` | 133 | 0 | none |
| `zoom-view-controller.svelte.ts` | 210 | 0 | none |
| **`iframe-styles.ts`** | **144** | **51** | **total — the only real coupling** |

Fix the CLI asset and the desktop diff for preview is **zero lines**. The CLI's own browser preview (`preview-shell.js`, 581 lines, 8 `previewAPI` call sites) starts working under `native` too, which it does not today.

**2. The interface is mostly one line of engine contact, and gets *smaller* natively.**
`refreshPages()` (line 17) is the only place the page list is read (`querySelectorAll('.pagedjs_page')`); changing it carries 18 of the ~24 methods. `pageIndexOf(el)` (line 75) uses `el.closest('.pagedjs_page')` → becomes `window.Gutterpress.pageOf(el) + 1`, which carries `getRectsFor` and `getOutline`. And ~150 lines — `resolveBlockGroup`, `elementsByRef`, the whole `data-ref` fragment-grouping apparatus — exist **solely** because Paged.js clones an element across pages and strips its `id`. The native viewer never clones; `getRectsFor` collapses to `el.getClientRects()` + `pageOf`. Net: ~20 lines changed, ~150 deleted, same `{ref, rects[]}` wire shape.

**3. The A/B switch the draft wanted to "keep until last" already exists and is free.**
`manifest.ts:329` resolves `engine` from `gutterpress.json` (`?? "paged"`), and the desktop passes no override — `controller.ts:181` calls `lib.startPreviewServer(...)`, the same `node:http`+`ws` server. A book with `engine: native` gets a native desktop preview today with zero desktop code. `http-server.ts:130-136` already waits on `folio:layout` *or* Paged.js `renderingComplete`, and `EMBEDDED_PREFIXES` already serves `/engine/`. The real gate is flipping the default, not landing the interface work.

**4. `iframe-styles.ts` should be deleted, not ported — ~70 of its 144 lines already exist in `viewer.css`.**
Debug guides (`.folio-guide-trim`/`.folio-guide-safe` under `.folio-stage[data-designer="on"]`), sheet background/shadow (`--folio-sheet-bg`), canvas background (`--folio-stage-bg`) are all implemented in `decorate.ts` + `viewer.css`. Zoom is a one-line retarget. Only two things are genuinely missing — **crop marks** and **spread/two-up view** — and both belong in `decorate.ts` (CLAUDE.md §0: most general layer that can own it), where the CLI preview gets them too.

**5. Two Paged.js consumers the draft did not list at all — these, not the preview, are the hard part.**
- `packages/desktop/electron/pdf-export.ts:88,195,214` polls `window.__PAGED_RENDERED__`, counts `.pagedjs_page`, and **measures `.pagedjs_page[0]`'s computed width/height to set `printToPDF` pageSize**. Delete Paged.js and every desktop export silently falls back to the hardcoded 8.625×11.25in trim or throws "did not finish". **The desktop is not preview-only.**
- The **shipped PWA** (#33 / PR #63) rewrites `pagedjsPolyfillTagRegex()` to a same-origin `/vendor/paged.polyfill.js` (`web-adapter.ts:39,94,790-794`) which `service-worker.ts:38` precaches in `SHELL`. Removing the polyfill breaks a released browser target. Its replacement must stay on the node-free `/render` subpath (`check-render-pure.mjs`).

**6. Two free deletions, available today, independent of everything else.**
`captureStaticHtmlTo` has zero callers outside `pagination.ts` — dead parameter, delete now. And `HtmlOutput.finish` (`build-runner.ts:606`) does **not** branch on `ctx.config.engine`: `--format html --engine native` silently paginates with Paged.js right now. That is a live bug, not a hypothetical.

---

## Work plan

### Phase 0 — settle names that later code will hard-code (small, do first)

The full rename lands last (see below), but three names get baked into code written in Phases 1–3, so pick them now:

- Collapse `window.Folio` (`engine/viewer/global.ts`) and `window.folio` (`engine/viewer/index.ts:63`) into **one** global, `window.Gutterpress`; keep both old names as deprecated aliases (2 lines) for one release.
- Rename the two generated bundles `folio.js` → `gutterpress-viewer.js`, `folio-agent.js` → `gutterpress-agent.js`. `folio.js` is author-visible (it becomes a `<script src>` in published HTML).
- Delete the viewer's own redundant `postMessage` channel (`engine/viewer/index.ts:52-58`, `{folio:"goto"|"next"|"prev"}`). The bridge already owns command transport; two competing channels is a bug waiting to happen. **Exception:** keep the *outbound* `{page, pagecount}` post — that is the documented iframe-embed API (Phase 4).

Bundle rename is a **single atomic commit**: rename in `src/engine/` (including `global.ts` and every `page.evaluate` string in `build.ts` — `build.ts:924` calls `window.Folio.fragmentDocument(...)` inside a string), then `build-engine-bundles.mjs --force`, `git rm` the old bundles, `git add` the new, and update in the same commit: `TARGETS[].outName`, `bundle-freshness.test.ts`'s `BUNDLES`, the `with { type: "file" }` imports and `EMBEDDED_ASSETS` keys (`embedded-assets.ts:48-49,86-87`), `build.ts:142-143`, `file-watcher.ts:149-150`, `http-server.ts:134`, `dev-cli.ts` (4 sites). **Never leave both bundle files on disk** — `embedded-assets.ts` will happily embed a stale orphan.

*Verify:* add a **content** assertion to `bundle-freshness.test.ts` (`expect(viewer).toContain("window.Gutterpress")`, plus the agent's `__gp` assignment). The mtime rule does not survive a fresh clone; content assertions do, and a stale bundle here fails as `undefined is not a function` inside headless Chromium at fixpoint time. Then one real `--engine native` end-to-end build.

### Phase 1 — re-point the regression net, then rewrite the interface

Tests first, or the rewrite ships with zero coverage. `packages/desktop/tests/pagedjs-interface.test.mjs`, `preview-bridge.test.mjs`, `preview-shell-regression.test.mjs` (wired into `packages/desktop` `npm test`) use hand-written `.pagedjs_pages/.pagedjs_page/.pagedjs_margin` fixtures. Re-point them at engine DOM **before** touching the interface.

Then:
- `packages/cli/src/assets/preview/scripts/pagedjs-interface.js` → `preview-interface.js`. Change `refreshPages()` (line 17) and `pageIndexOf()` (line 75); delete the `data-ref` grouping (~150 lines) behind an `if (native)` branch.
- `pagedjs-bridge.js` → `preview-bridge.js`, **unchanged** (zero `.pagedjs_` refs).
- `file-watcher.ts:144-156`: for `engine: "native"`, inject the viewer bundle **plus** the interface and bridge.

Untouched by design: the source-mapping helpers (`lineOf`/`chapterOf`/`blocksInChapter`/`topVisibleSourceEl`, lines 63-110) read `data-source-line`/`data-chapter-src`; the native fragmenter *moves* elements into strips, it does not clone them, so those attributes survive.

*Deleted:* ~160 lines. *Desktop diff:* 0. *Verify:* open an `engine: native` book in the desktop app — page nav, outline, context menu, block edit, editor sync all work; and the CLI browser preview under `--engine native` gains the same.

**BlockEditOverlay: nothing to redesign.** The `.pagedjs_page_content` reference at line 28 is a *comment* explaining why the overlay renders no optimistic DOM patch — the container is `column-fill: auto` multicol so overflow spills into off-screen columns. `.folio-strip` is *also* `column-fill: auto` multicol with a fixed `column-width`; the reasoning is verbatim identical. Update the comment. Identity is already source-range-driven (ADR 0009: `{chapter, range}` from `data-source-line`); the only hit-test in the flow is `getContextTargetAt` → `elementFromPoint` → nearest `[data-source-line]`, which is engine-agnostic. Rects position a floating box, they never resolve identity.

> Reviewer conflict, resolved: one reviewer called the overlay a redesign to defer. That was based on the comment, not the code. It is a comment change — **but** it ships behind Phase 1's re-pointed tests, and if the native block-edit path misbehaves during dogfooding, disabling block-edit under `native` is a one-flag retreat, not a blocker.

### Phase 2 — the decoration layer owns preview chrome

- Add crop marks to `decorate.ts` (the native layer has trim/safe guides but no printer's marks).
- Add a `spread: "single" | "two-up"` layout option to `decorate()`. `.folio-sheet` is `position:absolute; top:0` inside `.folio-run`, so sheet placement is computed, not flex — two-up means offsetting `left`/`top` with recto/verso awareness so the cover sits alone. **Budget ~60-80 lines.** This is the only genuinely new UI code in the whole preview migration.
- Retarget zoom from `.pagedjs_pages` to the stage element; wire `setViewMode`/`setZoom`/`toggleDebugMode` (the latter becomes `stage.dataset.designer = "on"|"off"`).

*Deleted:* `packages/desktop/src/lib/iframe-styles.ts` (144 lines) and its call sites in `preview-event-controller.ts`, `+page.svelte`, and the `injectStyles` plumbing in `preview-client.ts` (~20 lines). This removes the last desktop file that names an engine.

### Phase 3 — desktop PDF export on the native engine

`pdf-export.ts` needs a native completion signal (the `gp:layout`/ready event instead of `window.__PAGED_RENDERED__`) and a native page-geometry read (`--folio-page-w`/`-h`, or the compiler's resolved page size, instead of measuring `.pagedjs_page[0]`). This is the single highest-consequence change in the migration and it is not covered by any existing test — add one that asserts non-default `pageSize` on a native book.

### Phase 4 — `--format html`

`HtmlOutput.finish` (`build-runner.ts:606`) branches on `ctx.config.engine`. For `native`, call a new `shipViewerHtml(htmlFile, outDir)` (~20 lines in `build-staging.ts`): mkdir `engine/`, copy the embedded viewer bundle, inject one `<script src="engine/gutterpress-viewer.js">` before `</head>` with the same no-`</head>` fallback `injectPreviewScripts` uses. No `resolveChromiumExecutable()`, no fallback warning. `paged` keeps today's path until Phase 6.

Two small pieces of real work:
- **Narrow viewports.** A fixed 6×9in sheet is wider than a phone. The answer is still pages: scale the sheet to fit the viewport width (the stage already zooms — the desktop's zoom control drives the same transform), so a phone shows a smaller page, not a reflowed one. Falling back to the continuous document is NOT an option — the paginated view is the product (see Decisions). ~10 lines in `viewer/index.ts`: measure, set the fit-width zoom on mount and on resize.
- **`@media print`.** `viewer.css` is 90 lines with no print block, so Ctrl+P on a published page prints the dark stage and the decoration layer. Ship the PDF alongside `book.html` and link it — the PDF *is* the print artifact — and add a minimal print reset so an accidental Ctrl+P is not garbage.

**Embedding is already done.** `viewer/index.ts`'s header states the contract: iframe, because the viewer owns its document (same-origin CSSOM, free author-CSS isolation). The outbound `{page, pagecount}` post and inbound `goto/next/prev` are written. The entire deliverable is a five-line `<iframe>` snippet in the docs.

Author-facing surface, unchanged command, strictly fewer failure modes:

```
gutterpress build ./my-book --format html --out ./_site
# → _site/index.html, _site/book.html, _site/engine/gutterpress-viewer.js, _site/assets/*
```

*Deleted with Phase 6:* `paginateToStaticHtml`, `serializePaginatedDom`, `paginationOverlays`, `NORMALIZE_PAGEDJS_STRING_PROPS`/`closeUnterminatedCssString`, `finalizeStaticBook`, `stripPaginationRuntime`, `stripPaginationOrigin`, `injectNavigationScripts`, `shipRuntimePaginatedHtml`, `pagedjs-marker.ts`, `build-staging.test.ts`. `build-staging.ts` collapses 146 → ~40 lines. `captureStaticHtmlTo` is dead **today** — delete it in Phase 4 without waiting.

> Reviewer conflict, resolved. One reviewer wanted a `--static` snapshot mode kept in reserve; another demanded a viewer-vs-print parity gate before shipping HTML from the viewer. Both fall away under the chosen option: we are not claiming the web artifact reproduces print fragmentation, so there is nothing to gate, and building a second mode nobody has asked for violates the "reduce complexity" rule. The parity gate is still required — but for Phase 5, where the *desktop preview* claims WYSIWYG.

### Phase 5 — parity gate, then flip the default

The gate exists because the desktop preview and the PDF use **different fragmenters** (`engine/viewer/fragment.ts` in-browser vs Chromium print), and `spike/folio/ARCHITECTURE.md` correctly treats parity as measured, not guaranteed. An author shown a layout the PDF does not match is the most damaging failure this migration can produce.

Automated fixture, run on the migration fixture set *and* `examples/with-design-guide`. Build the same book both ways and assert: (a) identical total page count; (b) identical page-of-element map for every instrumented `id` (`pageRangeOf` vs the compiler's measured map); (c) identical resolved `target-counter()` values. Any divergence is an explicit allowlisted entry (like `runner.ts`'s `KNOWN_DIVERGENCES`), never a silent tolerance. Recto/verso blanks and synthesized `counter-reset: page` are the likely first offenders — a one-page delta shifts every subsequent folio.

Then `manifest.ts:329` `?? "paged"` → `?? "native"`. `--engine paged` survives. This is the reversible commit; sit on it and dogfood a real book.

### Phase 6 — port the PWA, then delete

Port `web-adapter.ts`'s in-browser preview to the viewer bundle (must stay node-free — `check-render-pure.mjs`), update `service-worker.ts:38`'s `SHELL` precache, and confirm both purity gates (`tools/check-render-purity.mjs --strict`, `scripts/check-render-pure.mjs`) are green.

Housekeeping that must land in the deletion commit or it silently breaks:
- `embedded-assets.ts:118` `SENTINEL_ASSET = "vendor/paged.polyfill.js"` — the file whose existence proves the extracted temp asset dir is intact. Delete the polyfill without moving this and `getAssetsDir()` re-extracts on **every** call, forever, with no test covering it. Move it to the viewer bundle.
- `build-fingerprint.ts:203-207` uses the `pagedjs` dep version as a cache-key input. Replace the input; don't just drop it.
- `manifest.schema.json:34-43` / `schema/manifest.types.ts:73-90` keep accepting `engine: "paged"` and `engineStyles.paged` for one release with a deprecation warning, then go.
- Capture the final head-to-head artifacts from `.github/workflows/folio-migration-fixtures.yml` and `spike/folio/compare/*` **before** deleting — that is the only evidence the native engine matched.

*Deleted:* `paged.polyfill.js` (33,288), `pagination.ts` (608), `pagedjs.ts` (166, incl. its hand-written `break-inside:avoid` polyfill), `page-var-resolve.ts` (159, a workaround for Paged.js discarding `var()` inside `@page`), `pagedjs-marker.ts` (50), the residual `build-staging.ts`, the `pagedjs` devDependency, the `engine` field and every `engineStyles` conditional, ~850 lines of tests, and `printsafe.ts`'s `rulePagedjsCrashSelectors`. **~35,500 lines.**

That last one is a user-visible win worth a changelog line: authors regain sibling combinators (`+`/`~`) combined with `:is()`/`:where()`/`:not()`/`:nth-of-type` in their CSS. Note it is an *error-severity rule ID* deletion, surfaced in the desktop lint gutter and `theme-import.ts:85-87`'s severity table — grep for the ID in docs and `.reviews` too.

---

## The rename

Full sweep lands **after** the Paged.js deletion, in the same major release, so authors absorb one breaking change instead of two. The ~35.5k deleted lines contain essentially no `folio` identifiers, so nothing is wasted by waiting — and renaming into a moving target doubles the merge surface and makes `git bisect` on a parity regression miserable. Phase 0 already took the three names that later code hard-codes.

### The trap

**"Folio" is the standard typographic term for a printed page number, and `examples/` uses it that way.** Measured: `grep -rIn -i folio examples/` returns 66 hits; `grep -rIn "folio-\|window.folio\|folio\.js\|__folio" examples/` returns **zero**. Every hit is vocabulary ("Running headers, folios", "Header + folio", "Micro / Folios · 8pt"). Same for `checks/pdf/page-labels.ts:8` ("folio numbering") and `synthesis.ts`'s `toFolioPage` (used at `decorate.ts:154`, `build.ts:29`) — that function means "the printed page number", it is correct domain vocabulary, and it usefully disambiguates from `physicalPage`. **Keep it.**

A repo-wide `sed s/folio/gutterpress/g` corrupts the user-facing design guide. Any plan that does one is wrong.

### Discrimination rule — path first, then structural pattern

1. **Never touch** anything under `examples/`, `**/.reviews/`, or prose in `docs/native-engine-styling-guide.md`. Enforce: after the sweep, `git diff --name-only | grep -E '^examples/|\.reviews/'` must be **empty**.
2. Rename only tokens matching a **structural** pattern, never the bare word: `\bfolio-[a-z]`, `--folio-`, `\.folio-`, `#folio-`, `folio--blank`, `<folio-anchor`, `__folio`, `window\.[Ff]olio`, `Folio(Api|ViewerApi)` in type position, `folio\.js`, `folio-agent\.js`, `/__folio`, `folio:(layout|ready|page)`.
3. **Never** match `\bfolio\b`/`\bfolios\b`/`\bFolio\b` in prose.
4. Comments/docs where "Folio" means the *engine* (`synthesis.ts:253-255` "Folio's computed text", `build.ts` "Folio resolves target-counter()") change to "Gutterpress" by hand. These are the only prose renames and there are few.

### Procedure

1. `git grep -nI -i folio -- packages docs spike tools .github > /tmp/folio-before.txt` — baseline.
2. Split it with the pattern in rule 2. Matches = the **rename set**; the complement (~20 lines: prose, `toFolioPage`, `page-labels.ts`) = the **review-by-hand set**.
3. Apply ordered `sed -E` passes, **longest token first** (`folio-agent.js` before `folio.js`; `__folioReadyPending`/`__folioSource` before `__folio`; `folio--blank` before `folio-`), scoped to `packages/cli/src packages/cli/scripts packages/desktop/src packages/desktop/electron docs .github tools`, excluding `examples/`, `**/.reviews/`, `node_modules`, and `packages/cli/src/assets/engine/*.js` (regenerated, not edited).
4. Regenerate bundles `--force`, `git rm` the old ones.
5. Verify: `git grep -nI -i folio -- packages docs .github tools` contains **only** the review-by-hand set, byte-identical to step 2's complement. Then `bun test` (cli + desktop), both purity gates, and one real `--engine native` build.

### Targets

Prefix **`gp-` for CSS/DOM**, `Gutterpress` for the global and types, `gutterpress-` for filenames. `gutterpress-strip` is 18 characters on an element that appears once per page in a 400-page document; `--gp-*` already has precedent in this repo and matches the existing `gutterpress-hl`/`gutterpress-edit-mask` classes.

| Current | Target |
|---|---|
| `window.__folio`, `window.__folioReadyPending`, `__folioSource` | `window.__gp`, `__gpReadyPending`, `__gpSource` |
| `window.Folio` / `window.folio` | `window.Gutterpress` (single global; aliases one release — Phase 0) |
| `folio.js` / `folio-agent.js` | `gutterpress-viewer.js` / `gutterpress-agent.js` (Phase 0) |
| `FolioApi` / `FolioViewerApi` | `GutterpressApi` / `GutterpressViewerApi` |
| `folio--blank` (`build.ts:47` `BLANK_PAGE`) | `gp--blank` |
| `<folio-anchor>` (`agent.ts:44,57`) | `<gp-anchor>` |
| `folio-gen-css`, `folio-gen-strings`, `folio-xref-style`, `folio-viewer-css`, `folio-media-print`, `#folio-instrumentation` | `gp-*` (also update `docs/native-engine-dx-recommendations.md:95`) |
| `.folio-strip/run/sheet/marginbox/layer/stage/recto-spacer/thead-shim/tfoot-shim/overflowing/pages/guide*/safe` | `.gp-*` |
| `--folio-page-w/-h`, `--folio-content-*`, `--folio-margin-*`, `--folio-sheet-*`, `--folio-stage-bg`, `--folio-size`, `--folio-m-*` | `--gp-*` |
| `folio:layout` / `folio:ready` / `folio:page` | `gp:layout` / `gp:ready` / `gp:page` (update `http-server.ts:134` atomically) |
| `counterStyleName()` → `folio-${name}` (`synthesis.ts:139`) | `gp-${name}` |
| `/__folio` dev route + WS path (`dev-cli.ts:62,67,120,151,189`) | `/__gp` |
| `spike/folio/` | `spike/native-engine/` — and update `.github/workflows/folio-migration-fixtures.yml`'s **`paths:` filter** in the same commit or the job silently stops running. Do not delete the spike before the Phase 5 parity gate exists; it is the evidence base. |

**Public surface (needs a CHANGELOG breaking-change note):** the CSS classes and custom properties — `manifest.schema.json`'s own `engineStyles` description tells authors to write engine-coupled furniture against them; `window.Folio`; `folio.js` (already in anyone's published HTML); `folio--blank` (an author can write `@page folio--blank {}` today); `folio:layout`. Everything else is internal. No alias stylesheet — ride the same major as the Paged.js removal.

---

## Risks and gates

**Gate A — before flipping the default (Phase 5):** the parity fixture above, green on migration fixtures + one real book, with any divergence explicitly allowlisted.

**Gate B — before deletion rather than deprecation (Phase 6):**
1. `pdf-export.ts` has a native completion signal and a native page-geometry read.
2. Re-pointed `pagedjs-interface.test.mjs` + `preview-bridge.test.mjs` green.
3. PWA/WebAdapter on the viewer, service-worker precache updated, both purity gates green.
4. Gate A green.
5. `examples/with-design-guide` and `examples/gutterpress-user-guide` built natively and visually diffed against the last Paged.js build — **resized screenshots** per CLAUDE.md §0b, or the review is invalid.
6. `SENTINEL_ASSET` moved; `build-fingerprint` input replaced; manifest schema still accepts `engine: "paged"` with a deprecation warning.

Ship 1–6 as **deprecation** (default `native`, `paged` still selectable) for one release. Delete in the next.

**What gets harder, honestly:**
- Two-up/spread view moves from ~75 lines of injectable CSS to ~60-80 lines of computed sheet placement in `decorate.ts`. Real new code, not a port.
- Crop marks have no native equivalent and must be written.
- The engine pins a Chromium milestone (`REQUIRED_MILESTONE` in `engine/shared/cdp.ts`) — a hard dependency Paged.js did not have.
- `counter-reset: page` does not work natively (counters are synthesized in `shared/synthesis.ts`); margin boxes cannot `transform`/`box-shadow` and cannot read `counter(page)`. These are permanent author-facing constraints, and they must be in the migration note.
- The PDF export runs a predict-then-verify fixpoint for `target-counter()`. Slower and harder to debug than a single pass.
- We lose the A/B evidence base when Paged.js goes. Capture the artifacts first.
- Two fragmenters (viewer for screen, Chromium for print) is a permanent divergence surface. Gate A is not a one-time check; keep it in CI.

---

## What we are deliberately NOT doing

- **Not** snapshotting the viewer's fragmented DOM for `--format html`. Unlike Paged.js, the native viewer never moves content into page divs — a snapshot is a multicol wrapper plus absolutely-positioned decorations whose pixel coordinates were computed against one viewport, one zoom, one resolved font stack. On a different machine the decorations are wrong while the multicol silently re-fragments underneath. It would also drag build-time Chromium back into `--format html`.
- **Not** building a `--format html --static` mode "in case". Nobody has asked.
- **Not** dropping `--format html`.
- **Not** pursuing viewer==print parity as a shipping requirement for the *web* artifact. Where a hard guarantee is wanted, ship the PDF next to `book.html` and link it. (Parity **is** required for the desktop preview — Gate A.)
- **Not** building a div-based embed. The iframe contract is written and gives author-CSS isolation for free.
- **Not** building new desktop engine-selection UI. `gutterpress.json`'s `engine` field already switches the desktop preview.
- **Not** redesigning `BlockEditOverlay`'s hit-testing.
- **Not** renaming `toFolioPage`, `page-labels.ts`'s prose, or one character under `examples/`.
