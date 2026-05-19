# System Dependencies

print-md generates PDFs by orchestrating real system tools — a Chromium browser, Ghostscript, qpdf, Poppler, ImageMagick. Most of them are optional and degrade gracefully; a couple are required for specific features. This page documents exactly what each user-visible feature needs, how the lib detects them, and how to install them on each OS.

## Quick reference

| Feature | Required tools | Optional tools (graceful skip) |
|---|---|---|
| **Viewer — Open Folder / Preview** | None | None |
| **Viewer — Save PDF** (format=pdf) | Chrome or Chromium | Ghostscript (`gs`) — for `/Creator` metadata stamp; without it the PDF saves anyway with a warning in the log |
| **CLI — `print-md build --format html`** | None | None |
| **CLI — `print-md build --format pdf`** | Chrome or Chromium | Ghostscript (`gs`) — same as viewer Save PDF |
| **CLI — `print-md build --format pdfx`** | Chrome or Chromium, Ghostscript (`gs`), `qpdf` (if `stripAnnotations: true`, default) | — |
| **CLI — `print-md preview`** | None | None |
| **CLI — `print-md lint`** | None | None (stylelint is bundled as an npm dep) |
| **CLI — `print-md validate` (pre-build)** | None | `markdownlint-cli2`, `htmlhint`, ImageMagick `identify` — each enables specific checks |
| **CLI — `print-md validate` (post-build)** | None | `qpdf`, `pdfinfo`, `pdffonts`, `pdfimages`, `pdftotext`, `gs`, ImageMagick `identify`, `grep` — each enables specific checks |

Pure-JS components (markdown rendering, Paged.js layout, stylelint, file watching, preview HTTP server, viewer SPA) need nothing beyond the bundled binary or the installed npm package.

## Per-platform install

### Windows

The viewer ships as a self-contained zip — Electron + the lib are bundled. You still need:

1. **A Chromium-based browser** for Save PDF. Currently auto-detected:
   - Google Chrome installed to `C:\Program Files\Google\Chrome\` or `%LOCALAPPDATA%\Google\Chrome\`

   Not yet auto-detected (set `CHROMIUM_PATH` to use):
   - Microsoft Edge: `set CHROMIUM_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
   - Brave, Vivaldi, Arc, custom installs

2. **Ghostscript** (optional, recommended) — silences the warning during Save PDF and required for PDF/X:
   - Installer: https://www.ghostscript.com/releases/gsdnld.html → "AGPL Release"
   - Or via Chocolatey: `choco install ghostscript`
   - Or via Scoop: `scoop install ghostscript`

3. **qpdf** — only if you build PDF/X format with annotation stripping:
   - https://github.com/qpdf/qpdf/releases (Windows MSI)
   - Or: `choco install qpdf`

4. **Poppler / ImageMagick** — only needed for validation checks (`print-md validate`). The viewer skips validation by default; the CLI lets you opt in. If you don't run validation, skip these.
   - Poppler: https://github.com/oschwartz10612/poppler-windows/releases (extract, add `bin\` to PATH)
   - ImageMagick: https://imagemagick.org/script/download.php#windows

### macOS

```sh
# Required for Save PDF
brew install --cask google-chrome     # or use existing Chrome / Chromium / Edge

# Recommended (silences /Creator stamp warning; needed for PDF/X)
brew install ghostscript

# Only if you build PDF/X with stripAnnotations
brew install qpdf

# Only if you run validation
brew install poppler imagemagick
```

### Linux (Debian/Ubuntu)

```sh
# Required for Save PDF (any one of these works)
sudo apt install -y chromium-browser
# or
sudo apt install -y google-chrome-stable

# Recommended
sudo apt install -y ghostscript

# Only if you build PDF/X with stripAnnotations
sudo apt install -y qpdf

# Only if you run validation
sudo apt install -y poppler-utils imagemagick
```

### Linux (Fedora/RHEL)

```sh
sudo dnf install -y chromium ghostscript qpdf poppler-utils ImageMagick
```

## Tool details

### Chrome / Chromium (REQUIRED for PDF)

print-md uses `puppeteer-core` to drive a headless Chromium for the actual HTML→PDF render. **`puppeteer-core` does NOT download Chromium** — you must have one installed.

**Resolution order** (`packages/lib/src/lib/chromium.ts`):

