# Paged.js Rendering Experiments — Findings & Roadmap

**Status: LIVING DOC on branch `feat/pagedjs-static-html`**
**Last updated: 2026-06-07**

This is the working log for experiments on how print-md renders paginated output —
build-time vs runtime pagination, the live-preview pipeline, and PDF generation.
The goal is to **zero in on the best solution across all use cases** (publish,
preview/edit, PDF). Findings here are measured, with methodology, so later
experiments can build on or refute them.

Companion doc: [`pagedjs-buildtime-port.md`](./pagedjs-buildtime-port.md) (the
SSG build design + PDF parity).

---

## TL;DR of findings so far

1. **Build → view (publish / re-open):** pre-paginating at build time and shipping
   **static HTML** is a big win — the browser loads already-laid-out pages with
   **no runtime JS**, **3.6–15× faster to last page**, and **zero screenshifting**.
2. **PDF:** the unified single pass prints the live DOM (identical call to `main`)
   and serializes the same DOM for the static viewer → **0 pixel difference vs
   `main`** (byte-identical is impossible; Chromium embeds timestamps/IDs).
3. **Browser pool:** pre-warming + reusing one headless browser removes the
   **~1.5s Chromium launch** from every build after the first.
4. **Live-preview hot reload:** pre-pagination **does NOT help** — it's **tied for
   light docs and ~57% slower for heavy docs** — because every edit forces a fresh
   full re-pagination either way, and the static path adds serialize + large-HTML
   transfer + re-layout on top. This is the one workflow where the runtime polyfill
   is competitive.
5. **Architectural smell:** **preview and build currently emit different HTML for
   the same content** (preview ships the polyfill → runtime pagination; build
   pre-paginates → static). Resolving this divergence is the next big question.

---

## What is implemented on this branch

| Commit | Change |
|---|---|
| `6261ed0` | `--format html` pre-paginates at build (Paged.js as SSG); ships static HTML, no runtime pagination JS. |
| `78c101e` | Chromium fallback for HTML (ships polyfill when no browser); unified PDF pass (one pagination → PDF + static HTML; PDF pixel-identical to `main`). |
| `8ec69f4` | Pre-warmed, reusable headless browser pool (`browser-pool.ts`); `keepBrowserAlive` for long-lived servers. |
| (this commit) | **Opt-in** preview pre-pagination behind `PRINTMD_PREVIEW_PREPAGINATE=1` (`prepaginatePreviewHtml` + `generateAndWriteHtml` hook). Default OFF. |

Key files: `packages/lib/src/lib/build-runner.ts`,
`packages/lib/src/lib/browser-pool.ts`,
`packages/lib/src/preview/file-watcher.ts`.

---

## Benchmark data

### Methodology
- Docs: `examples/print-md-user-guide` (59 pp, light), a synthetic 169-pp doc
  (user-guide content ×5), `examples/with-design-guide/design-guide` (55 pp,
  CSS/component-heavy, ~6 real images).
- Browser timing in headless Chrome (Blink) **served over HTTP** — Paged.js XHRs
  the CSS to parse `@page`, so `file://` blocks it; the static output works on
  `file://` precisely because it has no engine.
- "Time to last page" = navigation → all `.pagedjs_page` laid out + count stable
  (scrollable to the end). Medians of 2–3 runs.
- PDF parity via `pdftoppm -r 100` rasterization + ImageMagick `compare -metric AE`.
- ⚠️ The shared dev box ran at load 30–94 from other tools during some runs;
  absolute build/render numbers vary, but **A/B comparisons were run back-to-back**
  so relative deltas hold. Re-measure on a quiet runner for publishable absolutes.

### Browser: time-to-last-page (build → open, served over HTTP)
| doc | `main` (runtime polyfill) | static (this branch) | speedup |
|---|---|---|---|
| user guide, 59 pp | ~1.39s | **~0.39s** | ~3.6× |
| synthetic, 169 pp | ~3.2s | **~0.50s** | ~6.5× |
| design guide, 55 pp (heavy CSS) | ~5–7.7s¹ | **~0.51s** | ~10–15× |

¹ load-inflated; a later quiet back-to-back run put the design guide nearer ~1.9s
(see hot-reload A/B). Even at ~1.9s the static path (~0.5s) wins ~3.7×.

### Screenshifting (the "jank"), quantified — document height during load
- `main`: grows `1056 → 9504 → 27456 → 50688 → 62304 px` over ~1.6s as pages
  append one-by-one (1→9→26→48→59). The growing height **is** the screenshifting —
  scroll position moves as Paged.js rebuilds.
