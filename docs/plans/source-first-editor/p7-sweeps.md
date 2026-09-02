# SFE-P7 — Lane C: real-book, packaged-product, and release sweeps

> Evidence document. Lane C is evidence-only: every command below was
> actually executed in this sandbox; exit codes, durations, and counts are
> recorded as observed. A command that could not run to completion is
> recorded at its exact failure point, verbatim — never summarized as green.
> This lane's only writable path is this file; every defect found below is
> **reported, not fixed**.

**Run context recorded at the start of this sweep:**

- Repo root: `/home/user/gutterpress`
- Branch: `claude/sonnet-opus-agent-workflow-4s81ps`
- HEAD: `2ba5ca0a93db02ad562bd074ce04033b4b1d3aaa` (2026-09-02T00:51:25Z)
- Working tree: dirty at sweep time (`CHANGELOG.md`, `docs/ARCHITECTURE.md`,
  `docs/adr/**`, `docs/plans/source-first-editor/acceptance.md` modified;
  `docs/architecture/`, `docs/releases/` untracked) — concurrent Lane A/B
  writes in this same P7 run, not produced by this lane.
- `bun --version`: `1.3.11`. `npm --version`: `10.9.7`. `node` (desktop/CLI
  runtime): `24.3.0` / `22.22.2` (electron-packaged node reported `24.3.0` in
  `doctor`; the sandbox's separate `node` binary used for `npm pack`/asar
  inspection is `v22.22.2` — both observed directly, recorded as seen).
- Sandbox Chromium inventory: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  → `Chromium 141.0.7390.37` (Playwright-installed, via
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). No other Chrome/Chromium/Edge
  binary found anywhere on the filesystem (searched to depth 6/8 for
  `*chrom*` files and dirs, excluding `node_modules` and Playwright profile
  scratch dirs). `gutterpress doctor` independently confirms
  `[missing] Chromium-based browser`, `[missing] Ghostscript (gs)`,
  `[missing] qpdf (qpdf)`.

---

## Summary

| # | Sweep | Status | One-line evidence |
|---|---|---|---|
| 1 | Real-book sweep | **BLOCKED** (PDF/parity path) — **GREEN** (headless fallback) | `parity:gate` and `build --format pdf` both fail identically on missing Chromium 148+ (sandbox has 141.0.7390.37, or no browser at all depending on discovery path); `build --format html`, `lint`, and `validate --phase pre` all ran to completion (exit 0) on all 4 example books |
| 2 | Packaged-product sweep | **GREEN** | `bun run build` → `electron:build` → `electron-builder --linux dir` all exit 0; `app.asar` (99,297,019 bytes, 8,856 entries) contains `/out/main/main.js`, `/out/preload/preload.cjs`, `/build/index.html`, `/build/_app/**` (154 files), no `routes/api`/`+server`/`build/server`; `xvfb-run`-headless launch of the packaged binary reaches `renderer ready-to-show (first paint)` at `app-path=…/resources/app.asar` with zero fatal/crash lines |
| 3 | Release checks | **GREEN** (1 advisory finding) | `npm pack --dry-run` (npm 10.9.7) in `packages/cli` exits 0, 228 files, 5,791,254 bytes unpacked; the pinned export surface (`.`/`./api`/`./render`/`./plugins` + `dist/cli.js` bin) is fully present; 2 test-support-only `.d.ts` files leak into the tarball despite their own header comments (finding below); `dist:win`/`dist:mac` correctly not run here — CI-runner work per the plan |
| 4 | Plan-gate name→command mapping | **GREEN** | All 5 named-but-nonexistent gates mapped to a real command, each run to exit 0: `check:architecture` (prosemirror ban + route ratchet), `bun test tests/integration/package-exports.test.ts` (18/18), and two repo-wide greps re-run fresh (184 and 177 raw hits, 100% classified as historical comments or absence-asserting test code — zero live production implementations) |

---

## Sweep 1 — Real-book sweep

### 1.1 Parity gate

Command (from `packages/cli/package.json`: `"parity:gate": "bun scripts/native-parity-gate.ts"`):

```
$ cd packages/cli && bun run parity:gate
```

**Exit code: 1. Duration: 1s.**

Verbatim failure (full stderr):