1. `CHROMIUM_PATH` env var
2. `PUPPETEER_EXECUTABLE_PATH` env var
3. Linux: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/snap/bin/chromium`
4. macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Chromium.app/Contents/MacOS/Chromium`, `/opt/homebrew/bin/chromium`
5. Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`

**Failure mode** if not found: a `BuildError` with install instructions; the viewer surfaces this as a toast and the build aborts before Chromium runs.

**Workaround for Edge / non-default install location** — set `CHROMIUM_PATH` in your shell environment (CLI) or via a per-project manifest (not yet implemented; track this gap).

> The viewer's own Chromium (Electron's bundled renderer) is NOT reusable for puppeteer — different process model, different DevTools surface. The lib needs an independent Chrome installation.

### Ghostscript (`gs`) — best-effort for PDF, required for PDF/X

Three roles in the lib:

1. **`stampCreator`** (`packages/lib/src/lib/ghostscript.ts`) — writes `/Creator (print-md)` into PDF DOCINFO. Cosmetic metadata. **As of 0.1.x, this is now best-effort: a missing `gs` produces a warning in the log and the PDF saves anyway.** The user's PDF is fine.

2. **`convertToPdfxCmyk`** — converts RGB PDF to CMYK PDF/X for offset print. Only runs when `--format pdfx`. Hard failure if `gs` missing.

3. **`stripAnnotations`** — strips form-field annotations for PDF/X compliance. Conditional on `pdfx.stripAnnotations` (default true). Hard failure if `gs` missing.

Two validation checks (`pdf.print.ink-coverage`, `asset.image-tac`) also call `gs`; both gracefully skip if missing.

### qpdf — PDF/X only, otherwise validation-only

- `stripAnnotations` (PDF/X build): `qpdf input output --flatten-annotations=all`
- Eight validate checks: `pdf.structure.qpdf`, `pdf.bookmarks`, `pdf.cross-refs`, `pdf.page-labels`, `pdf.pdfx-markers`, `pdf.pdfx-metadata`, `pdf.toc-links`, `heuristic.placement-variance`

All checks gracefully skip if missing.

### Poppler tools (`pdfinfo`, `pdffonts`, `pdfimages`, `pdftotext`) — validation only

Used by post-build PDF checks for page geometry, font embedding, image resolution/depth, and rasterization detection. Every check gracefully skips if its tool is missing.

### ImageMagick `identify` — validation only

Used by pre-build asset checks for image color space, alpha channel, and DPI. Gracefully skips if missing.

### `markdownlint-cli2`, `htmlhint` — validation only

Pre-build source linting. Gracefully skip if missing.

### `stylelint` — bundled

Lives in `packages/lib/package.json#dependencies`. Always available; no install required. Runs on every viewer Save PDF and every CLI build unless `--skip-lint` (CLI) or the manifest disables it.

### `which` — Windows gotcha

The graceful-degradation gate (`packages/lib/src/checks/tool-check.ts`) uses `which <tool>` to detect availability before running each check. **`which` is not on stock Windows**, so on a fresh Windows install the validation pipeline silently skips every tool-backed check — even tools that ARE installed. Workarounds:

- Use Git Bash (ships `which`) for CLI invocations on Windows
- Install `which` via Chocolatey: `choco install which`
- Run validate from WSL

The viewer doesn't run validation by default, so this affects CLI users only.

### `git` — fingerprint metadata

`packages/lib/src/lib/build-fingerprint.ts` calls `git rev-parse` / `git status` to embed repo state in `build-fingerprint.json` next to the output PDF. Failure is silent — the fingerprint just omits the git block.

## Configuration

### Environment variables

| Variable | Purpose |
|---|---|
| `CHROMIUM_PATH` | Override Chrome/Chromium executable path (print-md primary) |
| `PUPPETEER_EXECUTABLE_PATH` | Same, but the puppeteer-standard env var (also honored) |
| `PUPPETEER_SKIP_DOWNLOAD` | Tells `puppeteer` (not `puppeteer-core`) to skip download. We use `puppeteer-core` which never downloads anyway. Set in CI for belt-and-suspenders. |

### Manifest

No external-tool paths are configurable in `manifest.yaml` yet. This is a gap — track in https://github.com/dimm-city/print-md/issues for a `chromium.executable` field.

## Troubleshooting

### `spawn gs ENOENT`

