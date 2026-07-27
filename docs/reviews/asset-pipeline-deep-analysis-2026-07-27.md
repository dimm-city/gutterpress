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
| 25 | **MEDIUM** | `document.fonts.ready` is awaited **once, before Paged.js runs** (`pagination.ts:215`), never after. Offline/CI: a remote `@import` fails DNS fast, `networkidle0` is satisfied, `fonts.ready` resolves with a `FontFace` in `status:"error"`, and the PDF silently uses a fallback. Chromium embeds whatever it *actually used*, so `pdf.print.embedded-fonts` validates clean on the substituted font. |
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

Items 1-3 all point the same direction: the reference emitter and the copier need
one shared source of truth about "what files does this book need", rather than a
hand-maintained directory list that authors are expected to keep in sync.
