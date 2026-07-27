# Asset pipeline deep analysis — 2026-07-27

How print-md gets CSS, JS, fonts and images from a project into `book.html`, the
PDF, and the published site — and the latent defects in that path.

**Scope.** `packages/cli/src` (build, staging, pagination, preview) and
`packages/viewer` (Electron export/preview). Read-only analysis; no code changed.

**Method.** Nine parallel readers mapped one dimension each; every candidate
defect was then re-checked by an independent adversarial verifier instructed to
refute it; a completeness critic looked for what the sweep missed. Findings below
are the ones that survived, each reproduced against the real modules.

---

## 1. The one-paragraph version

There is no asset *pipeline*. There are **two independent mechanisms that never
talk to each other**:

1. **A reference emitter.** `resolveActiveStyles` picks stylesheet paths and
   `assembleBookHtml` writes them into `book.html` as `<link href>` — verbatim,
   unescaped, with **no existence check**. Markdown image `src` values get a
   narrow regex rewrite. CSS `url()` is never inspected.
2. **A directory copier.** `copyAssets` copies the directories named in
   `source.assets` — a fixed list that defaults to
   `["css","fonts","images","styles","assets"]` — into the output.

Nothing verifies that (1) ⊆ (2). When a reference points outside the copied set,
the file simply isn't there, the pagination browser 404s it, **and the build
exits 0**. That single missing invariant is the root cause of roughly half the
findings below.

---

## 2. How it actually works

### 2.1 Declaration and resolution

`source.assets` is a `string[]` (`schema/manifest.types.ts:73`). `manifest.schema.json`
documents constraints, but **is never loaded at runtime** — it ships only as an
editor-autocomplete file (`embedded-assets.ts:36,76`). Every constraint in it is
advisory.

`resolveConfig` merges cli > manifest > preset via `mergeShape`
(`manifest.ts:205-224`). Arrays are **leaves**: `cliValue ?? manifestValue ?? presetValue`
(`manifest.ts:221`). So a manifest `source.assets` **replaces** the preset list
wholesale — it does not extend it. Default is
`["css","fonts","images","styles","assets"]` (`presets.ts:23`, `:126` — identical
in both presets). `themes` is not in it, and nothing anywhere adds it.

Destination mapping is one function (`assets.ts:75-106`):

```
src       = join(inputDir, assetPath)
destName  = assetPath.startsWith("..") ? basename(assetPath) : assetPath   // :33-35
fallback  = join(inputDir, destName)          // used when src is absent   // :82-83
copyDir(resolved, join(outDir, destName))                                  // :101
```

`copyDir` (`exec.ts:217-229`) is `mkdir` + `readdir` + recurse/`copyFile`. No
exclude list, no symlink handling, no containment guard, no error aggregation —
in contrast to its sibling `copyDirectory` (`utils/file-utils.ts:102`), which has
all four.

The same mapping is re-derived **three more times**, independently: the preview
watcher (`preview/file-watcher.ts:33-48`), validation (`validation-exec.ts:237`,
using `resolve` not `join`), and preview startup's `..`-existence check
(`server.ts:86-97`).

### 2.2 The build

`runBuild` (`build-runner.ts:602`) is five steps with **no cleanup phase**:

1. **Plan** — `outDir = opts.outDir ?? resolve(manifestDir, config.output.dir)` (`:187`), default `dist`.
2. **Create** — `mkdir(outDir, {recursive:true})` (`:608`). This is the *only*
   lifecycle operation on `outDir` in the whole codebase.
3. **Render** — `book.html` written to `outDir` (`markdown/index.ts:117`).
   Stylesheet hrefs come from `resolveActiveStyles` and are emitted raw at
   `assemble.ts:160`. `PAGED_CSS` + plugin CSS are **inlined** into one `<style>`,
   so they need no copying.
4. **Copy assets** — `copyAssets(inputDir, outDir, config.source.assets)` (`:281`),
   *after* the HTML that references them.
5. **Paginate + finalize** — see below.

### 2.3 Staging and pagination

`stagePaginationInput` (`build-staging.ts:124-150`) makes a **second** copy of
every asset into a fresh `mkdtemp` stage:

```
rm -rf + mkdir stage
copyFile(outDir/book.html → stage/book.html)
copyAssets(outDir, stage, assetDirs.map(resolveAssetDestName))   // from outDir, not inputDir
mkdir stage/vendor + copy embedded paged.polyfill.js             // AFTER the asset copy
patchHtmlForPagedjs(...)
```

Chromium loads `http://127.0.0.1:<ephemeral>/book.html` off a `node:http` server
rooted at the stage (`pagination.ts:36-64`). So the PDF sees exactly
`book.html + flattened(source.assets) + vendor/` — nothing else. Anything else
404s, and **no `page.on("requestfailed"/"console"/"pageerror")` listener exists
anywhere in `packages/cli/src` or `packages/viewer`**.

The flatten round-trip is idempotent (`"../shared/css"` → `outDir/css` →
`stage/css`), so the `fallbackSrc` branch is dead code on this path. Note the
polyfill copy runs *after* the asset copy, so the polyfill always wins — a user
`vendor/` cannot break pagination, though their own `vendor/paged.polyfill.js` is
shadowed in the stage.

Waiting: `goto(networkidle0)` → `document.fonts.ready` **once, before Paged.js
runs** (`pagination.ts:213-215`) → poll `__PAGED_RENDERED__` → `page.pdf()`.

### 2.4 Preview