Ghostscript not on PATH. As of 0.1.x, `stampCreator` is best-effort — you should NOT see this for plain `--format pdf` anymore (you'll see a log warning instead). If you DO see it, you're either:

1. On an older version — upgrade
2. Building PDF/X — `gs` is required for CMYK conversion, install Ghostscript

### `No Chrome or Chromium binary found`

Multi-line error with install instructions. Either:

1. Install Chrome (link in error message)
2. Set `CHROMIUM_PATH=/path/to/chrome` in your shell or system environment
3. If using Edge on Windows: `set CHROMIUM_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

### `spawn qpdf ENOENT` during PDF/X build

Install qpdf (see per-platform commands above) or disable annotation stripping in your manifest:

```yaml
pdfx:
  stripAnnotations: false
```

### Validate checks all reported as "skipped"

You're probably on Windows without `which` on PATH. See the `which` section above.

### Validate runs but specific check still fails

The check's required tool may be installed but missing from PATH. Run `which <tool>` (or `where.exe <tool>` on Windows) to verify. If the tool prints a path, restart your shell — environment changes don't propagate to running processes.

## Roadmap

### Shipped

- ✅ Microsoft Edge auto-detection on Windows + macOS (`44515fb`, 0.1.7)
- ✅ `where.exe` on Windows for validate's tool gate, `which` elsewhere (`44515fb`, 0.1.7)
- ✅ `/Creator` Ghostscript stamp is best-effort — plain PDF no longer fails when `gs` is missing (`44515fb`, 0.1.7)
- ✅ PATH probe for Chromium — Chocolatey / Scoop / Brave / Vivaldi / Arc / portable installs are now found (`d6bef6b`, 0.1.8)
- ✅ Pre-flight tool check in `runBuild` — missing tools surface as actionable errors in 50ms with per-platform install commands, instead of `spawn ENOENT` 90 seconds into the pipeline (`d6bef6b`, 0.1.8)
- ✅ Viewer IPC catch wraps raw `ENOENT` with a friendly message pointing at this doc (`d6bef6b`, 0.1.8)

### Tier 2 — planned

Recommendations from the 2026-05-19 agent-team review (`docs/system-dependencies.md` agents, all converged):

- **`print-md doctor` CLI subcommand + viewer "Check System Tools" menu item.** Iterates every tool the lib could need (Chromium, gs, qpdf, pdfinfo, pdffonts, pdfimages, pdftotext, identify, markdownlint-cli2, htmlhint), prints a status report with per-platform install commands for any missing ones. Centralizes the install-text strings currently scattered across `chromium.ts`, the `stampCreator` warning, and this doc. ~150 LOC: new `packages/cli/src/commands/doctor.ts`, new `api:doctor` IPC, viewer menu item under Help → "Check System Tools".

- **Pre-flight modal in the viewer at Save-PDF click.** Today the lib's pre-flight (0.1.8+) throws a `BuildError` with install instructions, and the viewer surfaces it as an error toast. Better UX: a proper modal with per-platform copy-able install commands, a "Continue anyway" button (for the best-effort `gs` case), and a "Show in docs" link. ~300 LOC across one new `checkPdfTooling()` export, a new IPC, and a `ToolingDialog.svelte` component.

- **Bundle qpdf in viewer + CLI release zips.** Apache-2.0, ~3MB compressed, fully license-compatible with MPL-2.0. The only external tool that's both legally bundleable AND a real PDF/X friction point worth removing. Implementation: `extraResources` block in `packages/viewer/electron-builder.yml`, a `packages/viewer/scripts/fetch-binaries.ts` that pulls platform-specific qpdf binaries from upstream GitHub releases at build time, a `resolveBundledTool()` in `packages/lib/src/lib/exec.ts` that prepends `process.resourcesPath/bin/` to the spawn lookup. ~400 LOC + per-platform binary curation.

### Tier 3 — future / situational

- **Manifest config for tool paths.** Add `tools: { chromium, gs, qpdf }` to `manifest.yaml` schema as an alternative to `CHROMIUM_PATH` env var. Useful for CI projects that pin tool versions. Defer until a user requests it; `CHROMIUM_PATH` covers ~90% of the CI case.

- **Download-on-demand Ghostscript** for the viewer's PDF/X path. A first-use modal that links to Artifex's GPL installer and walks the user through it. Sidesteps AGPL §6 because we direct the user to obtain the binary upstream rather than conveying it ourselves. Only needed if PDF/X becomes a popular viewer workflow.

- **ADR documenting AGPL/GPL bundling restrictions** (`docs/adr/0002-no-bundled-gpl-tools.md`) so future contributors don't try to bundle Ghostscript or Poppler without realizing the license implications.

### Explicit rejections

All three review agents converged on rejecting these — recorded here so future sessions don't re-litigate:

- ❌ **Bundle Ghostscript** — AGPL-3.0 §6 is viral; bundling would force the entire installer to comply.
- ❌ **Bundle Poppler** — GPL-2.0 viral; same problem.
- ❌ **Bundle ImageMagick** — licence is OK (Apache-style) but ~25 MB for only 3 validation checks isn't worth the size.
- ❌ **Bundle a full Chromium** — ~150 MB cost; Edge fallback works on Windows; macOS/Linux users install Chrome/Chromium with one brew/apt command.
- ❌ **Reuse Electron's bundled Chromium** for puppeteer-core — Electron's renderer isn't reachable via DevTools Protocol from a sibling Node process the way puppeteer requires.
- ❌ **Native installers (MSI/PKG/DEB) with declared OS deps** — per-platform installer authoring is its own discipline; massively expands CI, signing, and portability burden; AppImage breaks; no upside for the AppImage/zip/dmg distribution model we already use.
- ❌ **Setup wizard at first launch** — wizard fatigue; users who only preview never need PDF tooling, so blocking them at launch is wasted friction.
- ❌ **"Install for me" buttons** — UAC (Windows), sudo (Linux), brew-not-present (macOS) edge cases create a per-platform maintenance black hole. Show the install command with a copy button instead.
- ❌ **Auto-fallback PDF/X to plain PDF when gs/qpdf missing** — silent print-shop trap: the file looks compliant (same filename, same extension), gets rejected at prepress. Fail loud is correct for PDF/X.
- ❌ **Auto-fallback Save PDF to Save HTML when Chromium missing** — confuses the user model; they clicked Save PDF, not Save HTML.