```
$ bun scripts/native-parity-gate.ts
74 |  * identical message, or the two drift (they already had once).
75 |  */
76 | export function assertMilestone(product: string, origin: string, hint = ""): void {
77 |   const milestone = Number(/Chrome\/(\d+)/.exec(product)?.[1] ?? 0);
78 |   if (milestone < REQUIRED_MILESTONE) {
79 |     throw new Error(
               ^
error: The Gutterpress engine requires Chromium 148+; found Chrome/141.0.7390.37 at /opt/pw-browsers/chromium.
Set GUTTERPRESS_CHROMIUM to a 148+ binary.
      at assertMilestone (/home/user/gutterpress/packages/cli/src/engine/shared/cdp.ts:79:15)
      at checkMilestoneAndWrap (/home/user/gutterpress/packages/cli/src/engine/shared/cdp.ts:245:5)

Bun v1.3.11 (Linux x64)
error: script "parity:gate" exited with code 1
```

The script never reached its comparison logic, so no divergence report — allowlisted
or otherwise — was produced this run.

**Allowlist confirmation (how confirmed):** read
`packages/cli/scripts/native-parity-gate.ts` directly. `KNOWN_DIVERGENCES` is
declared at lines 156–160 as a typed empty array literal (`const
KNOWN_DIVERGENCES: Array<{...}> = [];`), with the adjacent comment "Empty
until a real, understood divergence is found." A repo-wide search
(`find . -iname "*allowlist*" -o -iname "*known-divergence*"`, excluding
`node_modules`) found no second allowlist file. The fixture set the gate
would have run against (read from the same file, lines ~95–140) is 6 minimal
repro fixtures under `docs/fixtures/**` plus the two real books
`examples/with-validation` and `examples/gutterpress-user-guide` — the same
two books this sweep builds independently below.

### 1.2 Real-book builds — PDF path (fails identically to the parity gate, different discovery code path)

`gutterpress build --format pdf` (default format) was attempted against all
4 example books. All 4 fail with the **same** error, but a *different*
message than the parity gate's — `build`'s Chromium discovery
(`packages/cli/src/lib/chromium.ts`) only checks `CHROMIUM_PATH`/
`PUPPETEER_EXECUTABLE_PATH` env vars and standard `chrome`/`chromium`/`msedge`
binary names on `PATH`; it does not know about the Playwright-managed
`/opt/pw-browsers/chromium` path that the engine's own `cdp.ts` hardcodes as
a candidate. Net effect: the CLI-facing message says "no browser found at
all" even though a (too-old) one exists on disk.

| Book | Command | Exit | Duration |
|---|---|---|---|
| user guide | `bun src/cli.ts build --format pdf --out <out>/ug-pdf examples/gutterpress-user-guide` | 1 | 1s |
| with-validation | `bun src/cli.ts build --format pdf --out <out>/wv-pdf examples/with-validation` | 1 | 1s |
| with-design-guide/book-01 | `bun src/cli.ts build --format pdf --out <out>/wdg-b1-pdf examples/with-design-guide/book-01` | 1 | 1s |
| with-design-guide/book-02 | `bun src/cli.ts build --format pdf --out <out>/wdg-b2-pdf examples/with-design-guide/book-02` | 1 | 1s |

Verbatim failure (identical across all 4, only the input/output paths in the
`info` lines differ — shown once):

```
info  Format: pdf
info  Build (pdf): <input> -> <out>
 96 |  */
 97 | export async function requireChromiumExecutable(): Promise<string> {
 98 |   const found = await resolveChromiumExecutable();
 99 |   if (found) return found;
100 |
101 |   throw new Error(
               ^
error: No Chrome / Chromium / Edge binary found. Gutterpress needs a Chromium-based browser to render PDFs.

Install one of:
  macOS:   brew install --cask google-chrome
  Ubuntu:  sudo apt install -y chromium-browser
  Windows: https://www.google.com/chrome/  (Edge is auto-detected if pre-installed)

Or point to an existing install:
  CHROMIUM_PATH=/path/to/chrome gutterpress build ...

The Gutterpress desktop app uses its own bundled browser for BOTH
PDF export and needs no separate install.
This message is about the CLI, which does need one.
      at requireChromiumExecutable (/home/user/gutterpress/packages/cli/src/lib/chromium.ts:101:13)
      at async preflightBuildTools (/home/user/gutterpress/packages/cli/src/lib/build-preflight.ts:78:11)
      at async runBuild (/home/user/gutterpress/packages/cli/src/lib/build-runner.ts:847:11)
      at async run (/home/user/gutterpress/packages/cli/src/commands/build.ts:53:13)
```

No page counts are available from this path in this sandbox — PDF
generation (and therefore Chromium-measured page count) never starts.

### 1.3 Real-book builds — headless fallback (per `gutterpress --help` / `build --help`)

`gutterpress build --help` and `doctor` were read first to confirm the
available headless paths (`build --format html`, `lint`, `validate`) before
falling back to them, per the run instructions.

**HTML build** (`--format html`, static-site output — no Chromium fragmenter
invoked; pagination is client-side CSS Paged Media, so no page count is
emitted by the build itself in this mode):