Structurally different, and this is the crux of the divergence class:
`initializePreviewDirectories` (`preview/lifecycle.ts:92-95`) `copyDirectory`s the
**entire project tree** into a temp dir (minus 8 hardcoded excluded dir names and
symlinks), *then* layers `copyAssets` on top (`:106-117`). The server is rooted
there (`http-server.ts:508`).

Both roots resolve relative URLs against a root-level `book.html` — identical URL
semantics, **different contents**. Everything in the project resolves in preview;
only listed asset dirs resolve in the build.

### 2.5 Viewer and publish

Viewer PDF export sets `outDir` to `dirname()` of the **Save-dialog path**
(`viewer/electron/export/controller.ts:168-169` + `build-runner.ts:112`) and runs
the full `runBuild` output pipeline into it. Because `opts.pdfRenderer` is set,
`staticHtmlRaw` is `undefined` (`build-runner.ts:496-498`) so `finalizeStaticBook`
never runs.

Publish deploys `outDir` **verbatim** (`swa deploy <artifact.path>`,
`publish/providers/azure-swa.ts:111-116`). The only content gate errors on a
missing `book.html` and warns about literally two names, `book.pdf` and `publish/`
(`run-publish.ts:169-200`).

---

## 3. Confirmed defects

Severity is the verifier's corrected severity, not the finder's claim.

### 3.1 The missing invariant: referenced ≠ copied

| # | Severity | Defect |
|---|---|---|
| 1 | **HIGH** | A stylesheet outside the 5 default asset dirs is `<link>`ed but never copied. It 404s on the stage server, **Paged.js parses the 404 body `"Not found"` as CSS**, and the build exits 0 with a valid, completely unstyled PDF. |
| 2 | **HIGH** | `themes/` is in no preset's `source.assets`. `applyTheme` appends `themes/<id>/theme.css` to `styles:` (`theme-manager.ts:281-312`) — so **applying a theme in the viewer produces a build that silently drops it** (falls back to the still-copied `styles/book.css`), along with any fonts/images the theme bundled. |
| 3 | **MEDIUM** | Setting `source.assets` at all replaces the preset list, silently dropping `styles`. Deliberate merge semantics (`manifest.test.ts:209-215` pins it) — the defect is that nothing detects the resulting hole. `docs/SOURCE-FILES-GUIDE.md:20/34/80/104/125` omits `styles` from every example, making the docs the proximate cause. |
| 4 | **MEDIUM** | The staging copy passes no options object (`build-staging.ts:138`), so `onSkip`/`onCollision` are dead there. Combined with no browser error listener and no asset inventory in the fingerprint, a missing asset is **undetectable at every layer**. |

The Paged.js-parses-404 mechanism is worth stating precisely: its fetch helper
resolves on *any* status (`paged.polyfill.js:27448-27470`), so a 404 is handed to
csstree as a stylesheet body rather than raising.

### 3.2 URL rewriting: the dead-origin bug

| # | Severity | Defect |
|---|---|---|
| 5 | **HIGH** | Paged.js `replaceUrls` (`paged.polyfill.js:26595-26608`, called unconditionally at `:26477`) rewrites **every** non-`data:` CSS `url()` to `new URL(href, this.url)` — where `this.url` is the throwaway stage origin. The shipped static `book.html` therefore points `@font-face src`, `background-image`, `list-style-image` at `http://127.0.0.1:<dead ephemeral port>/…`. |

I verified this directly in the vendored polyfill. Scope: markdown `<img src>` is
**not** affected (`images.ts` writes a relative attribute that `outerHTML`
preserves). The PDF is correct because it prints while the server is alive. It
hits `--format html` with Chromium present, and the static `book.html` emitted as
a side-effect of `--format pdf`. Every rebuild picks a new ephemeral port, so the
URLs are not even stably wrong.

### 3.3 Output directory lifecycle

| # | Severity | Defect |
|---|---|---|
| 6 | **HIGH** | `outDir` is never cleaned, diffed or pruned. Deleted/renamed assets persist indefinitely, get re-staged into the pagination pass (`build-staging.ts:138` reads *from* `outDir`), and get published. |
| 7 | **HIGH** | Viewer PDF export runs the whole output pipeline into the user's **Save-dialog folder**: `book.html`, the project's `css/fonts/images/styles/assets` trees, and `build-fingerprint.json` are written there, `copyFile` overwriting same-named user files unconditionally. Choosing `~/Documents` scatters a project's asset trees across it. |
| 8 | **MEDIUM** | No lock on `outDir` anywhere (no analogue of `withRepoLock`). Two concurrent builds interleave `copyDir`'s `mkdir`/`copyFile` and both write `book.html`; only the *stage* dirs are isolated. |
| 9 | **LOW** | Non-pdfx PDF renders in place with puppeteer's `'w+'`, so an IO error during the write destroys the previous good PDF. Narrow window — pagination completes before `page.pdf()` opens the path. |

### 3.4 `copyAssets` / `copyDir` robustness