- static: `62304 px` / all 59 pages stable from the **first sample (120ms)**.
- CLS scored 0 for both (the layout-shift API doesn't score off-screen appends);
  `scrollHeight` growth is the real jank signal.

### Browser pool (build side)
- Direct probe: **cold launch ~1512ms → warm reuse ~0ms.**
- `prewarmBrowser()` overlaps the launch with markdown/staging on the first build;
  `keepBrowserAlive:true` keeps it warm so preview/watch rebuilds skip the launch.

### PDF parity (vs `main`)
- Two `main` runs differ in **bytes** (timestamps/IDs) but are **0 px** different.
- Branch PDF vs `main` PDF = **0 differing px across all 59 pages.**
- Printing the *static artifact* instead of the live DOM drifts ~34k px
  (running headers/folios re-resolve) → the PDF prints the **live DOM**, the static
  HTML serializes that same DOM.

### Live-preview hot reload — A/B (edit a source file → change visible)
Two modes compared on the same branch (toggled by `PRINTMD_PREVIEW_PREPAGINATE`):
**A** = today's preview (browser paginates each reload), **B** = pre-paginate in the
warm pool, browser loads static. "Visible" = marker text present AND layout settled.

| doc | A (polyfill) | B (pre-paginate) | result |
|---|---|---|---|
| user guide (light) | ~3.3s | ~3.1s | **tied** |
| design guide (heavy) | **~1.9s** | ~3.0s | **B ~57% slower** |

(Mode B verified to genuinely serve static: 59 baked pages, 0 polyfill scripts.)

---

## Why hot reload behaves opposite to build→open

The build→open win comes from doing pagination **once** and loading static on **every
reopen**. Live editing has no "reopen": every keystroke-save changes content, so the
**pagination must be redone every time** regardless of mode.

- **Mode A (polyfill):** re-render markdown → broadcast → browser paginates (visible).
- **Mode B (pre-paginate):** re-render → **server paginates in the pool** (≈ same cost
  as in-browser, no faster) → serialize the whole DOM → ship a **much larger** static
  `book.html` → browser **re-parses + re-lays-out** it.

Mode B pays everything Mode A pays **plus** serialize + transfer + static re-layout, so
it ties (light) or loses (heavy, where the static HTML is big). The static-load
advantage only materializes when pagination is *not* repeated — i.e. not in HMR.

**Corollary:** the real hot-reload win is **incremental pagination** (re-paginate only
the changed region), which neither mode does today.

---

## Open architectural question: preview vs build emit different HTML

Right now, for the **same source**, print-md produces **two different `book.html`
shapes**:

- **`build --format html`** → static, pre-paginated `.pagedjs_page` tree, no engine.
- **`preview`** (default) → markdown + `paged.polyfill.js`, browser paginates at runtime.

This divergence is a smell:
- The thing you preview is **not** the thing you publish (different DOM, different
  failure modes, different timing). A layout bug could appear in one and not the other.
- Two code paths to maintain (`runBuild` HTML branch vs `generateAndWriteHtml`).

**Options to converge (to evaluate on this branch):**
1. **Preview = build** — make preview pre-paginate by default (warm pool). Cost: the
   hot-reload regression above (tied/slower) and the larger payload. Best fidelity.
2. **Build = preview** — ship the polyfill from build too and accept runtime
   pagination everywhere. Rejects the whole SSG premise; no.
3. **Same DOM, two delivery modes** — one renderer produces the static tree; preview
   serves it with a thin live-update layer, build serves it plain. Requires solving
   incremental update (below). Most promising long-term.
4. **Keep both, make the difference explicit + tested** — a golden test that asserts
   preview and build paginate to the *same* page breaks for a fixture, so divergence
   can't drift silently. Cheap insurance regardless of which path wins.

---

## Preview HMR — implemented & measured (real-time editing)

Goal: near-instant preview updates as the author edits, **without flicker or lost
scroll position** (target: a VS Code preview pane). Built layered by what changed.

### ✅ CSS edits → hot-swap (instant, scroll-stable, no flicker)
A stylesheet edit doesn't change content flow, so the watcher broadcasts
`{type:'css-update', path}` instead of regenerating + reloading, and the client
**injects a fresh `<link>`** for that stylesheet appended last. (Paged.js inlines
the user CSS and *removes* the original `<link>` during pagination — verified
`link[rel=stylesheet] == []` post-pagination — so bumping a link can't work; a
freshly injected link wins the cascade over Paged.js's stale inlined copy.)

| metric | result |
|---|---|
| time to apply (median) | **259 ms** |
| scroll preserved | **yes — exact (5000→5000 px)** |
| re-pagination | **none (pages stay 59)** |
| flicker | **none** |

Also fixes the long-standing stale-CSS preview bug (CSS edits previously needed a
server restart). The ~259 ms is almost all watcher debounce (100 ms) +
`awaitWriteFinish` (100 ms); the apply itself is next-frame.

### ✅ Content edits → scroll preserved via source anchor
A markdown edit still full-reloads + re-paginates, but the client now anchors on
**source position** (`data-source-line`, emitted by `markdown-it-source-map` — 668
in the user guide) rather than pixels: capture the line nearest the viewport top
before reload (sessionStorage), restore it to the same offset after. Critical
ordering: in polyfill mode restore must wait for `renderingComplete`, because
Paged.js's `PagedConfig.after` calls `scrollTo(0,0)` right before firing it.

| metric | result (3 edits) |
|---|---|
| anchored source line returns to same offset | **drift 0 px** (scrollY restored 0→6000) |
| scroll position lost | **no** |
| flicker on content edit | **still present** (full reload + visible re-pagination) |

### ✅ Content edits → flicker-free via iframe-shell double-buffer
Content edits flash because Paged.js re-paginates visibly on reload, and Paged.js
paginates the whole `document.body` (can't be scoped to a hidden sub-container).
Fix (opt-in `PRINTMD_PREVIEW_SHELL=1`): serve a **shell** at `/` that hosts
`book.html` in an iframe. On a content edit the shell paginates a **second hidden
iframe**, waits for its `renderingComplete`, then **swaps it in atomically** and
restores the scroll anchor. The visible page never blanks or rebuilds. `book.html`'s
HMR client is inert when framed (`window.self !== window.top`) so the shell is the
sole driver. (Same iframe pattern the Electron viewer uses → converges the two.)

Flicker measured as the **minimum page count visible** during a content edit
(direct = rebuild in view; shell = stays full):

| doc | direct (reload) | shell (double-buffer) |
|---|---|---|
| user guide (59 pp) | min **0** — flicker, settle 1.27s | min **59** — none, settle 1.3s |
| synthetic (169 pp) | min **0** — flicker, settle 3–5s | min **150/281** — none, settle 7–9.6s |
| design guide (55 pp, heavy CSS) | min **0** — flicker, settle 1.25s | min **55** — none, settle 1.3s |

**No flicker on every doc incl. complex/long; scroll anchor preserved.** Honest
tradeoff: latency is **free up to ~60 pp**; for very long docs (150–280 pp) the
shell is ~2× slower to *settle* because the full new layout paginates hidden before
the swap (smooth-but-later vs janky-but-progressive). The fix for that latency is
**incremental pagination** (re-paginate only the changed region) — backlog item B1,
the one remaining lever for near-instant on very long docs.

### ✅ Incremental pagination → near-instant on long docs
`PRINTMD_PREVIEW_INCREMENTAL=1` (implies the shell). Each source file is wrapped
as a **page-isolated chapter** (`.pmd-chapter[data-chapter-src]`,
`break-before:page`). On a markdown edit the watcher sends
`{type:'content-update', file}`; the shell paginates **only that chapter** in a
hidden iframe (`/__chapter?file=…`) and **splices** its pages into the live view
(`importNode`, replacing the old chapter's pages). Page numbers are a live CSS
counter so they re-flow automatically; scroll anchor preserved; falls back to a
full double-buffer swap if the splice can't apply.

Hypothesis first (why it's worth it): paginating **1 chapter = 333 ms** vs the
**full 281 pp doc = 6112 ms (~18×)**, ~linear in content.

| doc | full double-buffer | **incremental** | flicker | correctness (3 edits) |
|---|---|---|---|---|
| 169 pp synthetic | 7–9.6 s | **0.5–1 s** | none | total stable 283, marker ×1, 41 chapters |
| design guide (heavy CSS) | 1.3 s | **0.4 s** | none | total stable 65, marker ×1, 9 chapters |

Correctness gate proved no page accumulation, clean chapter replace (not
duplicated), exactly one marker. **Near-instant even on a 280-page doc.**

Tradeoffs (documented): incremental mode page-isolates chapters (a few more pages
than the build), and only the edited chapter re-paginates — so cross-chapter
reflow at a page boundary isn't reflected until a full reload. Acceptable for
live editing; the full build/PDF path is unaffected.

### Net real-time-editing status
- **CSS edits:** instant (~259 ms), scroll-stable, no flicker. ✅
- **Content edits, incremental:** **0.4–1 s on docs up to ~280 pp**, no flicker,
  scroll preserved, correct. ✅ (near-instant)
- The full-document double-buffer remains the fallback when a doc isn't
  chapter-page-isolated or a splice can't apply.

## Converging the Electron viewer onto the same preview client

Goal: **one preview experience, one codebase** — the CLI `print-md preview` and
the Electron viewer should run the **same** shell + double-buffer + incremental
client, with Electron a **thin OS-bridge wrapper** (file dialogs, watching,
window chrome) rather than a parallel implementation.

Current state: the shell + client lives inline in `http-server.ts`
(`SHELL_HTML`). It is already **host-agnostic except one line** — the
`new WebSocket(HMR_PATH)` transport. The change events (`css-update`,
`content-update`, `full-reload`) and the per-chapter render (`/__chapter`) are
the entire host contract.

Convergence plan:
1. **Extract** `SHELL_HTML` + controller into a shared asset
   (`assets/preview/shell.html` + `scripts/preview-shell.js`), served by the CLI
   http server today and loadable by Electron via `app://`.
2. **Abstract the transport**: the client takes a `changeSource` with
   `onMessage(cb)` — backed by **WebSocket** (CLI) or **ipcRenderer/postMessage**
   (Electron). Same double-buffer + splice logic in both.
3. **Electron becomes thin**: its main process provides the OS bridge (pick
   folder, watch files via the shared `file-watcher`, emit the same
   `content-update`/`css-update`/`full-reload` events over IPC) and hosts the
   shared shell. No bespoke viewer pagination/rebuild path.
4. This also **closes the preview-vs-build divergence**: both the viewer and the
   CLI preview render through the one shell client; the build/PDF SSG path stays
   separate by design (publish artifact, not live edit).

## Experiment backlog

### A. Improve Paged.js HMR while keeping the polyfill (preview-side)
The polyfill path is competitive on hot-reload speed; its weakness is the *visible*
re-pagination flicker and lost scroll position. Ideas to prototype + measure:

- **A1. Off-screen paginate, then atomic swap.** Run Paged.js into a hidden/detached
  container; when `renderingComplete` fires, swap it into view in one frame. The user
  keeps seeing the old, stable layout until the new one is ready → **kills the
  screenshifting** without changing total time. (Directly targets the user's original
  complaint.)
- **A2. Soft HMR (no full reload).** Today HMR does `location.reload()` → re-fetch
  everything + cold-init Paged.js. Instead, the HMR client could `fetch()` the new
  body, replace source content, and re-run `Paged.Previewer.preview()` in place —
  keeping the page, WS, and warm fonts/CSS. Measure vs `location.reload()`.
- **A3. Scroll/page-anchor preservation.** Record current page index (or nearest
  heading) before reload; restore after `renderingComplete`. Removes the "lost my
  place" pain even if timing is unchanged.
- **A4. Coalesce + cancel.** Debounce rapid saves and cancel an in-flight pagination
  when a newer edit arrives (avoid paginating stale content).
- **A5. Progress affordance.** If A1 isn't taken, at least show a determinate
  "paginating N/M" overlay (we know page count grows) so the flicker reads as progress.

### B. Incremental pagination (the real hot-reload win, both modes)
- **B1.** Scope re-pagination to the changed chapter/region; keep other pages. Hard
  with Paged.js's whole-document model — investigate chunker reuse or a region-level
  re-flow. Likely the highest-value, highest-effort item.

### C. Converge preview and build output
- **C1.** Prototype option 3 above (one static tree, two delivery modes) once B is
  understood.
- **C2.** Add the golden "same breaks" test (option 4) now, as drift insurance.

### D. Finish the static-output story
- **D1.** Wire `renderingComplete` for static output (`pagedjs-interface.js` fires it
  from `PagedConfig.after`, which never runs without the engine → toolbar page count
  missing on static). ~10–20 lines, `DOMContentLoaded` dispatch.
- **D2.** Electron viewer: have its injected renderer honor `captureStaticHtmlTo` (or
  add an injected serializer) so the desktop app produces the same static HTML.
- **D3.** Quiet-runner re-measure of all absolutes (build times especially).

### E. Engine-level (longer horizon, see companion doc)
- Pure-JS / no-browser pagination was investigated and shelved: real DC CSS uses
  `columns`, `float`, `grid` that no pure-JS layout engine reproduces. Revisit only if
  a WASM layout engine (taffy + a text shaper) proves it can embed in the
  `bun build --compile` binary AND match Blink on the real corpus.

---

## Decision log
- **2026-06-07** — Keep the opt-in preview pre-pagination (`PRINTMD_PREVIEW_PREPAGINATE`)
  for continued experimentation even though it doesn't improve hot-reload latency; it's
  default-off and useful for jank-free reloads (pending A1 as a better fix).
- **2026-06-07** — PDF stays a live-DOM print (not a static-artifact re-print) to keep
  0-px parity with `main`.
