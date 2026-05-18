# print-md viewer

Electron + SvelteKit desktop app for the print-md authoring workflow.

Non-technical users launch this app to open a project directory, see a
paginated preview with toolbar controls (page navigation, view modes, zoom),
and export a PDF — no terminal required.

The SvelteKit server imports `@dimm-city/print-md` directly as a workspace
dependency — no subprocess, no JSON IPC. All heavy lifting (markdown rendering,
PDF export, preview server) happens in-process via the library API.

## Architecture

```
Electron main process
  └─ spawns: bun build/index.js   (SvelteKit + Bun server)
                └─ imports: @dimm-city/print-md
                └─ serves:  http://127.0.0.1:<port>
  └─ BrowserWindow loads the above URL
  └─ preload.ts exposes contextBridge for native dialogs (folder picker, save PDF)
```

The preview server (a separate `Bun.serve` instance on a different port) is
started on demand when the user opens a project folder. The Svelte toolbar
drives it via `postMessage` to `window.previewAPI`.

## Prerequisites

- **Bun** must be installed on the host machine. The packaged app does not
  bundle a Bun binary — it spawns `bun build/index.js` at startup.
  Install: https://bun.sh/install

- **Chromium** — used internally by `@dimm-city/print-md` for PDF generation
  via Playwright. Playwright downloads Chromium automatically on first use:
  ```bash
  bunx playwright install chromium
  ```

## Development

```bash
# From repo root — install all workspace dependencies
bun install

# SvelteKit dev server only (no Electron, browser at http://localhost:5173)
bun --cwd packages/viewer run dev

# Full Electron app (dev mode — compiles electron/ then launches)
bun --cwd packages/viewer run electron:dev

# Or use the root-level workspace shortcuts
bun run viewer:dev        # SvelteKit only
bun run viewer:electron   # Full Electron
```

Vite scripts in this package are invoked with `bun --bun` (see `package.json`)
so that Bun's module resolver handles `@dimm-city/print-md` correctly at dev
time. Do not remove the `bun --bun` prefix from the `dev`, `build`, and
`preview` scripts.

## Building for production

```bash
# From packages/viewer:

# 1. Build the SvelteKit Node bundle (output: build/)
bun run build

# 2. Compile the Electron main process (output: electron-dist/)
bun run electron:build

# 3. Package as platform installer (requires electron-builder)
bun run dist:linux   # → dist/print-md-X.Y.Z.AppImage
bun run dist:win     # → dist/print-md-X.Y.Z-win32-x64.zip
bun run dist:mac     # → dist/print-md-X.Y.Z.dmg
```

Each `dist:*` script runs the build and electron:build steps automatically
before packaging.

### Linux AppImage

```bash
bun run dist:linux
# Output: dist/print-md-X.Y.Z.AppImage
```

To inspect the unpacked app without creating the installer:

```bash
bunx electron-builder --linux AppImage --config electron-builder.yml --dir
# Output: dist/linux-unpacked/
```

### Windows

```bash
bun run dist:win
# Output: dist/print-md-X.Y.Z-win32-x64.zip
```

Extract the zip and run `electron.exe` inside.

**Known limitation:** When building from Linux, the Windows binary ships as
`electron.exe` — the product name is not patched without Wine. For a branded
executable name and icon, build on a Windows machine or use the GitHub Actions
release workflow (which cross-builds on `ubuntu-latest` via electron-builder's
Windows target and Wine).

### macOS

```bash
bun run dist:mac
# Output: dist/print-md-X.Y.Z.dmg
```

Code-signing and notarization require macOS credentials configured in the
environment. For unsigned local testing, pass `--skip-if-ci` or set
`CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Project structure

```
packages/viewer/
├── electron/               # Electron main process (TypeScript)
│   ├── main.ts             # app lifecycle, BrowserWindow, child-process boot
│   ├── preload.ts          # contextBridge for native dialogs
│   └── tsconfig.json
├── electron-dist/          # Compiled Electron CJS output (git-ignored)
├── src/                    # SvelteKit app
│   ├── routes/
│   │   ├── +page.svelte    # Toolbar + iframe shell
│   │   └── api/            # +server.ts routes wrapping @dimm-city/print-md
│   └── lib/
│       ├── preview-client.ts       # postMessage wrappers
│       ├── iframe-styles.ts        # Injected iframe CSS
│       └── components/
│           ├── Toast.svelte
│           └── LoadingOverlay.svelte
├── build/                  # SvelteKit Node bundle output (git-ignored)
├── electron-builder.yml    # Packaging config (Linux AppImage, Windows, macOS)
├── svelte.config.js        # adapter-node
├── vite.config.ts          # SSR externals for @dimm-city/print-md + native deps
└── package.json
```

## Architecture notes

- **SSR externals** — `vite.config.ts` marks `@dimm-city/print-md` and its
  native transitive dependencies (`puppeteer-core`, `chokidar`, `pagedjs`,
  `stylelint`, etc.) as SSR-external so Vite/Rollup never bundles them. They
  resolve at runtime under the system Bun.
- **No-bundlers rule** — the `packages/cli/src/` no-bundlers constraint (ADR
  `docs/adr/0001-no-bundlers-at-runtime.md`) does NOT apply here. The viewer
  is a web app built by Vite/Rollup; that is intentional and correct.
- **IPC** — native dialogs (folder picker, save-PDF path) go through Electron's
  `contextBridge` in `preload.ts`. The SvelteKit server never touches the
  Electron API directly.