| # | Severity | Defect |
|---|---|---|
| 10 | **HIGH** | `copyDir` has **no exclusion list**. A `../shared` that is its own checkout copies `.git/`, `node_modules/` and `.env` into `outDir` — which `swa deploy` then uploads verbatim. Reproduced: `dist/shared/.git/config` containing a `x-access-token:ghp_…` remote URL becomes publicly served. The preview mirror *does* exclude those dirs, so the author gets no local signal. **This is a credential-disclosure path.** |
| 11 | **MEDIUM** | The `fallbackSrc` branch (`assets.ts:82-83`) silently substitutes a same-named *local* directory when a `../shared` entry is missing, fires `onCopy` naming the path that doesn't exist, never fires `onSkip`, and makes a later genuine entry emit a **fabricated** collision warning. |
| 12 | **MEDIUM** | A `source.assets` entry that is a **file** creates an empty dir then throws `ENOTDIR`; a **symlinked subdirectory** inside an asset dir throws `EISDIR` (Node/Electron) or `ENOTSUP: operation not supported on socket` (Bun — i.e. the shipped binary). Both abort after `book.html` is written, leaving a mixed output dir, with a raw un-branded Node error. |
| 13 | **MEDIUM** | No runtime type check on `assets`. A scalar `assets: css` (instead of a list) is iterated **character by character** — `c/ not found`, `s/ not found` — then throws `assetDirs.map is not a function` naming no manifest field. |
| 14 | **MEDIUM** | `vendor/`, `preview/scripts/`, `favicon.ico` are hard-reserved by the preview server and answered from the embedded-asset dir before the project fallback — so an author's files at those paths are shadowed in preview and clobbered in the build. |
| 15 | **LOW** | `resolveAssetDestName` is a string-prefix test, not path normalization. An interior `..` (`shared/../../design-system/css`) is passed to `join(outDir, destName)`, which collapses it — **the copy lands outside `outDir`**. An entry of `".."` copies the project's entire parent directory into `tmpdir()/print-md-preview` on the preview path. No containment guard exists. |
| 16 | **MEDIUM** | `copyDir` has no containment guard for the inverse case either: an asset entry containing `outDir` recurses ~340 levels until `ENAMETOOLONG` (~250-300ms), leaving ~680 orphaned nested directories that nothing cleans. |
| 17 | **LOW** | Collision detection is depth-1 only (`topLevelFileNames`, `assets.ts:18-26`) while `copyDir` overwrites at any depth — nested clashes are silent. Last-entry-wins is documented intent; the hole is in the diagnostic. |
| 18 | **MEDIUM** | Absolute asset paths: `copyAssets` uses `join` while validation uses `resolve` (`validation-exec.ts:237`) — build and validate disagree about what an absolute entry means. The build warns; **preview is silent** (`lifecycle.ts:109` uses `debug`). |

### 3.5 Preview ↔ build divergence

| # | Severity | Defect |
|---|---|---|
| 19 | **HIGH** | Preview mirrors the **whole project**; the build copies **five directories**. Every asset-copy defect above is therefore invisible until export. This is the structural source of "works in preview, broken in the PDF". |
| 20 | **HIGH** | The preview watcher passes `ignored: /(^\|[\/\\])\../` to chokidar, which matches against the **absolute** path — so a project under any dot-ancestor (`~/.local/share/books/…`, `~/.config/…`, a Syncthing `.sync/` subtree) has its watcher **silently disabled entirely**. No events, no reload, no warning; the preview is frozen at its startup snapshot. Hits the Electron viewer too. |
| 21 | **MEDIUM** | `mirrorChanges` has no unlink branch and the temp mirror is never pruned — a deleted asset **keeps rendering in preview** while the build correctly drops it. This points the divergence the *opposite* way from everything else. |
| 22 | **MEDIUM** | `DEFAULT_EXCLUDE_DIRS` hardcodes the literal `'dist'` while `output.dir` is configurable (the schema itself advertises `build/pdf`). Set `output.dir: build/pdf` and the preview mirrors the previous build output into itself; conversely a legitimate source folder named `dist` at any depth is dropped from preview but copied by the build. |
| 23 | **MEDIUM** | Preview copies every default asset dir **twice** (whole-tree copy, then `copyAssets` over the same names). Measured on tmpfs with 30 MB of images: 45 ms + 21 ms — **47% of startup copy time re-writes bytes it just wrote**. Both copiers are serial `copyFile` with no mtime/size check. Per build the same tree is copied twice more. |
| 24 | **LOW** | `/vendor/*`, `/preview/scripts/*` are served with `public, no-cache` and a **version-only** ETag, so editing those sources during development yields a 304 forever until `PACKAGE_VERSION` changes. |

### 3.6 Fonts and images

