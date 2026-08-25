# CLI ↔ desktop print parity

**Status:** investigation and design. No product code changed; every edit made
while measuring lives in a scratch harness outside the repo.
**Settles:** [#186](https://github.com/dimm-city/gutterpress/pull/186) §7 residual
risk 5 — *"the CLI and the desktop host may not be in the same browser state …
whether the desktop is in the immunised state is **unmeasured**."*
**Also answers** the mechanism agent's open question
([#187](https://github.com/dimm-city/gutterpress/pull/187)): whether Electron's
`webContents.printToPDF` reaches Chromium's pre-print resource wait
(`Document::WillPrintSoon`) that CDP `Page.printToPDF` skips.
**Measured on:** 2026-08-24, Linux x86_64. CLI host = Google Chrome
**151.0.7922.75**; desktop host = Electron **42.1.0** / Chromium
**148.0.7778.97**.

Everything below is **measured** here, **read from source**, or explicitly
labelled **inferred**. §11 lists what I could not determine.

---

## 0. Summary

**They do not diverge in the PDF. They diverge in the measurement that decides
whether there is a PDF at all.**

1. **The print channel agrees, exactly.** Same staged `book.html` (md5-verified
   identical), printed by both hosts: identical page count, identical page size,
   identical embedded image objects, identical text layer, and **mean-abs-diff
   `0.0000` on every page** — colour, 200 dpi on the purpose-built fixture and
   150 dpi on a real 66-page book. The only differences in the artefact are the
   `Producer` string (`Skia/PDF m151` vs `m148`) and the file length that string
   changes (§4).
2. **The desktop is NOT in the immunised state, and neither host waits for
   resources.** Running the published mechanism fixture
   (`tools/page-background-mechanism.mjs`) through the Electron host, cell for
   cell: **all ten gated cells produced the same verdict and the same
   independent server hit counts as the CDP host**, including the `serverHits=2`
   cache-wipe signature. With the tile held 1500 ms server-side,
   `webContents.printToPDF` returned in **12 ms** — it does not reach
   `WillPrintSoon` either (§5). Residual risk 5's "if it is, the two hosts
   disagree today about which second references work" resolves to: **it is not,
   and they do not.**
3. **The measurement channel diverges by 15 CSS px, and it is load-bearing.**
   Under the engine's own 576 px sheet pin, the CLI lays out at 576 px and the
   desktop at 561 px, because the desktop's window shows a classic scrollbar and
   the CLI's Chromium happens to be launched by puppeteer with
   `--hide-scrollbars`. Measured consequence, same book, byte-identical source:
   **the CLI hard-errors with exit 3 and produces no PDF; the desktop builds
   successfully and ships one** (§6).
4. **The cause is that the print path does not own the whole browser state.**
   The engine explicitly owns viewport, emulated media, the ready probe and the
   print options — and those are shared and correct. Scrollbar visibility is not
   owned by anyone, so it is whatever the host's browser happened to be launched
   with. Reproduced on a **single host**: the same Chrome, with
   `--hide-scrollbars` removed, produces the desktop's 561 px exactly (§7).
5. **Recommendation: take the state, don't build a gate.** Two lines that move
   scrollbar visibility into the sequence `build()` already owns, next to the
   two `setDeviceMetricsOverride` calls. Measured to make the desktop's
   diagnostics and its build outcome identical to the CLI's, and measured to
   change nothing in the PDF. A CLI↔desktop comparison gate is the more
   expensive answer and the weaker one — it can only ever sample the one
   Chromium pair CI happens to have, while a single-host test of the invariant
   covers every host, including future ones (§8, §9).

---

## 1. The two print paths, read from source

There is already **one** print path. This is the most important structural fact
in the investigation, and it is why the divergence that exists is narrow.

`packages/cli/src/engine/compiler/build.ts`'s `build()` is the whole print
sequence: navigate, agent, ready probe, pin the sheet viewport, emulate print
media, audit, tier-2/3 measurement, print. It takes a `Browser` and never
creates one when given one (`opts.browser` / `ownsBrowser`,
`build.ts:349-350`). Both hosts call it through the same bridge,
`packages/cli/src/lib/engine.ts`'s `buildNativePdf`, which differs by one
argument:

| | CLI (`gutterpress build`) | desktop (PDF export) |
|---|---|---|
| entry | `build-runner.ts:698` → `buildNativePdf(html, pdf, opts)` | `electron/export/controller.ts:293` → `runBuild({… engineBrowser})` → the same `build-runner.ts:698` |
| `Browser` | `connectChromium(pool.wsEndpoint())` — raw CDP over `ws`, `Target.createTarget` | `createElectronEngineBrowser()` — a hidden `BrowserWindow` per page |
| print call | `Page.printToPDF` (CDP), `transferMode: ReturnAsStream` | `webContents.printToPDF` |
| browser | whatever `requireChromiumExecutable()` finds: Chrome, Chromium, Edge, Brave, Vivaldi, Opera — any build ≥ `REQUIRED_MILESTONE` (148) | Electron's bundled Chromium, pinned by the Electron version |

Three things are already single-definition and shared, deliberately, with
comments saying so: `DEFAULT_PRINT_OPTS`, `readyProbeExpr()` and
`assertMilestone()` (`engine/shared/cdp.ts:76-120`). The engine's own post-load
state — `Emulation.setDeviceMetricsOverride` (`build.ts:386`, `:1664`) and
`Emulation.setEmulatedMedia` (`build.ts:394`) — is likewise set by `build()`,
so both hosts get it.

**What is not owned by anything** is the rest of the browser's state: launch
switches, window chrome, colour profile, and the Chromium version. On the CLI
that state comes from puppeteer's default arguments; on the desktop it comes
from `BrowserWindow`'s defaults. Nothing compares them, and nothing declares
which of them the print path depends on.

Note also a **third** state that already exists: `launchChromium()`
(`cdp.ts:144-195`) passes `--disable-gpu --hide-scrollbars
--allow-file-access-from-files --font-render-hinting=none`. Nothing on either
product path uses it — it is what `scripts/native-parity-gate.ts` and the engine
dev CLI run under. So the existing preview↔print gate runs in a browser state
that matches **neither** shipping host.

---

## 2. Harness conditions

Every measurement below was taken under these conditions. Four of them are the
knobs that have already caused three misdiagnoses of #152, so they are stated
rather than assumed.

| | CLI host | desktop host |
|---|---|---|
| browser | `/usr/bin/google-chrome` 151.0.7922.75 | Electron 42.1.0 / Chromium 148.0.7778.97 |
| driver | `browser-pool.ts` (puppeteer-core `launch`) + `connectChromium` → raw CDP | `createElectronEngineBrowser()`, compiled unmodified from `packages/desktop/electron/engine-browser.ts` |
| print call | `Page.printToPDF` + `DEFAULT_PRINT_OPTS` + `ReturnAsStream` | `webContents.printToPDF` + `DEFAULT_PRINT_OPTS` |
| launch args | puppeteer defaults — includes `--headless=new`, **`--hide-scrollbars`**, `--force-color-profile=srgb`, `--export-tagged-pdf`, `--generate-pdf-document-outline` | `main.ts:1645-1647`'s three switches only (`disable-renderer-backgrounding`, `disable-background-timer-throttling`, `disable-backgrounding-occluded-windows`), plus `--no-sandbox` (container) |
| `--virtual-time-budget` | **not passed** | **not passed** |
| pre-navigation device-metrics override | **none** — measured `{iw:0, ih:0}` on a fresh CDP target | **none** — measured `{iw:1280, ih:1024}`, a real window, no emulation |
| scheme | `file://` for the book runs; `http://127.0.0.1` for the mechanism runs | same |
| window | headless | hidden `BrowserWindow` 1280×1024, `paintWhenInitiallyHidden: true`, `backgroundThrottling: false` |
| display | — | a real Wayland/ozone session on `DISPLAY=:0`; `xvfb-run` is not installed here |

**The desktop harness is the product path minus the UI.** It calls
`lib.runBuild({… engineBrowser})` with exactly the arguments
`ExportController.build` passes (`controller.ts:279-294`); only the save dialog,
the progress events and the pre-export sync gate are skipped, none of which
touch the print path.

**One harness artefact, recorded because it silently produces a wrong answer.**
An Electron harness with no window of its own quits the instant the engine
closes its last hidden page (`window-all-closed` → default `app.quit()`), which
truncates the build with **exit 0 and no PDF**. The shipping app always has its
main window open during an export, so this never happens in production. The
harness holds one anchor window open for the run. Every desktop number below was
taken after that fix; before it, the desktop "produced no output", which would
have been reported as a catastrophic divergence.

---

## 3. Controls

A run where everything matches proves nothing unless a case known to differ
shows up as different.

| control | expectation | result |
|---|---|---|
| **noise floor, CLI** — same book, two CLI builds | must be `0.0000` | `0.0000` on all 5 pages |
| **noise floor, desktop** — same book, two desktop builds | must be `0.0000` | `0.0000` on all 5 pages |
| **must differ** — baseline vs the same book with a `<link rel=preload>` guard, same host | must be non-zero | **`17.03` – `29.88`** per page; embedded image objects 3 → 8 |
| **mechanism fixture, CDP host** — 10 gated cells | all controls must hold | all held (`mechanism.mjs` exits 0) |

**A control that looked right and was worthless.** My first sensitivity control
was "baseline vs the same book with the `@page` background declaration removed".
It measured `0.0000`, with both PDFs at exactly 1,471,609 bytes — because under
the status quo *the page background never painted in either build*, which is
#152. An obvious-looking differential control can be silently void when the
feature under test is already broken; the preload guard is the control that
actually moves pixels.

---

## 4. Measured: the print channel agrees

The document was held constant by construction: each host published its own work
dir (`--out <dir>` copies the whole work dir, `build-runner.ts:576`), and the
staged inputs were hashed.

**Fixture book** — 5 pages, 6×9 in, exercising all three shapes named as
sensitive: a page-box `background: var(--paper)` (1,025,255 B), a
`@top-center` margin-box `background-image` (910,028 B), and one file
(1,061,917 B) referenced by **both** a CSS `background-image` and a markdown
prose image. All three are over `IMAGE_INLINE_MAX_BYTES`, so all three take the
copy path. A `target-counter()` cross-reference forces Tier 3.

| | CLI | desktop |
|---|---|---|
| staged `book.html` md5 | `9808834d9c4e15cebd8e501002895c85` | **identical** |
| staged images md5 (×3) | — | **identical** |
| pages | 5 | 5 |
| page size | 432 × 648 pt | 432 × 648 pt |
| `Tagged` | yes | yes |
| embedded image XObjects | 3 (`800×280`, `800×800`, `800×280`) | **identical list** |
| `pdftotext -layout` | — | **identical** |
| **raster, colour, 200 dpi** | — | **`0.0000` on all 5 pages** |
| `Producer` | `Skia/PDF m151` | `Skia/PDF m148` |
| bytes | 1,471,609 | 1,471,616 |

**Real book** — `examples/gutterpress-user-guide`, 66 pages, US Letter, ten
chapters, its own 800-line stylesheet:

| | CLI | desktop |
|---|---|---|
| staged `book.html` md5 | `14a8f863df4d5795d7006661b8c42ec7` | **identical** |
| pages / page size / `Tagged` / text layer | 66, letter, yes | **identical** |
| **raster, colour, 150 dpi** | — | **`0.0000` on all 66 pages** |
| bytes | 600,249 | 600,706 |

**The engine's internal decisions agree too.** Driving `build()` directly on the
same staged file with progress logging, on both hosts: identical
`--gp-content-h: 715px`, identical tier (3), passes (1), prints (1), page count
(5), `converged` (true), viewport (576×864), **and identical `pageMap` *and*
`predicted.pageMap`** (`{gp-m-1:1, gp-m-2:2, late-reference:5}`). Exactly one
line of the two logs differs, and §6 is about that line.

**Inferred, not proven:** that this generalises to books this fixture does not
contain — heavy multicol, bleed/slug (Tier 2), signature imposition, PDF/X. §11.

---

## 5. Measured: the desktop is not immunised, and neither host waits

`tools/page-background-mechanism.mjs` (PR #187) was run unmodified on the CDP
host, and its fixture was re-run through the Electron host. The Electron leg
imports the published script's own definitions — `tile()`, `startServer()`,
`docHtml()`, `GUARDS`, `PRINT_OPTS`, `SHEET`, `READY`, `raster()` — from a
**verbatim byte-prefix** of that file (everything above its top-level
execution), so the document, the tile, the held-response server, the print
options, the sheet viewport, the ready probe and the raster diff are the same
bytes. The only thing swapped is the print driver.

| cell | CDP host (Chrome 151) | Electron host (Chromium 148) |
|---|---|---|
| `@page url()`, sole reference | DROPPED, hits 1 | **DROPPED, hits 1** |
| … printed twice | PAINTS, 1 | **PAINTS, 1** |
| … + `<link rel=preload as=image>` | PAINTS, 1 | **PAINTS, 1** |
| … + element `background-image` | PAINTS, 1 | **PAINTS, 1** |
| page box + 3 margin boxes, no guard | DROPPED, 1 | **DROPPED, 1** |
| page box + 3 margin boxes, one preload | PAINTS, 1 | **PAINTS, 1** |
| `<img>` guard, **no override at all** | PAINTS, 1 | **PAINTS, 1** |
| `<img>` guard, **override AFTER load** | DROPPED, **2** | **DROPPED, 2** |
| `<img>` guard, **override BEFORE navigation** | PAINTS, 1 | **PAINTS, 1** |
| preload guard, override AFTER load | PAINTS, 1 | **PAINTS, 1** |

Hit counts are the server's own account, not the browser's. Every gated cell
matched, including the `2` on the cache-wipe row — the signature of
`DevToolsEmulator::EnableDeviceEmulation` evicting the memory cache on the first
transition into emulation.

**So a fresh Electron `BrowserWindow` carries no device emulation.** The
engine's post-load `setDeviceMetricsOverride` is a *first* transition on the
desktop exactly as it is on the CLI, the wipe fires the same way, and an `<img>`
guard is defeated on both. This is the measurement residual risk 5 asked for,
and it is a null result: the hosts do not disagree about which second references
work.

**Section D — does the print wait?** Tile held **1500 ms** server-side, no
post-load steps:

| document | CDP host: load / print#1 | Electron host: load / print#1 |
|---|---|---|
| `@page url()` only | +21 ms / **17 ms** | +12 ms / **12 ms** |
| + `<img>` (blocks the load event) | +1529 ms / **22 ms** | +1511 ms / **13 ms** |
| + preload (blocks nothing) | +34 ms / **24 ms** | +16 ms / **12 ms** |

A print that reached a 2-second resource wait would take ≥ 1500 ms. Neither
does. **`webContents.printToPDF` does not reach `Document::WillPrintSoon`
either** — measured, on the exact Electron the app ships. The hypothesis that
the desktop already waits and the CLI does not is **false**, and the structural
option it would have implied ("make the CLI reach the waiting path") is not
available: there is no waiting path on either side.

---

## 6. Measured: the measurement channel diverges, and it decides the build

One line of the two engine logs differs, for the same staged file:

```
CLI      img is below the 300 DPI print bar (800px wide printed at 6.00in = 133 DPI)
desktop  img is below the 300 DPI print bar (800px wide printed at 5.84in = 137 DPI)
```

Probing both hosts through the engine's own post-load sequence — navigate, ready
probe, `setDeviceMetricsOverride({width:576, …})`, `setEmulatedMedia({print})`
— and then reading the layout:

| | pinned `innerWidth` | `documentElement.clientWidth` | `body` width | scrollbar |
|---|---:|---:|---:|---:|
| CLI host | 576 | **576** | 576 | **0** |
| desktop host | 576 | **561** | 561 | **15** |
| desktop host, prediction-page order (`build.ts:1664`, override **before** navigate) | 576 | **561** | 561 | 15 |

`6.00in` is 576 px at 96 dpi; `5.84in` is 561. The desktop's audits, its width
check, its `.gp-flush` pass and its Tier-3 viewer prediction all measure a
document laid out 15 px narrower than the sheet they are meant to represent.
The print itself re-lays out at the paper box and is unaffected — which is
exactly why §4 comes out at `0.0000` while this differs.

**This is not cosmetic. It decides whether the build succeeds.** The pre-print
width check (`build.ts:594-650`) is a **hard error** unless `allowShrink`, and it
measures laid-out boxes with its own override at the page content box
(`build.ts:1509`). A percentage-width box therefore measures 15 px narrower on
the desktop. A fixture with `width:100%; padding: 0 4px` on a 6 × 9 in page —
same source, same manifest, same lib:

| host | exit | outcome |
|---|---|---|
| **CLI** | **3** | `--engine native failed: content wider than the page content box … div.overwide — 450px > 442px content box`. **No PDF.** |
| **desktop** | **0** | builds; writes a 1,465,619-byte PDF; no width diagnostic at all. |

An author who exports from the desktop app gets a book Chromium is silently
shrinking to ~0.98×. The same author running `gutterpress build` on the same
folder is told to fix it and gets no artefact. That is the divergence, and it is
in the direction that hides the problem from the GUI user — the non-technical
author this project exists for.

---

## 7. Root cause, isolated on one host

The desktop's Chromium is not special. Three legs, **one browser** (Chrome 151),
varying only how it was launched:

| leg | pinned | layout width |
|---|---:|---:|
| **A** puppeteer defaults — what the product CLI gets today | 576 | **576** |
| **B** the same browser with `--hide-scrollbars` removed | 576 | **561** |
| **C** leg B + one `Emulation.setScrollbarsHidden` before the pin | 576 | **576** |

Leg B reproduces the desktop's 561 exactly. The divergence is not "Electron
behaves differently" — it is that **the engine's measurement viewport silently
depends on a launch switch nobody in the print path asked for.** The CLI is
correct today by accident: puppeteer passes `--hide-scrollbars` in its default
argument set, and `browser-pool.ts` passes `args: extraChromiumArgs` only, so
nothing in Gutterpress requests it or knows it is load-bearing.

Confirmed on the desktop host as well: `Emulation.setScrollbarsHidden({hidden:
true})` is accepted by Electron's debugger and yields 576/576/576. It is a
page-level state and survives the width check's own
`setDeviceMetricsOverride`/restore pair.

**The fix, simulated end to end.** Wrapping the desktop's own
`createElectronEngineBrowser` so each page sends `setScrollbarsHidden` right
after navigate — the same point in the sequence the product change would sit at,
with no product source touched:

| | desktop, today | desktop, with the call |
|---|---|---|
| low-DPI diagnostic | `5.84in = 137 DPI` | **`6.00in = 133 DPI`** — identical to the CLI |
| width-check fixture | exit 0, ships a PDF | **exit 1, `div.overwide — 450px > 442px`** — identical to the CLI |
| baseline book vs CLI's PDF | `0.0000` | **`0.0000`** — the call changes nothing in the print |

---

## 8. The structural options, and what they cost

**A. A CLI↔desktop PDF comparison gate.** Build fixtures through both hosts in
CI and diff the artefacts.
*Cost:* a new script, a new CI job, Electron plus a display in CI (this machine
has no `xvfb-run`; the existing desktop drives already carry that cost, so it is
not free but not novel either), and 2× the build time for every fixture. It
needs an allowlist, and allowlists rot.
*Why it is the weaker answer:* it can only ever compare **the one Chromium pair
CI happens to have**. The CLI's browser is whatever `requireChromiumExecutable()`
finds on the author's machine — Chrome, Edge, Brave, Vivaldi, Opera, any build
≥ 148. A green gate on Chrome 151 vs Chromium 148 says nothing about Chrome 160
vs Chromium 148, which is the pair a real author will have next year. It detects
one instance of the class and licences the belief that the class is covered.

**B. Take the state into the shared path.** Move every browser-state property
the print path depends on into `build()`'s own post-load sequence, beside the
two `setDeviceMetricsOverride` calls that are already there.
*Cost:* two lines. One experimental CDP command.
*What it buys:* the state stops being a property of how each host obtained a
browser. Neither host can drift, no third host can drift, and the CLI stops
depending on a puppeteer default it never asked for. This is subtraction: it
removes a variable rather than adding an observer.

**C. One browser for both hosts.** The `GUTTERPRESS_PUPPETEER` escape hatch
already routes the desktop to the CLI's pooled external Chromium
(`controller.ts:293`).
*Cost:* it would make the desktop app require a system Chromium — precisely what
ADR 0002 and the Electron engine-browser exist to avoid. The reverse (the CLI
shipping Electron) is absurd for a single-file binary. **Rejected**; the version
gap is structural and permanent.

**D. Narrow `DEFAULT_PRINT_OPTS` so print options cannot drift.** The shared
object is typed `Record<string, unknown>` and is spread into two APIs whose
option vocabularies are not the same set (`paperWidth`/`marginTop` vs
`pageSize`/`margins`). Measured: Electron **silently ignores** CDP-shaped keys —
`marginTop: 2` and `paperWidth: 3` produce byte-identical output and no throw.
*But:* with the product's actual options (`preferCSSPageSize: true`) and any book
that declares `@page`, I could not construct a live divergence — CSS wins on both
hosts, and `pageRanges` and `scale` behave identically. This is a **latent typing
hazard, not a defect**. Naming it is worth two sentences in a comment; changing
code for it today would be machinery for a problem nobody has.

---

## 9. Recommendation

**Do B. Do not do A.**

### 9.1 The change

In `packages/cli/src/engine/compiler/build.ts`, immediately **before** each of
the two `setDeviceMetricsOverride` calls that pin the sheet — the print page at
**line 386** and the Tier-3 prediction page at **line 1664**:

```ts
// The pinned viewport is a MEASUREMENT device: every audit, the width check
// and the viewer prediction read boxes laid out inside it, and it must be the
// sheet, not the sheet minus a scrollbar. Chromium only hides scrollbars if
// something asks; the CLI's browser is launched by puppeteer, which passes
// --hide-scrollbars in its defaults, and an Electron BrowserWindow is not.
// Measured 2026-08-24: the same document measured 576px on the CLI and 561px
// on the desktop, and a book 8px inside the limit hard-errored on one host and
// shipped on the other. Owned here so no host can contribute it.
await page.send("Emulation.setScrollbarsHidden", { hidden: true });
```

Both call sites, because both pages measure. Before the pin, so the two sites
read identically. Nothing in either host changes; nothing in the print options
changes.

**Named risk:** `Emulation.setScrollbarsHidden` is marked experimental in the CDP
domain. Measured working on Chromium 148 and Chrome 151, on both drivers. If it
is ever withdrawn, the invariant test in §10 is what turns that into a red build
rather than a silent 15 px.

**Rejected alternative, recorded so it is not re-proposed:** adding
`--hide-scrollbars` to the Electron app. It is an app-wide Chromium switch that
cannot be scoped to the hidden export window, so it would change the editor and
preview windows' own chrome — the same reasoning that already rejected
`--disable-gpu` in `engine-browser.ts`'s header — and it would leave the CLI
still depending on a puppeteer default. It fixes one host instead of removing
the variable.

**Also rejected:** asserting the invariant instead of setting it (an assert
reports a divergence the engine could simply have prevented), and hiding
scrollbars with injected CSS (it would perturb the author's document, and it
would be host-specific code in the place the whole design keeps host-specific
code out of).

### 9.2 Why no gate

After 9.1 the residual divergence between the two hosts is **the Chromium
version**, and that cannot be removed without shipping or requiring a browser
(option C). A two-host CI gate samples that residual at exactly one point while
costing a job, a runtime doubling and an allowlist. Meanwhile the evidence that
the version gap is currently benign is already strong and was cheap: two whole
books at `0.0000` across a three-milestone gap, and ten gated mechanism cells
matching exactly.

The cheaper structural answer, and the one that generalises, is in §10: a
**single-host** test that the engine's pinned viewport is the sheet regardless of
how the browser was launched. It is red today, needs no Electron, and it fails
for any host — present or future — that reintroduces the drift.

If a CLI↔desktop artefact gate is wanted later, the honest trigger for building
it is a *second* instance of host-contributed state reaching the artefact. One
instance, fixed by removing the variable, is not that.

---

## 10. What must be seen red first

Per `memory:tests-must-be-seen-red-first`, and because every existing test
passed while this divergence was live:

1. **The invariant test — single host, and the whole point.** Launch a browser
   **without** `--hide-scrollbars` (puppeteer `ignoreDefaultArgs:
   ['--hide-scrollbars']`, or the raw `launchChromium` args minus that flag),
   run the engine's pin, and assert `document.documentElement.clientWidth ===`
   the pinned width. **Must be observed reading 561 against `release/0.10.2`**
   with a 576 px pin — it is measured red there (§7 leg B). It must carry the
   reason in its name and failure message: *the measurement viewport is the
   sheet, not the sheet minus whatever chrome the host's browser draws.*
   A version of this test that runs under puppeteer's defaults passes today and
   proves nothing — that is the trap, and it is the same trap as running the
   expiry canary under a pre-navigation override (#186 §6).

2. **The width-check host test.** A fixture whose measured box lands between the
   two hosts' layout widths (`width: 100%; padding: 0 4px` on a 6 × 9 in page
   measures 450 px against a 442 px limit) must produce the **same verdict** —
   error — regardless of scrollbar state. Against `release/0.10.2` under a
   no-`--hide-scrollbars` browser it must be observed **passing the width check**,
   i.e. producing a PDF where it should have errored. This is the red that
   demonstrates the consequence rather than the mechanism, and it is the easiest
   one to skip once the first test is green.

3. **Not required, and deliberately so:** an end-to-end CLI-vs-desktop PDF
   comparison test. §4's `0.0000` results are the evidence that the print
   channel agrees; freezing that comparison into CI buys detection of a class we
   have just removed the cause of, at the cost §8A describes.

Before merging any change here: `scripts/native-parity-gate.ts` green with an
empty allowlist. §9.1 changes what the *prediction* page measures (it is one of
the two call sites), so the viewer↔print gate is directly in scope — more so
than it was for #186, where the change was a `<link>` in `<head>`.

---

## 11. What I could not determine

1. **The art-heavy real book.** `dc-op-manual/field-guide` (1.3 GB of assets, a
   plugin, seven stylesheets, sixteen margin boxes on one URL) is the book that
   motivated #152. Its CLI build was still running when this document was
   written; the comparison is **not measured**. The staged `book.html` was
   preserved so the run can be repeated on both hosts without re-staging. Until
   it lands, §4's generalisation rests on a 5-page purpose-built fixture and a
   66-page real book.
2. **Tier 2 and the print-production path.** Bleed, slug, crop marks, signature
   imposition and PDF/X were not exercised. Post-processing is pure Node and
   host-independent by construction (read from source), but the geometry that
   feeds it comes from the measurement channel §6 is about.
3. **Colour management.** Puppeteer passes `--force-color-profile=srgb`;
   Electron does not. Colour rasters were byte-identical here, but this machine
   is a software-rendered container on one display profile. On a wide-gamut
   display the two hosts could colour-manage differently, and that is exactly the
   caveat `engine-browser.ts`'s own header already records for
   `--font-render-hinting`/`--disable-gpu`. **Unmeasured on real hardware.**
4. **Other platforms.** Linux only. Windows and macOS unmeasured — and the
   scrollbar width that produced the 15 px is platform-dependent, so the
   *magnitude* of §6 differs there even though the *class* does not (on macOS
   with overlay scrollbars it may be 0, which would make the divergence appear
   and disappear depending on a system preference — worse, not better).
5. **How far the version gap can open.** Measured at 151 vs 148, a three-
   milestone gap, agreeing exactly. Nothing here bounds the gap: the CLI accepts
   any Chromium ≥ 148 including a future 160, and there is no measurement of
   what a larger gap does.
6. **Whether §6 has a reverse direction.** The scrollbar makes the desktop's
   measurement *narrower*, so it under-reports right-edge overflow. Whether a
   shape exists where the desktop errors and the CLI does not (a wrap-driven
   height overflow, say) was not constructed.

---

## 12. Evidence discipline

**Measured here** (Chrome 151.0.7922.75 / Electron 42.1.0 + Chromium
148.0.7778.97, Linux x86_64, 2026-08-24):

| # | claim | evidence |
|---|---|---|
| 1 | the staged document is identical on both hosts | `book.html` md5 equal, both books; all three image md5s equal |
| 2 | the printed PDFs agree | `0.0000` colour mean-abs-diff, 5 pages @200 dpi and 66 pages @150 dpi; identical page count, page size, image XObject list, text layer |
| 3 | the comparison is sensitive | preload-guard control: `17.03`–`29.88`, image objects 3 → 8 |
| 4 | neither host is nondeterministic | CLI×2 and desktop×2 both `0.0000` |
| 5 | the engine's internal decisions agree | identical tier/passes/prints/pageCount/converged/viewport/`pageMap`/`predicted.pageMap`/`--gp-content-h` |
| 6 | a fresh Electron `BrowserWindow` carries no device emulation | mechanism §B: all four cells match the CDP host, including `serverHits=2` on the cache-wipe row |
| 7 | `webContents.printToPDF` does not wait for resources | tile held 1500 ms → print#1 = 12/13/12 ms (CDP: 17/22/24 ms) |
| 8 | the measurement channel diverges by 15 px | CLI 576/576/576 scrollbar 0; desktop 576/561/561 scrollbar 15 |
| 9 | the divergence decides the build | same source: CLI exit 3 no PDF, desktop exit 0 + 1,465,619 B PDF |
| 10 | the cause is `--hide-scrollbars`, not Electron | one host, three legs: 576 / 561 / 576 |
| 11 | the proposed call fixes it on both hosts | desktop diagnostics and width-check verdict become identical to the CLI; PDF unchanged at `0.0000` |
| 12 | Electron silently ignores CDP-shaped print options | `marginTop`/`paperWidth` produce byte-identical output, no throw |

**Read from source, not measured:** the single shared `build()` and the
`opts.browser` seam (`build.ts:344-345`); the two host bridges
(`lib/engine.ts:90-107`, `controller.ts:279-294`); `DEFAULT_PRINT_OPTS`,
`readyProbeExpr`, `assertMilestone` as single definitions (`cdp.ts:76-120`);
`launchChromium`'s divergent flag set (`cdp.ts:149-162`) and that only the parity
gate and the dev CLI use it; the width check as a hard error and its own
override (`build.ts:594-650`, `:1509`); the prediction page's pre-navigation pin
(`build.ts:1664`); the browser-resolution candidate list including Edge, Brave,
Vivaldi and Opera (`lib/chromium.ts`).

**Taken from #187 without re-measuring:** that
`DevToolsEmulator::EnableDeviceEmulation` calls
`MemoryCache::Get()->EvictResources()` when `!device_metrics_enabled_`, and that
`PrintRenderFrameHelper::PrintWithParams` never calls
`Document::WillPrintSoon`. This document measures the *behaviour* those source
reads predict, on both hosts, and finds it identical on both.

**Inferred, not proven:** that §4's agreement generalises to Tier 2, PDF/X and
art-heavy books (§11.1–11.2); that the version gap remains benign above three
milestones (§11.5).