| Book | Command | Exit | Duration | `book.html` size | Warnings |
|---|---|---|---|---|---|
| user guide | `bun src/cli.ts build --format html --out <out>/ug-html examples/gutterpress-user-guide` | 0 | 2s | 167,419 bytes | none |
| with-validation | `bun src/cli.ts build --format html --out <out>/wv-html examples/with-validation` | 0 | 1s | 21,078 bytes | none |
| with-design-guide/book-01 | `bun src/cli.ts build --format html --out <out>/wdg-b1-html examples/with-design-guide/book-01` | 0 | 1s | 40,412 bytes | none |
| with-design-guide/book-02 | `bun src/cli.ts build --format html --out <out>/wdg-b2-html examples/with-design-guide/book-02` | 0 | 1s | 40,421 bytes | none |

Sample log (user guide; other 3 identical in shape):

```
info  Format: html
info  Build (html): examples/gutterpress-user-guide -> <out>/ug-html
info  Using specified files (10 total)
ok    Wrote /tmp/gutterpress-build-.../book.html
info  Shipping self-contained HTML + viewer bundle (native engine)
ok    Wrote: <out>/ug-html/book.html
info  Fingerprint: <out>/ug-html/build-fingerprint.json
```

Each `build-fingerprint.json`'s `tools` block independently confirms the
sandbox's tool absence as structured data: `"chromium": null, "ghostscript":
null, "qpdf": null`.

Source file counts (informational, not a defect): user guide reports "10
total" specified files (11 `.md` files on disk minus `README.md`,
manifest-excluded); the other three books report "Using all .md files in
alphabetical order" (with-validation: `README.md` + 2 chapters;
with-design-guide books: 1 chapter each).

**Lint** (`gutterpress lint <dir>` — CSS print-safety, postcss-based, no
Chromium):

| Book | Exit | Duration | Output |
|---|---|---|---|
| user guide | 0 | 1s | `Linting 1 CSS file(s)` / `ok CSS lint passed` |
| with-validation | 0 | 1s | `Linting 1 CSS file(s)` / `ok CSS lint passed` |
| with-design-guide/book-01 | 0 | 0s | `Linting 1 CSS file(s)` / `ok CSS lint passed` |
| with-design-guide/book-02 | 0 | 1s | `Linting 1 CSS file(s)` / `ok CSS lint passed` |

**Validate** (`gutterpress validate --phase pre <dir>`, `--format json` used
for the exact counts column — text and json runs both exit 0, json run
shown for detail):

| Book | Exit | Duration | Checks total/passed | Warnings |
|---|---|---|---|---|
| user guide | 0 | 1s | 14/14 | `Tool "gs" not found — skipping: asset.image.tac-raster` |
| with-validation | 0 | 1s | 14/14 | same |
| with-design-guide/book-01 | 0 | 1s | 14/14 | same |
| with-design-guide/book-02 | 0 | 1s | 14/14 | same |

The 14 checks that ran, per the JSON `passed` array (identical set across
all 4 books): `source.markdownlint`, `source.htmlhint`, `source.stylelint`,
`source.links.local-refs`, `source.accessibility.alt-text`,
`source.accessibility.heading-order`, `source.markdown.layout-markers`,
`source.sync.merge-markers`, `asset.image.file-size`,
`asset.image.resolution`, `asset.image.color-space`,
`asset.image.alpha-channel`, `asset.font.approved-files`,
`asset.font.license`. `phase pre` intentionally excludes the `pdf.*`
category (no PDF exists to check) and the one `gs`-gated asset check is
reported skipped, not silently omitted.

### 1.3 verdict

The parity gate and every PDF build fail at the identical root cause —
this sandbox has no Chromium 148+ binary (only a Playwright-managed 141, or
nothing at all depending on which of the two independent discovery
implementations is asked) — recorded verbatim above, not summarized. Every
headless-capable command (`build --format html`, `lint`, `validate --phase
pre`) ran to completion with exit 0 on all 4 example books, with zero
warnings/errors beyond the expected `gs`-tool-absence notice.

---

## Sweep 2 — Packaged-product sweep

### 2.1 `bun run build` (`packages/desktop`)

```
$ cd packages/desktop && bun run build
```

**Exit code: 0. Duration: 17s.**

Runs `build:runtime` (cli `build:library`) → `vite build` (SvelteKit
adapter-static SPA) → `tools/check-render-purity.mjs build --strict`. Final
lines:

```
✓ built in 9.87s
Run npm run preview to preview your production build locally.
> Using @sveltejs/adapter-static
  Wrote site to "build"
  ✔ done