| # | Severity | Defect |
|---|---|---|
| 25 | **MEDIUM** | A font whose fetch **fails** is silent end-to-end. Offline/CI: a remote `@import` fails DNS fast, `networkidle0` is satisfied, `fonts.ready` resolves with a `FontFace` in `status:"error"`, Paged.js swallows the failure with a `console.warn` nobody listens to, and the PDF uses a fallback. Chromium embeds whatever it *actually used*, so `pdf.print.embedded-fonts` validates clean on the substituted font. **Note the ordering is NOT the defect** — see the correction in §7. |
| 26 | **MEDIUM** | No built-in theme uses `@font-face` — all four rely on system family names (`"Impact"`, `"Trajan Pro"`), so identical input yields **different PDFs on Linux CI vs. a designer's Mac**. |
| 27 | **MEDIUM** | The docs disagree on where fonts go: `packages/cli/README.md:96` says top-level `fonts/`; `01-getting-started.md:172` says `assets/fonts/`; the `@font-face` example at `04-styling-theming.md:101` uses `url("../fonts/…")` from `styles/`, which only resolves for the README layout. |
| 28 | **MEDIUM** | `printsafe`'s `no-remote-urls` treats `@import url(https://fonts.googleapis.com/…)` as a **build-breaking error** — while `04-styling-theming.md:85` documents that exact line as the web-font recipe. And `@import "https://…"` without `url()` isn't flagged at all (`extractUrls` only matches `url(...)`). |
| 29 | **MEDIUM** | `normalizeImageSrc` rewrites only `temp/images/` and `images/` prefixes. `assets/images/x.png` — the path the user guide teaches — gets no rewrite and works only by accident of `assets` being in the default list. Raw HTML `<img>`, plugin output, and CSS `background-image` are deliberately untouched. |
| 30 | **LOW** | `STATIC_MIME` omits `.webp/.avif/.tif/.tiff/.eot` although `ALL_IMAGE_EXTS` blesses `webp`. Consistency gap rather than a rendering bug — every strict-MIME class (`.css/.js/.mjs/.json`) *is* present and Chromium sniffs image bytes. |
| 31 | **LOW** | Nothing waits for CSS `background-image` after pagination — Paged.js's only image barrier is `wrapper.querySelectorAll("img")`. Largely self-protecting in practice because the Polisher re-fetches stylesheets early. |
| 32 | **MEDIUM** | The only reference checker, `source.links.local-refs`, resolves refs against the **markdown file's** directory (`local-refs.ts:114-117`) — not the `outDir` frame the browser actually uses. It cannot catch the copy gap it appears to guard. |

### 3.7 Version control and provenance

| # | Severity | Defect |
|---|---|---|
| 33 | **HIGH** | **No project ever gets a `.gitignore`.** Neither `scaffoldProject` nor `adoptFolder` writes one. Auto-snapshot is on by default at 10 min of quiet and auto-sync **pushes**. So every build's `dist/` — a fresh incompressible PDF plus re-copied asset trees — is committed and pushed. Verified: `listWorkdirChanges` returns `["dist/book.pdf", "dist/styles/book.css"]`. Ends in a multi-GB `.git`, a rejected push at GitHub's 100 MB limit, and `restoreVersionWithBackup`'s `checkout({force:true})` later writing an *old* `dist/` over the current one. |
| 34 | **HIGH** | `build-fingerprint.json`'s `sourceRevision.dirty` **can never be `false`** in the shipped layout: the fingerprint is written after the build has already dirtied the tree it fingerprints (`dist/` is untracked, per #33). The test pinning `dirty:false` (`build-fingerprint.test.ts:110-145`) uses an outDir *outside* the repo — a layout no real invocation produces, so it is structurally unable to catch this. |

### 3.8 Documented-but-wrong

- `docs/SOURCE-FILES-GUIDE.md:86` still teaches `output.html: novel.html` as a
  working manifest field; it is deprecated and ignored (`manifest.ts` warns, the
  file is always `book.html`).
- `manifest.schema.json` claims "Every asset directory is FLATTENED into one
  output folder". False — only `..`-prefixed entries flatten; `assets/fonts`
  keeps its nesting.

---

## 4. Test coverage gaps

`assets.test.ts` has **four** tests: two for `resolveAssetDestName` (`"css"`,
`"../x/css"`) and two for top-level collision detection. Nothing covers absolute
paths, single-file entries, interior `..`, trailing slashes, backslashes,
symlinks, nested collisions, the `fallbackSrc` branch, or a non-array value.

`stagePaginationInput`'s asset branch is exercised only with the default 5-entry
list. No test ever passes it a `..`-relative entry, so the flatten-and-re-resolve
round trip — the single most subtle behavior in the module — is unexercised.

---

## 5. What would actually fix this

Ranked by defects eliminated per unit of complexity added, and consistent with
CLAUDE.md's "reduce complexity unless justified":

1. **Close the invariant.** After `copyAssets`, resolve every `<link href>` and
   `<img src>` in `book.html` against `outDir` and fail (or loudly warn) on any
   miss. One check retires findings 1-4 and turns 5, 19, 32 into caught errors
   rather than silent wrong output. Cheapest possible version: have
   `renderBook` assert that each `resolveActiveStyles` result exists under
   `outDir`.
2. **Attach a `requestfailed`/`console` listener to the pagination page.** The
   browser already knows every asset that 404'd; nothing is listening. This is
   the highest-information-per-line change available.
3. **Make the style path copy its own files.** `resolveActiveStyles` knows the
   stylesheet paths; having the renderer copy them (rather than hoping a
   directory list covers them) removes the `themes/` class of bug at the root —
   the §0 "fix the most general layer" move.
4. **Give `copyDir` the exclude list `copyDirectory` already has**, plus a
   containment assert on the destination. Retires 10 (a credential leak), 15, 16.
5. **Scaffold a `.gitignore` containing the resolved `output.dir`.** Retires 33
   and makes 34's `dirty` flag meaningful.
6. **Clean or reconcile `outDir`** (or stage from `inputDir` instead of `outDir`).
   Retires 6 and the staleness half of 21.

