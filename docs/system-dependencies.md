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

## Gaps and roadmap

Known issues this doc reflects (not yet fixed in code):

1. **Microsoft Edge isn't auto-detected** on Windows. Edge is the only Chromium-based browser pre-installed on stock Windows; Save PDF without Chrome installed currently fails until the user sets `CHROMIUM_PATH`. Adding Edge to the candidate list is a small change in `chromium.ts`.

2. **No PATH probe** — Chrome installed via Scoop/Chocolatey/Homebrew to a non-default location is invisible. Workaround: set `CHROMIUM_PATH`.

3. **No pre-flight tool check in the viewer.** "Save PDF" launches the full pipeline before discovering Chromium is absent; a missing-tool toast at click time would be friendlier than a mid-render error.

4. **No manifest field for tool paths.** All overrides go through env vars today.

5. **`which` gap on Windows** — the validate gate uses `which`, which isn't on stock Windows. The gate should fall back to `where.exe` on Windows.