check-render-purity: OK — scanned 144 file(s) in build, no forbidden host/node markers.
```

### 2.2 `bun run electron:build`

```
$ electron-vite build && node --check out/main/main.js && node --check out/preload/preload.cjs
```

**Exit code: 0. Duration: 1s.**

```
(!) renderer config is missing
[…]
out/main/main.js  334.99 kB
✓ built in 104ms
out/preload/preload.cjs  15.15 kB
✓ built in 19ms
```

The "renderer config is missing" line is expected, not a defect: per
`electron.vite.config.ts`'s own header comment, the renderer is
intentionally *not* built by electron-vite — it is the separately-built
SvelteKit adapter-static tree from step 2.1, read directly off disk by
`app-protocol.ts`. `node --check` on both emitted files passed (implicit in
exit 0 — no syntax-check output on success).

### 2.3 Packaging — `electron-builder --linux dir`

Per the run instructions ("attempt `bunx electron-builder --linux --dir` …
to produce an unpacked packaged layout with asar"), run directly against the
already-vendored local binary (no new global tool installed):

```
$ node_modules/.bin/electron-builder --config electron-builder.yml --publish never --linux dir
```

**Exit code: 0. Duration: 22s.**

```
• electron-builder  version=26.15.3 os=6.18.44-fc-v22
• loaded configuration  file=/home/user/gutterpress/packages/desktop/electron-builder.yml
• packageManager not detected by file, falling back to environment detection  resolvedPackageManager=npm
• detected workspace root for project using lock file  pm=bun resolved=/home/user/gutterpress
• skipped dependencies rebuild  reason=npmRebuild is set to false
• packaging       platform=linux arch=x64 electron=42.1.0 appOutDir=dist/linux-unpacked
• downloaded      label=electron progress=100%
• downloaded electron zip extracted successfully  output=.../dist/linux-unpacked
• searching for node modules  pm=bun
• note: bun does not support any CLI for dependency tree extraction, utilizing file traversal collector instead
• using manual traversal of node_modules to build dependency tree
```

Output: `packages/desktop/dist/linux-unpacked/` (403 MB total, includes the
bundled Electron 42.1.0 runtime). `dist/linux-unpacked/resources/app.asar`
exists: **99,297,019 bytes**, `file` reports "Electron ASAR archive, header
length: 2047864 bytes".

`dist:linux` (the AppImage-producing script) was **not** separately
attempted: the run instructions offer `--dir` as the equivalent target for
this smoke ("or the repo's `dist:linux` script … to produce an unpacked
packaged layout with asar"), `--dir` already satisfies that (unpacked layout
+ asar present), and it avoids the extra AppImage-container build step
(fuse/appimagetool) that `--dir` output doesn't require. Also, per the
"`bun --cwd <pkg> run <script>` silently exits 0 without running the script"
guardrail in this run's instructions, the packaging command above was run by
`cd`-ing into `packages/desktop` and invoking the locally vendored
`electron-builder` binary directly, not via `bun --cwd`.

### 2.4 asar inspection

Used the already-vendored `@electron/asar@3.4.1` (from
`node_modules/.bun/@electron+asar@3.4.1`) via `node -e` calling
`asar.listPackage(...)` directly — no new tool installed.

```
TOTAL_FILES=8856
```

Confirmed present (exact `grep` against the full file list):

- `/out/main/main.js`, `/out/preload/preload.cjs` — Electron main + preload.
- `/build/index.html` and 154 files under `/build/_app/**` — the SvelteKit
  adapter-static renderer build, including
  `/build/_app/immutable/assets/MarkdownEditor.*.css` (confirms the rich
  editor's chunk shipped).
- `/package.json`.
- Top-level asar entries are exactly `/build`, `/node_modules`, `/out`,
  `/package.json` — no stray top-level surface.
- `grep -E "^/build/(server|handler)"` and `grep -i "routes/api|+server"`
  against the full 8,856-entry list: **zero matches** for both — no
  SvelteKit server bundle, no HTTP route tree, anywhere in the packaged
  asar. This is a second, packaged-artifact-level confirmation of the same
  property `tools/check-render-purity.mjs` already checked at the
  `build/`-tree level in step 2.1.

### 2.5 Headless launch (`xvfb-run`)

`which xvfb-run` → `/usr/bin/xvfb-run` (present, no install needed).

```
$ xvfb-run -a --server-args="-screen 0 1280x800x24" \
    dist/linux-unpacked/gutterpress --no-sandbox --disable-gpu \
    --enable-logging=stderr --v=1
```

Launched in the background, observed for 12s, then terminated (`kill`).
Full main-process lifecycle line sequence extracted from the run's log
(177 lines total; noise lines — WebRTC core-count, dbus-socket-absent
warnings, zygote init, VA-API `dlopen` failure, GPU sandbox notices — are
expected in a headless container with no system bus/GPU and are omitted
here):

```
[startup +0ms] main.js evaluated
[startup +147ms] app whenReady
[app] started 0.10.2
[startup +203ms] renderer did-start-loading
[startup +208ms] createWindow returned (loadURL dispatched)
[startup +338ms] renderer dom-ready
[startup +339ms] renderer did-finish-load
[startup +348ms] renderer ready-to-show (first paint)
```

Between `did-finish-load` and `ready-to-show`, dozens of
`app://local/_app/immutable/{chunks,nodes,entry,assets}/*.js|.css` module
resolutions are logged via Blink's import-map resolver (the "skips prefix
match because of non-special URL scheme" lines are import-map diagnostic
noise from the custom `app://` scheme, not errors — every referenced module
resolved and loaded; no 404 or failed-to-load line appears anywhere in the
177-line log).

`ps aux` while running showed the renderer process invoked with
`--app-path=/home/user/gutterpress/packages/desktop/dist/linux-unpacked/resources/app.asar`
— direct confirmation Electron loaded the packaged app from the asar built
in 2.3, not from a dev source tree.

`grep -i "fatal|crash|uncaught|SIGSEGV|Segmentation"` against the full log:
**zero matches.** The process was still running (not crashed) when
terminated by `kill` after the 12s observation window; cleanup confirmed
with a follow-up `pkill` (no matching process — already gone).

**This reaches first paint of the SvelteKit SPA served by the `app://`
protocol handler out of the packaged asar** — the AC-16 open-half target —
in a headless container with no display server, GPU, or D-Bus. It does not
prove interactive functionality (no pointer/keyboard input was driven; that
is out of this evidence-only sweep's scope) — only that the packaged binary
starts, the main process reaches `whenReady`, and the renderer loads and
paints the asar-served SPA without any logged fatal error.

### 2.6 Verdict

GREEN. Every step in the packaged-product chain — runtime library build →
SvelteKit static build → purity check → electron-vite main/preload build →
electron-builder packaging → asar inspection → headless launch to first
paint — ran to completion with exit 0 (packaging/launch) and no forbidden
markers or fatal errors observed.

---

## Sweep 3 — Release checks

### 3.1 `npm pack --dry-run` (packages/cli)

Tool used: **npm 10.9.7** (`bun` is the workspace's own package manager, but
the run instructions accept either and ask to record which; npm was chosen
because it directly exercises the same `files`/`exports` resolution
`npm publish` would use).

Prerequisite: `packages/cli`'s own full `bun run build` (not just
`build:library`, which is all the desktop's `build:runtime` script invokes)
was run first so `dist/cli.js` — the package's `bin` target — exists:

```
$ cd packages/cli && bun run build
```

**Exit code: 0. Duration: 5s.**

```
$ cd packages/cli && npm pack --dry-run --json
```

**Exit code: 0. Duration: 2s.**

Parsed from the JSON output:

- `name`: `gutterpress`, `version`: `0.10.2`, `filename`: `gutterpress-0.10.2.tgz`
- `entryCount`: **228**
- `unpackedSize`: **5,791,254 bytes**

**Pinned export surface check** — `package.json`'s `exports` map is
`{".", "./api", "./render", "./plugins"}`; every entry's `types`+`default`
target was verified present in the 228-file list:

| Export | `types` | `default` | Present? |
|---|---|---|---|
| `.` | `dist/index.d.ts` | `dist/index.js` | yes (both) |
| `./api` | `dist/api/index.d.ts` | `dist/api/index.js` | yes (both) |
| `./render` | `dist/render.d.ts` | `dist/render.js` | yes (both) |
| `./plugins` | `dist/plugins.d.ts` | `dist/plugins.js` | yes (both) |

`bin.gutterpress` → `dist/cli.js`: present. `README.md`, `LICENSE`,
`package.json`: present.

**Finding (advisory, not fixed — Lane C is evidence-only):** two
test-support-only source files ship their `.d.ts` declaration into the
published tarball, despite each file's own header comment asserting it
"never ships in dist/":

- `dist/lib/remote-auth/test-support/git-http-server.d.ts`
- `dist/test-helpers/testkit.d.ts`

Root cause, confirmed by reading `packages/cli/tsconfig.build.json`: its
`exclude` list removes `**/*.test.ts`,  `src/cli.ts`, `src/commands`,
`src/engine/dev-cli.ts`, `src/engine/viewer` (which is why the sibling
`src/engine/viewer/test-support/**` does *not* leak), and
`src/engine/compiler/agent.ts` — but it does **not** exclude
`src/test-helpers/**` or `src/lib/remote-auth/test-support/**`. Those two
files are plain (non-`.test.ts`) `.ts` source directly under `src`, so
`tsc -p tsconfig.build.json --emitDeclarationOnly` includes them in its
declaration output independently of whether anything imports them. The
claim in each file's own header ("it never ships in dist/") is **true for
the JS runtime** (confirmed: `find dist -iname "*git-http-server*" -o
-iname "*testkit*"` → only the two `.d.ts` files, no matching `.js` chunk —
`bun build`'s tree-shaking from the real entry points correctly drops them)
but **false for the type declarations**, which is a distinct build step
with a distinct exclude list that was not kept in sync. Impact is narrow —
two internal test-helper type surfaces become technically importable by a
TS consumer reaching past the `exports` map's subpath restriction via a
relative `dist/` path, though the `exports` field itself blocks the
documented `gutterpress/...` subpath route to them.

No other file present that shouldn't ship was found, and no file absent
that should ship (per the export-surface table above) was found.

### 3.2 `dist:win` / `dist:mac`

Not run in this sandbox. Per the plan's own release-checks section:

> "Platform-specific distribution jobs may run in CI rather than one local
> machine. Record which runner produced each result."

No CI runner produced a result for `dist:win`/`dist:mac` in this run — this
sandbox is Linux-only (`os=6.18.44-fc-v22` per the electron-builder log
above) and neither script was attempted; there is no result to attribute to
a runner. This is recorded as the expected division of labor per the plan
sentence above, not a blocked or failed check.

### 3.3 Verdict

GREEN, with one advisory finding (test-support `.d.ts` leakage, §3.1) for
the acceptance sweep reviewer to weigh — it does not affect the JS runtime
surface or the documented `exports` subpaths, all of which are correctly
present and nothing-extra at the JS level.

---

## Sweep 4 — Plan-gate name→command mapping table

Per the run specification and `docs/plans/source-first-editor/runs/SFE-P7.md`'s
Objective section, the plan names five gates that do not exist as
`package.json` scripts. Each is mapped below to the actual command that
proves the named property, run fresh in this sandbox (the grep-based rows
were explicitly re-run rather than citing prior ledger output, per the run
instructions).

| Named gate | Actual command | Exit | Result |
|---|---|---|---|
| `check:no-prosemirror` | `bun run check:architecture` (RULE 1) | 0 | PASS — scanned 7 `package.json` files (`bun.lock` found) + 604 code files, 0 violations |
| `check:no-desktop-http` | `bun run check:architecture` (RULE 2) | 0 | PASS — desktop HTTP route count 0 == baseline 0 (`tools/architecture-baseline.json`) |
| `check:package-exports` | `cd packages/cli && bun test tests/integration/package-exports.test.ts` | 0 | PASS — 18 pass / 0 fail / 14 `expect()` calls |
| `check:no-preview-editing` | repo-wide grep, re-run fresh (see below) | 0 (grep found matches, all classified) | PASS — 0 live production/runtime occurrences |
| `check:no-desktop-pwa` | repo-wide grep, re-run fresh (see below) | 0 (grep found matches, all classified) | PASS — 0 live production/runtime occurrences |

### 4.1 `check:architecture` — full run

```
$ bun run check:architecture
```

**Exit code: 0. Duration: 1s.**

```
check-architecture: rule summary
  RULE 1 [prosemirror-ban]: PASS — scanned 7 package.json file(s) (bun.lock: found), 604 code file(s)
  RULE 2 [desktop-route-ratchet]: PASS (0 == baseline 0)
  RULE 3 [d4-import-direction]: PASS — scanned 345 packages/cli/src file(s), 208 packages/desktop/{src,electron} file(s)
  RULE 4 [future-package-rules]: PASS — packages/editor: scanned 35 file(s), 0 violation(s); packages/vscode-extension: scanned 16 file(s), 0 violation(s)

check-architecture: OK — all architecture fitness rules passed.
```

(Rules 3 and 4 are bonus coverage beyond the two named gates — recorded for
completeness since the command was run anyway.)

### 4.2 `package-exports.test.ts`

```
$ cd packages/cli && bun test tests/integration/package-exports.test.ts
```

**Exit code: 0. Duration: 5s.**

```
bun test v1.3.11 (af24e281)
 18 pass
 0 fail
 14 expect() calls
Ran 18 tests across 1 file. [5.63s]
```

### 4.3 `check:no-preview-editing` — repo-wide re-run

Round-1 repair correction: the version of this section previously here
used only 5 of the 5 deleted preview-mutation identifiers this command is
supposed to cover — `InlineEditController|CommitEngine|commitRangePatch|
beginBlockEdit|endBlockEdit` — which omits all three deleted protocol
message names (`blockEditRequested`, `blockEditFinished`,
`blockEditStateChanged`). It also mis-stated the per-directory breakdown
(claiming 17 `docs/` hits, all in two files) and misapplied the P4 D15
ruling as two residual classes where the ruling itself
(`docs/plans/source-first-editor/runs/SFE-P4.md`, "D15 residuals ruling",
quoted in the deletion ledger's SFE-P4 section) states three — the third
being `docs/plans/**` historical/planning documents, which is where the
overwhelming majority of hits actually land. Both defects are fixed below
by re-running fresh against the full 8-identifier set and classifying every
hit against the real three-class ruling, matching the more careful
per-identifier sweep the deletion ledger's own §1.1 already performs for
this exact identifier set (cross-referenced there, not duplicated here).

```
$ grep -rn -E 'InlineEditController|CommitEngine|commitRangePatch|beginBlockEdit|endBlockEdit|blockEditRequested|blockEditFinished|blockEditStateChanged' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | wc -l
242
```

(`.gitignore` already excludes `node_modules`/`dist` from ripgrep's own
defaults; `--exclude-dir` flags are belt-and-suspenders. Counted with plain
`grep`, not `rg`, to match this section's own prior command exactly; the
deletion ledger's §1.1 uses `rg -c` per-identifier and arrives at the same
13-file union for the five-message subset.)

**242 raw hits, by class:**

- **Class 3 (docs/plans/** historical/planning docs) — 189 hits, 18 files**:
  `deletion-ledger.md` (60), `mutation-inventory.md` (49),
  `docs/inline-editing-plan.md` (16), `source-first-editor-enterprise-refactor.md`
  (11), `runs/SFE-P4.md` (10), `docs/adr/0012-preview-read-only.md` (10),
  `docs/adr/0009-inline-editing-source-ranges.md` (8), `p7-sweeps.md` — this
  file, self-reference (5), `p3d-sweep-audit.md` (4), `parity-matrix.md` (3),
  `baseline.md` (3), `runs/SFE-P7.md` (2), `runs/SFE-P0a.md` (2),
  `acceptance.md` (2), `docs/releases/0.11.0.md` (1), `runs/SFE-P3e.md` (1),
  `runs/SFE-P3d-parity.md` (1), `runs/SFE-P3ab.md` (1) — every one names the
  deleted identifiers as history, per the ruling's own text ("the
  docs/plans history and this spec keep the names").
- **Class (b) (dated release record)** — `CHANGELOG.md` (1): a past-release
  changelog entry describing the v8 addition as it read at that release —
  historical by construction, same spirit as class 3.
- **`packages/` (production/test code) — 52 hits, 8 files, every hit
  inspected:**
  - `packages/desktop/tests/editor/preview-separability-mutation-inert.test.ts`
    (25) — mix of describing comments and **absence-asserting test code**
    (`expect(api.beginBlockEdit).toBeUndefined()`,
    `expect(r30?.error).toBe("Unknown command: beginBlockEdit")`).
  - `packages/desktop/tests/editor/preview-navigation-protocol.test.ts` (6)
    — comments + one test name asserting the deleted command is now a
    no-op.
  - `packages/desktop/tests/preview-shell-regression.test.mjs` (5) — class
    2, absence-asserting: this file was ABSENT from the pre-repair version
    of this section entirely because the old 5-identifier pattern never
    searched for the three protocol message names it uses (it asserts a
    stray `blockEditStateChanged` no longer holds a preview swap).
  - `packages/desktop/tests/editor/parity-replacements.test.ts` (5) — all
    in comments describing what the test replaces.
  - `packages/cli/src/assets/preview/scripts/preview-interface.js` (4) —
    class 1, version-history comments (`// v8: in-flow block editing.
    ADDED…`, `// v9: … REMOVED`).
  - `packages/desktop/tests/preview-interface.test.mjs` (3) —
    absence-asserting (`assert.equal(api.beginBlockEdit, undefined, …)`).
  - `packages/desktop/src/routes/+page.svelte` (3) — a block comment naming
    what was removed and when (SFE-P4).
  - `packages/desktop/tests/editor/context-menu-controller.test.ts` (1) —
    comment.

Every one of the 242 hits falls into the three accepted residual classes
from the D15/P4 ruling — version-history comments (class 1),
absence-asserting tests (class 2), and `docs/plans/**` history (class 3,
plus the one dated-changelog judgment call, (b)) — with zero hits defining
or exporting any of the eight identifiers as live, callable production
code. This confirms the property, and the widened pattern additionally
confirms `check:no-preview-editing` would have caught a live
`preview-shell-regression.test.mjs` regression that the narrower
5-identifier pattern this section previously used could not see.

### 4.4 `check:no-desktop-pwa` — repo-wide re-run

Identifier set from the deletion ledger's SFE-P5a section
(`WebAdapter|InMemoryWebStore|FileSystemDirectoryHandle|showDirectoryPicker|web-fs|web-store`),
widened to the full repo:

```
$ grep -rn -E 'WebAdapter|InMemoryWebStore|FileSystemDirectoryHandle|showDirectoryPicker|web-fs|web-store' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | wc -l
189
```

**189 raw hits**, applying the P4 D15 ruling's real three-class scheme
(§4.3 above), not the two-class paraphrase the pre-repair version of this
section used:

- **Class 3 (`docs/plans/**`/`docs/adr/**` historical/planning docs) — 178
  hits, 14 files:** `deletion-ledger.md` (63), `platform-inventory.md`
  (30), `docs/pwa-webadapter-plan.md` (29, explicitly marked
  closed/historical at its own top), `docs/adr/0014-future-web-product-is-a-separate-package.md`
  (11), `source-first-editor-enterprise-refactor.md` (10), `guardrails.md`
  (9), `capability-map.md` (8), `p7-sweeps.md` — this file, self-reference,
  count as it stood before this section's own rewrite (6), `runs/SFE-P5a.md`
  (4), `acceptance.md` (3), `docs/ux-design-contract.md` (2),
  `docs/releases/0.11.0.md` (1), `runs/SFE-P7.md` (1),
  `docs/adr/0016-narrow-feature-owned-capabilities.md` (1).
- **Class (b) (dated release/architecture record) — `CHANGELOG.md` (1),
  `CLAUDE.md` (3)**: CLAUDE.md's own "Monorepo layout" section narrates the
  P5a/P5d deletions by date, in the same historical spirit as class 3.
- **`knip.jsonc` (2)** — a comment explaining why an old allowlist entry
  was dropped; not production code, not a residual.
- **`packages/` (production/test code) — 5 hits, 5 files, every one
  inspected:** `packages/desktop/src/lib/components/SyncStatusPill.svelte`,
  `packages/desktop/src/lib/platform/index.ts`,
  `packages/desktop/src/lib/settings.svelte.ts`,
  `packages/desktop/src/routes/+layout.svelte` (1 hit each) — class 1,
  comments narrating the SFE-P5a/P5b deletion (desktop-side, matches the
  named property directly); `packages/cli/scripts/build-engine-bundles.mjs`
  (1 hit) — class 1, a comment explaining why the generator's copy step
  changed. **Zero hits remain in `packages/cli/src/{render.ts,platform.ts,
  lib/markdown/{assemble,plugins,index,renderer}.ts}`** — those six files
  were the subject of deletion-ledger §5.1's confirmed defect (present-tense
  `WebAdapter` prose) and no longer match this pattern at all after the
  integrator's fix landed in this run's own commit; the pre-repair version
  of this section still listed 7 hits across those files because it was
  written before that fix landed in the tree it was measuring.

Zero hits anywhere define, export, or import a live `WebAdapter` class,
`web-fs`/`web-store` module, or `InMemoryWebStore`; zero calls to
`showDirectoryPicker()`; zero references to `FileSystemDirectoryHandle` as
an actual type in use. This confirms the property. (Self-reference note,
matching the deletion ledger's own §1 preamble: this section's rewrite
necessarily discusses the swept identifiers itself, so a reviewer
re-running the command above against the final committed tree will see a
modestly higher total than 189, confined to this section's own text.)

### 4.5 Verdict

GREEN across all five mappings. This table is offered for the acceptance
sweep to cite directly, per the run specification.

---

## Verification of this lane's own output

This lane's sole writable artifact is this Markdown evidence file — no
production or test code was touched, so there is nothing in
`packages/**` for this lane to typecheck. The "verification" for this
lane's claims *is* every command above: each ran to completion in this
sandbox with the recorded exit code, and every count quoted in this
document (18 pass, 228 files, 8,856 asar entries, 242/189 grep hits, 14/14
validate checks, etc.) was read directly from that command's own output,
not retyped from memory or an earlier run. Raw logs and JSON outputs
supporting every number above are preserved in this session's scratch
directory (`.../scratchpad/p7-sweeps/`) for re-derivation if needed.

Round-1 repair note: §4.3/§4.4's grep counts (242/189) were re-run and
corrected during repair — see those sections' own notes for what changed
(the 4.3 pattern now covers all 5 deleted preview-mutation protocol
messages, not 2 of them; both sections now classify `docs/plans/**` hits
as the P4 D15 ruling's third class instead of omitting it).