7. **Fix the checks that hard-fail correct projects** (§6.1 #37-41). These are
   worse than the silent gaps: a percent-encoded filename, a commented-out
   `@font-face`, or a chapter in a subfolder each abort a build that would
   otherwise produce correct output. Percent-decode before `existsSync`, strip
   comments before regex-scanning CSS, and resolve refs in the frame the renderer
   actually uses (project root, not the markdown file's directory).
8. **Make `resolveActiveStyles` the single input to lint/validation too** (§6.1
   #36). Today `validation-exec` and `lint-runner` re-resolve `styles:` their own
   way and silently inspect nothing when it misses — a false green on the gate
   that is supposed to catch exactly this.

Items 1-3 all point the same direction: the reference emitter and the copier need
one shared source of truth about "what files does this book need", rather than a
hand-maintained directory list that authors are expected to keep in sync. Items
7-8 say the same thing about the validation layer — it currently re-derives the
asset mapping a third and fourth time, and disagrees with the build both ways.

---

## 6. Second pass — the remaining 42 candidates

The first pass verified the top 30 of 72 candidates. A second adversarial pass
covered the other 42; 41 survived, 1 was refuted (§7). Most re-derived findings
already above (`themes/`, preview↔build divergence, and the Save-folder spray
were each independently rediscovered by 3-5 different readers — a useful
consistency signal). The genuinely new material:

### 6.1 The validation gates are themselves broken

This is the most consequential new cluster: the checks that *appear* to guard the
copy gap mostly cannot, and several hard-fail correct projects.

| # | Severity | Defect |
|---|---|---|
| 35 | **HIGH** | **No check ever reads `outDir`.** `ctx.outputDir` is consumed by zero checks; the only check touching `book.html` is htmlhint (syntax rules only); `paginateAndCapture` registers no `requestfailed`/`pageerror` listener. `local-refs` and `missing-font-refs` both resolve against the **source tree**, so they structurally cannot catch a missing *output* asset. |
| 36 | **MEDIUM** | **Lint and validation go blind on shared stylesheets.** `validation-exec.ts:227` and `lint-runner.ts:30` resolve `styles:` against `manifestDir` with no fallback. When `styles:` names the *flattened* asset destination (the only spelling that works — see #39), the path doesn't exist there, `cssFiles` is `[]`, and stylelint + `missing-font-refs` return zero results while `runLint` reports `ok:true` with "No CSS files found to lint". Both build gates report green on a stylesheet **nothing inspected**. Reproducible in-repo against `examples/with-design-guide/book-01`. |
| 37 | **MEDIUM** | `missing-font-refs` regex-scans raw CSS with **no comment stripping**, so an `@font-face` block inside `/* … */` is treated as live and emits `severity:"error"` — aborting `build --format pdf`. A commented-out font template is a normal authoring state. |
| 38 | **MEDIUM** | `missing-font-refs` URL extraction is broken four ways: `[^}]*src:` backtracks to the **last** `src:` in a block (so the first declaration of the standard two-`src:` pattern is never checked); `[^'")\s]+` can't match a quoted filename with spaces (a genuinely missing file **passes**); no `decodeURIComponent`, so a correct `url("Source%20Sans%20Pro.ttf")` **hard-fails the build**; and `//host/f.woff2` is mis-diagnosed as a missing local file. The only test is `returns empty when no cssFiles`. |
| 39 | **MEDIUM** | `local-refs` never percent-decodes, so `![](images/my%20photo.png)` — the only bracket-less spelling CommonMark actually renders — **hard-fails the build with exit 1** although the file exists and is served correctly (`resolveStaticPath` *does* decode). The only spelling satisfying both renderer and checker is the undocumented `![](<images/my photo.png>)`. Also breaks any non-ASCII escape (`caf%C3%A9.png`). |
| 40 | **MEDIUM** | A chapter in a subfolder **cannot satisfy both** the renderer and `local-refs`: the renderer resolves against the project root (book.html sits at the stage root), the check against the markdown file's directory. The frame the user guide teaches is reported as an error. |
| 41 | **MEDIUM** | `approvedFontFiles` patterns are globbed with `cwd` = each already-resolved asset dir, so the project-rooted pattern documented in `examples/with-validation/manifest.yaml:53` matches zero files and flags every font as unapproved. The working form is the counter-intuitive `**/*.{woff2,otf,ttf}`. |
| 42 | **LOW** | `pdf.print.embedded-fonts` — and six other format-agnostic post-build checks — never run for `--format pdf`, only `pdfx` (phase gate at `build-preflight.ts:112`). Documented and intentional, but it means the font-substitution failure in #25 has no post-build net on the format most people use. |

### 6.2 Cross-platform

| # | Severity | Defect |
|---|---|---|
| 43 | **MEDIUM** | **`glob`'s `nocase` defaults to `true` on darwin/win32 and `false` elsewhere.** `collectImageFiles` passes a lowercase-only brace glob without setting it, so `Cover.PNG` is silently skipped by every image check on Linux CI and flagged on a designer's Mac. Verified by execution. No test anywhere uses a case-mismatched filename. |

### 6.3 `temp/images/` is vestigial

| # | Severity | Defect |
|---|---|---|
| 44 | **MEDIUM** | `normalizeImageSrc`'s `temp/images/` → `images/` rewrite has **zero producers** anywhere in the codebase or in git history. For an author who keeps art in `temp/images/`, the HTML points at `images/<file>` which no code path creates — missing in both preview and build, and `local-refs` passes because it validates the raw *pre-rewrite* ref. The obvious fix (adding `temp` to `source.assets`) **does not help**: the file lands at `dist/temp/images/wip.png` while the HTML still requests `images/wip.png`. Verified by running the real build. |

### 6.4 Embedded-asset extraction

| # | Severity | Defect |
|---|---|---|
| 45 | **MEDIUM** | The extracted **4.77 MB** temp dir is never cleaned up — one leak per process, forever. Every `build`/`new`/`preview`/viewer launch abandons a fresh tree (3.7 MB of it the CMYK ICC, extracted unconditionally regardless of which key was requested). Observed 40 such dirs on this checkout. Every *other* temp dir in the repo has cleanup — `createStageRoot` via `finally`, the plugin vendor dir via `process.on("exit")`, the preview dir via both a PID reaper and explicit removal — which makes this a consistency gap, not a design decision. |
| 46 | **LOW** | `getAssetsDir` re-checks and re-assigns `extractPromise` **after** an `await`, so K concurrent callers hitting the sentinel-miss branch each start their own extraction → K dirs, K−1 leaked. Cold start is correctly single-flighted; the test covers only the sequential case. |
| 47 | **LOW** | The cache is validated by a **single sentinel file**; `getAssetPath` does no per-asset check. Partial loss of the 23 files is invisible and surfaces downstream as a raw `ENOENT` from `project-scaffold`. |
| 48 | **LOW** | `dist/` ships **two independent copies** of the whole 418 KB lib graph (`package.json:51-52` builds `src/cli.ts` as a second `--splitting` invocation into the same dir), so every module-level singleton — `extractPromise` included — exists twice. Latent only: no shipping consumer can trigger it today. `docs/ARCHITECTURE.md:24` still describes the pre-regression single-invocation build. |
| 49 | **LOW** | Built-in themes **structurally cannot bundle fonts or preview images** — `EMBEDDED_ASSETS` is a hand-written literal map with no directory-level embedding, so `applyTheme`'s "copy the WHOLE folder" always copies a 2-file folder, contradicting `theme-manager.ts`'s own docstring. |

### 6.5 Viewer and publish

| # | Severity | Defect |
|---|---|---|
| 50 | **MEDIUM** | **`media:importImage` picks its destination from disk state** (`images/` if present, else `assets/`) with zero reference to `source.assets` — the only list the build copies. Two of the repo's own examples are already in this state: `print-md-user-guide` (`assets: [styles]`) and `with-validation` (lists `images` but has no `images/` dir, so the route falls back to the unlisted `assets/`). Renders in preview, vanishes from the export, no diagnostic. |
| 51 | **MEDIUM** | On the PWA target, `renderBookHtml` inlines project CSS to work around the blob-URL base problem but does nothing for other assets — every `<img src>` and every CSS-referenced font/background is **unresolvable** in both in-browser preview and HTML export. No `<base>` tag, no service-worker scope for project assets. This is an unimplemented half of an explicit plan requirement (`docs/pwa-webadapter-plan.md:237-243` prescribes inlining CSS *and* rewriting `<img src>`). No test exercises `renderBookHtml` at all. |
| 52 | **MEDIUM** | Viewer PDF export's un-finalized `book.html` is concretely broken, not merely unfinished: it keeps the srcless `<script data-pagedjs-polyfill>` slot and gets no nav scripts, so opening it yields one unpaginated scroll. No `index.html` either. |
| 53 | **MEDIUM** | Publish's extras warning is a hard-coded two-name list (`book.pdf`, `publish`), so an author-set `output.filename` and `build-fingerprint.json` are uploaded unwarned. |
| 54 | **LOW** | Publish resolves a relative `output.dir` against `projectDir` while the build resolves it against `manifestDir` — they disagree whenever `--manifest` points outside the project positional. CLI-only; nothing covers the divergent case. `run-publish.ts:8-9` also documents a `--build` flag that does not exist. |
| 55 | **MEDIUM** | Desktop Export→HTML is offered unconditionally in the dialog but always fails with a PDF-specific error. |

### 6.6 Preview watcher

| # | Severity | Defect |
|---|---|---|
| 56 | **MEDIUM** | **The watcher's ignore set does not match the copier's exclude set.** The watcher filters only dotfiles; the copier excludes `node_modules, .git, .claude, .opencode, .reviews, .references, .build, dist`. So everything the copier skips (except dot-prefixed names) is fully watched and mirrored — `dist/`, `node_modules/`, `plugins/npm/` — reload-storming the preview on every build. |

---

## 7. Correction

One first-pass finding was **refuted**, and it changes a conclusion, so it is
recorded rather than quietly dropped:

> ~~`document.fonts.ready` is awaited before pagination, so fonts first used in
> Paged.js-generated content (e.g. an `@page` margin box) are never waited for.~~

**Not a defect.** The vendored polyfill force-loads and awaits **every declared**
`@font-face` before laying out any page: `Chunker.flow()` calls
`await this.loadFonts()` (`paged.polyfill.js:2918`) immediately before
`this.render(...)`, and `loadFonts()` calls `FontFace.load()` on every entry of
`document.fonts` irrespective of usage. The Polisher has already inserted the
processed `@font-face` rules into `<head>` by that point. So a font used only in
a margin box is fetched and awaited before the first margin box exists, and no
fallback-then-correct-face split can occur. print-md's own `fonts.ready` await
(`pagination.ts:215`) is redundant belt-and-braces, **not** the load-bearing
guard.

The real font gap is narrower and stands as §3.6 #25: a fetch that *fails* is
swallowed by Paged.js with a `console.warn` that nothing listens to. Which is,
again, finding #2 in the fix list — attach a listener.

---

## 8. Coverage note

72 candidate defects were raised across the 9 dimensions; all 72 were
adversarially verified. 71 survived (30 first pass, 41 second), 1 was refuted.
A 30/71 → 71/72 survival rate is high enough to be worth flagging as a caveat on
the method rather than as a compliment to it: verifiers narrowed scope on 24 of
the surviving findings (recorded as PARTIALLY_TRUE above, with the corrected
scope), but only one claim was rejected outright. Treat the HIGH severities —
which carry executed repros — with more confidence than the LOWs.

---

## 9. Amendment — independent review of this analysis and its recommendations

A second look at the document above, questioning its fix list and asking what
design decisions produce the symptom catalog. Claims here were verified against
the code directly; one was tested by execution.

### 9.1 Corrections to the analysis

**(a) No fix item addresses finding #5 — and item 1 falsely claims to.**
Fix item 1 says its existence check "turns 5, 19, 32 into caught errors". It
cannot catch #5: the dead-origin URLs live as CSS `url()` inside the serialized
`<style data-pagedjs-inserted-styles>` block, which a `<link href>`/`<img src>`
resolution check never inspects — and the referenced *files* exist in `outDir`;
it is the *URLs* that are wrong. The original list therefore ships no fix at all
for one of its own HIGH findings.

**(b) Fix item 3 is a half-measure that recreates the bug one level down.**
Copying the stylesheet file without its `url()` closure converts "unstyled PDF"
into "styled PDF with silently missing fonts and backgrounds" — the same silent
class, now harder to notice. Either copy the closure or don't bother.

**(c) Fix item 6 points the wrong way.** "Stage from `inputDir` instead of
`outDir`" keeps the copy, the flatten round-trip, and the staleness class alive.
The stage itself is the redundant artifact (see R2 below); delete it, don't
re-point it.

**(d) The `.git`-publish finding (#10) mis-states the preview's behavior —
verified by execution.** Its claim that "the preview mirror hides
`.git`/`node_modules`, so the author has no local signal" is wrong for exactly
the `../shared` case it describes: external asset entries are copied by the
**exclude-less `copyDir`** (`lifecycle.ts:106` → `assets.ts:101`), not by
`copyDirectory`. Running `initializePreviewDirectories` against a project with
`assets: [styles, ../shared]` where `shared/` contains `.git/` and `.env`
produces a preview temp dir containing `shared/.git`, `shared/.env`, **and the
project's own `.env`** (the 8-name exclude list has no dotfile rule). The
preview server then serves all of these over localhost HTTP —
`http://127.0.0.1:3579/.env` answers 200 to any local process. The publish leak
is real; the "no local signal" framing was backwards, and the preview's own
serving of secrets is an unrecorded (localhost-scoped) sub-finding.

**(e) The §7 refutation has an unstated corollary.** If the polyfill
force-loads every declared `@font-face` before layout, then
`pagination.ts:215`'s own `document.fonts.ready` await is dead weight and can be
deleted — a small simplification the correction stopped short of drawing.

**(f) "71 confirmed findings" overstates the defect surface.** They are
observation points of about five design decisions (§9.2). The count — and the
severity tables — invite whack-a-mole patching, and fix items 1, 2, 7, 8
partially embody that: they add *detectors for divergence* between subsystems
instead of removing the divergence. A fix list that closes with "add a check,
add a listener, fix the checks, share the resolver with the checks" is treating
the symptom layer.

### 9.2 Root causes — the design decisions the symptoms bubble up from

**R1. Declaration over reference.** `source.assets` asks the author to maintain,
by hand, a parallel declaration of what the book references — while the renderer
is the component that *knows* what the book references, because it emits every
href. Any two independently-maintained descriptions of the same fact drift, and
here every drift is silent because neither side checks the other. This single
decision accounts for ~20 findings: the entire §3.1 class, all four `themes/`
findings, `normalizeImageSrc`'s vestigial rewrite (#44), `media:importImage`'s
mismatch (#50), and the styles-dropping merge hazard (#3, #28).

**R2. Copying to assemble a root, instead of composing a root at serve time.**
Three tree copies exist for one purpose — making relative URLs resolve against
some root: `inputDir→outDir`, `outDir→stage`, `inputDir→previewTemp`. They use
two copier implementations with different exclusion/symlink semantics, and the
path mapping they share is re-derived four times (`assets.ts`, `file-watcher.ts`,
`validation-exec.ts`, `server.ts`). The preview server already proves the
alternative in-tree: `/vendor/*` and `/preview/scripts/*` are **virtual
overlays** served from the embedded dir with no copy (`http-server.ts:337`). The
pagination stage is a full-tree materialization of what a ~20-line route table
expresses. Every copy is also a staleness boundary and an I/O bill (#4, #16,
#21, #22, #23, #56 are all this).

**R3. `outDir` is jointly owned and has no lifecycle.** It is simultaneously the
build workspace, the deliverable, and possibly a directory containing user
files — so it can never be safely cleaned, so it is never cleaned (#6, #9, #21),
so publish uploads history (#10, #53) and the fingerprint is permanently dirty
(#34).

**R4. `splitOutPath` conflates the artifact's destination with the build's
workspace.** The Save-folder spray (#7, #25, #34, #35, #52) is entirely this
conflation — and `BuildRunnerOptions` already has the decoupled shape
(`outDir` + `pdfFileOverride`); the viewer just derives one from the other.

**R5. Validation re-derives instead of consuming.** Every §6.1 finding is a
check reimplementing resolution the build already does, differently: wrong
frame (`local-refs`), regex CSS parsing (`missing-font-refs`), `resolve` vs
`join` (`validation-exec`), platform-divergent `nocase` (glob). A checker that
does not share the implementation it checks will always disagree with it.

### 9.3 The simplified design

The goal cases — themes, shared styles + book overrides, and free placement of
images/fonts — all fall out of two structural moves plus three small ones.

**1. One resolver: references → copy plan** (retires R1). The emitter and the
copier become the same pass. After rendering, walk `book.html`'s
`src`/`href`/`srcset` attributes and the active stylesheets' `url()`/`@import`
closure (the postcss infrastructure exists in `printsafe.ts`; `missing-font-refs`
is a broken regex re-implementation of exactly this walk). Copy precisely those
files. In-project references keep their relative paths unchanged. External
(`../`) files map **structure-preservingly** under a reserved prefix —
`../design-guide/styles/global.css` → `_up/design-guide/styles/global.css` — so
relative `url()` *within* a shared tree keeps resolving with **zero CSS
rewriting**; only the `<link href>` the emitter itself writes changes, and the
emitter owns that line. Unresolvable references fail the build loudly. The
invariant *referenced ⊆ copied* holds by construction, not by a check.

This deletes: basename flattening, `fallbackSrc`, collision detection,
`normalizeImageSrc` (vestigial anyway), and — as author-facing concepts —
flattening rules and the asset list itself. `source.assets` survives only as an
optional *additive* extras list for dynamically-referenced files, no longer
load-bearing, so the replace-vs-extend merge hazard stops mattering. And the
use cases resolve directly: themes ship because they are referenced; book
overrides work because structure-preserving mapping keeps intra-tree `url()`
valid (today's basename flattening *breaks* `url(../fonts/x)` across the
flattened boundary); "where do fonts go" becomes "wherever you referenced
them", deleting the three contradictory documentation answers (#27-docs).

**2. One static server with overlays; delete the stage** (retires R2).
Pagination serves `outDir` directly, with two overlay routes: an **in-memory**
patched `book.html` (`patchHtmlForPagedjs` is already a string transform wrapped
in file I/O) and `/vendor/paged.polyfill.js` from the embedded dir — exactly the
overlay pattern the preview server already uses. `stagePaginationInput`'s asset
copy disappears; the pdfx scratch `mkdtemp` remains for `raw.pdf`
intermediates only. The preview flips the same way: serve the **sources in
place** from `inputDir`, with the temp dir holding only generated `book.html`,
plus the same external-path mounts the resolver defines — so preview and build
resolve through one mapping *by construction*, closing the divergence class
(#19, #29, #37) at the root instead of detecting it. This deletes the
whole-tree preview copy, `mirrorChanges` and its no-unlink staleness (#21, #22),
the restart bleed (#23), the watcher/copier exclude mismatch (#56), roughly half
of preview startup I/O (#23-perf) — and stops serving `.env` (§9.1d), because a
route table serves what the resolver names, not whatever is on disk.

**3. `outDir` becomes fully owned** (retires R3): clean it on build, guarded —
refuse to clean a non-empty directory that lacks a print-md
`build-fingerprint.json`. The guard makes cleaning safe *and* is defense in
depth against workspace-conflation accidents.

**4. Viewer export: workspace ≠ save path** (retires R4). The controller passes
`outDir` = a temp workspace (or the project's own `dist`) and
`pdfFileOverride` = the chosen save path. One-file change in
`export/controller.ts`, zero lib changes — the highest value-per-line fix
available in either list.

**5. `finalizeStaticBook` strips the ephemeral origin** — string-replace
`http://127.0.0.1:<port>/` with `""` in the serialized HTML before writing.
~3 lines; the only fix for #5, which the original list omitted. Needed under
design 2 as well, since the origin stays ephemeral.

**Kept from the original list:** the `requestfailed`/`console` listener (still
the net for *remote*-font failures, which no copy plan can guarantee), the
scaffolded `.gitignore` (#33/#34), the chokidar ignore fix (match the
watch-root-relative path, not the absolute path — #4-critique), and the
percent-decode/comment-strip check repairs as interim patches until move 1
subsumes those checks entirely (the resolver *is* the missing-refs check, done
right, in one place).

**Dropped from the original list:** item 1 (a symptom detector; keep at most as
a transitional assert until move 1 lands), item 3 (half-measure, §9.1b),
item 6 (wrong direction, §9.1c).

### 9.4 Sequencing and net complexity

Cheap and independent first, structural second:

| Order | Move | Retires |
|---|---|---|
| 1 | Viewer workspace split (move 4) | #7, #25, #34, #35, #52 |
| 2 | Origin strip in `finalizeStaticBook` (move 5) | #5 |
| 3 | `.gitignore` scaffold + chokidar ignore fix | #33, #34, #20-critique |
| 4 | Server overlays, delete stage + preview mirror (move 2) | #4, #16-part, #21, #22, #23, #24, #56, §9.1d |
| 5 | Reference resolver (move 1) | §3.1 entire, themes ×4, #11, #13, #15-part, #44, #50, and the checks it subsumes (#36-41 largely) |
| 6 | Owned `outDir` with guarded clean (move 3) | #6, #9, #10-part, #21-rest, #53 |

Moves 1-2 are net *deletions*: they remove the flatten/fallback/collision half
of `assets.ts`, most of `build-staging.ts`, `mirrorChanges`, `normalizeImageSrc`,
and the regex half of `missing-font-refs`, while adding one resolver module and
one route table — implementations of things four subsystems currently
approximate independently and disagree about. That is the direction CLAUDE.md's
prime directive points: the robust pipeline here is the one with fewer moving
parts, not more checks watching the existing ones.
