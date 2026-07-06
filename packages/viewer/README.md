# print-md viewer

Electron + SvelteKit desktop app for the print-md authoring workflow.

Non-technical users launch this app to open a project directory, see a
paginated preview with toolbar controls (page navigation, view modes, zoom),
and export a PDF — no terminal required, no runtime to install.

## Architecture

```
Electron main process (out/main/main.js — ESM, built by electron-vite)
  ├─ startSvelteKitServer()  — imports build/handler.js (adapter-node) and
  │                            listens on 127.0.0.1:<random> (a local HTTP server)
  ├─ protocol.handle("app", ...) — proxies every app:// request to that
  │                            local server via fetch (so +server.ts routes run)
  ├─ ipcMain.handle("api:preview", ...)   — wraps lib.startPreviewServer
  ├─ ipcMain.handle("api:build", ...)     — wraps lib.runBuild for Save PDF
  └─ webContents.send(...) push channels  — build progress, folder-changed,
                                            sync status, updater events

BrowserWindow loads app://local/
  ├─ preload.ts installs the narrow window.electron bridge (contextBridge)
  └─ renderer (Svelte SPA) reaches the host two ways:
       • fetch("/api/…")   → src/routes/api/**/+server.ts host routes (the bulk)
       • window.electron.* → only push streams + the preview/build pipeline
     Always via getPlatform(); it never touches window.electron directly.

Host capabilities live in ~85 src/routes/api/**/+server.ts routes — status, fs,
dialog, theme, plugin, remote/sync, vcs, recovery, lint, media, and more. These
are host Node code (they may import @dimm-city/print-md and node:*) that happens
to sit under src/routes/; SvelteKit compiles them into build/server, never into
the client bundle.

lib.startPreviewServer is a SECOND, separate HTTP server: it serves the rendered
book.html + project assets on an ephemeral http://127.0.0.1:N port that the SPA
loads in an <iframe>, cross-origin from the app:// parent.
```

## What's NOT here anymore

If you're coming from an older architecture, several things have been
removed:

- **No more `afterPack.cjs`** — electron-builder's default dependency walker
  handles the lib correctly.
- **No more CJS↔ESM `new Function` interop trick** — the ESM main loads the lib
  with a plain dynamic `import("@dimm-city/print-md")` (removed in `c5e75ae`).
- **No more Bun runtime requirement** — the packaged app is self-contained.

## Prerequisites

### Dev (this package)

- **Bun** (or **Node 20+**) for installing workspace deps and running tests

### End users (packaged viewer)

- **A Chromium-based browser must be installed on the user's machine** for
  the Save PDF feature. The lib uses `puppeteer-core`, which has no bundled
  Chromium and never downloads one (despite what older versions of this
  README claimed). The lib probes a hard-coded list of paths — see
  `packages/cli/src/lib/chromium.ts` — and accepts a `CHROMIUM_PATH` or
  `PUPPETEER_EXECUTABLE_PATH` env-var override.

  Recognized today (as of 0.2.0):
  - **Windows:** Google Chrome in default locations OR Microsoft Edge in
    default locations (auto-detected).
  - **macOS:** Chrome, Chromium (Homebrew), or Microsoft Edge in
    `/Applications`.
  - **Linux:** `google-chrome[-stable]`, `chromium`, `chromium-browser`, or
    Snap-installed Chromium.

  For any other browser or non-default install location, set `CHROMIUM_PATH`
  to point at it.

- **Ghostscript is OPTIONAL for plain Save PDF.** As of 0.2.0, the lib's
  `/Creator` metadata stamp via Ghostscript is best-effort — if `gs` isn't
  installed, the PDF still saves and a warning is logged. (Earlier
  versions failed hard.) Ghostscript IS required for the PDF/X format
  (CMYK conversion) and recommended to silence the warning.

  - Windows: https://www.ghostscript.com/ → AGPL release
  - macOS: `brew install ghostscript`
  - Linux: `apt install ghostscript` / `dnf install ghostscript`

See [User Guide: Chapter 8 — System Setup](../../examples/print-md-user-guide/08-system-setup.md) for the full per-feature matrix of what
tools each user-visible action requires.

## Development

```bash
# From repo root — install all workspace dependencies
bun install
```

Three dev modes, pick by what you're iterating on:

```bash
# SvelteKit only (no Electron — runs in a regular browser tab at
# http://localhost:5173). HMR works, but window.electron is undefined
# so any IPC-driven feature (Open Folder, Save PDF) will toast
# "Electron bridge unavailable". Good for pure UI/CSS iteration.
bun --cwd packages/viewer run dev

# Full Electron with SvelteKit HMR — RECOMMENDED for most viewer dev.
# Runs vite dev + Electron together; Electron loads the vite dev
# server (http://localhost:5173) instead of the static build. You
# get HMR + the real IPC bridge in one process.
#
# DevTools opens detached on launch. Edit Svelte files → live reload.
# Edit electron/*.ts → rebuild + restart manually (Ctrl+C, re-run).
bun --cwd packages/viewer run electron:hmr

# Full Electron against the production build (no HMR — static SPA
# served via app:// protocol exactly like the packaged app does).
# Use when you need to test something protocol-handler-specific or
# when the HMR version misbehaves and you want a clean baseline.
bun --cwd packages/viewer run electron:dev
```

The `electron:hmr` script wires `VITE_DEV_SERVER_URL=http://localhost:5173`
into the Electron main process; `electron/main.ts` checks that env var
and calls `mainWindow.loadURL(devUrl)` when set, otherwise falls back to
the static `app://local/`. Preload + IPC are identical in both modes.

## Building for production

```bash
# From packages/viewer:

# 1. Build the SvelteKit SPA (output: build/)
npm run build

# 2. Build the Electron main + preload via electron-vite (output: out/)
npm run electron:build

# 3. Package as platform installer (electron-builder)
npm run dist:linux   # → dist/print-md-viewer-<version>.AppImage
npm run dist:win     # → dist/print-md-viewer-<version>-win-x64.exe + portable .zip
npm run dist:mac     # → dist/print-md-viewer-<version>-arm64.dmg
```

Each `dist:*` script runs the build and electron:build steps automatically
before packaging.

### Windows

```bash
npm run dist:win
# Output: dist/print-md-viewer-<version>-win-x64.exe and dist/print-md-viewer-<version>-win-x64.zip
```

For normal users, download and run the `.exe` installer. It installs per-user
without requiring administrator privileges and creates Start Menu/Desktop
shortcuts. The `.zip` remains available as a portable/manual fallback.

### macOS

```bash
npm run dist:mac
# Output: dist/print-md-viewer-<version>-arm64.dmg
```

Code-signing and notarization require macOS credentials configured in the
environment. For unsigned local testing, set
`CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Project structure

```
packages/viewer/
├── electron/                # Electron main process (TypeScript)
│   ├── main.ts              # app lifecycle, protocol.handle("app"), ipcMain handlers
│   ├── preload.ts           # contextBridge — exposes window.electron
│   └── tsconfig.json
├── electron.vite.config.ts  # electron-vite config (main + preload builds)
├── out/                     # electron-vite output (ESM, git-ignored)
│   ├── main/main.js
│   └── preload/preload.js
├── src/                     # SvelteKit SPA
│   ├── routes/
│   │   ├── +layout.ts       # ssr=false (client-rendered SPA; not prerendered)
│   │   ├── +page.svelte     # Toolbar + iframe shell
│   │   └── api/**/+server.ts # ~85 host routes (run in main via adapter-node)
│   ├── lib/
│   │   ├── preview-client.ts       # postMessage wrappers for the iframe bridge
│   │   ├── iframe-styles.ts        # Injected iframe CSS
│   │   └── components/
│   │       ├── PreviewFrame.svelte
│   │       ├── Toast.svelte
│   │       └── LoadingOverlay.svelte
│   └── app.html
├── static/                  # Static assets served from app:// root (favicon)
├── build/                   # SvelteKit adapter-node output (git-ignored):
│                            #   handler.js + server/ (host) + client/ (SPA)
├── tests/integration/       # Playwright-driven end-to-end tests
├── electron-builder.yml     # Packaging config (Linux AppImage, Windows installer/zip, macOS dmg)
├── svelte.config.js         # adapter-node (out: build), paths.relative
└── package.json
```

## Auto-update

The viewer auto-updates as a **whole app** via
[electron-updater](https://www.electron.build/auto-update) reading the GitHub
Releases feed. electron-builder generates the feed files (`latest.yml` on
Windows, `latest-linux.yml` on Linux, plus `.blockmap`s for differential
downloads) because `electron-builder.yml` declares the `publish: github`
provider; the release workflow uploads them next to the installers on every
`v*` release. There is no separate web-UI release line, no signing manifests,
and no userData bundle store — the previous custom hot-swap updater
(`web-v*` releases + Ed25519-signed zip manifests) was removed in favor of
this standard flow.

Behavior:

- **Windows (NSIS) and Linux (AppImage):** on launch the app checks the feed
  in the background, downloads a newer release if present, and shows a
  "Restart & update" banner. Installing happens on restart (or on quit, via
  `autoInstallOnAppQuit`).
- **macOS:** auto-update is disabled — Squirrel.Mac requires a code-signed
  app. The manual "Check for updates" button tells mac users to grab the
  latest DMG from GitHub Releases. Enable it later by shipping
  signed/notarized builds (Apple Developer Program) and removing the darwin
  gate in `electron/updater.ts`.
- **Channels:** electron-updater defaults apply — a stable install only sees
  stable releases; an install whose own version has a prerelease suffix
  (e.g. `0.7.0-beta.1`) also sees prereleases.
- **Dev:** fully inert (`app.isPackaged` gate in `updaterSupported()`), and
  packaged-but-unsupported platforms degrade to no-ops.

The wiring lives in `electron/updater.ts` (~140 lines) plus three
`ipcMain.handle` calls in `main.ts` (`updater:getStatus`, `updater:check`,
`updater:applyNow`). The renderer talks to it through the platform adapter
(`getPlatform().updater`) and never touches electron-updater directly.


## Architecture notes

- **adapter-node + local HTTP server** — `svelte.config.js` uses
  `@sveltejs/adapter-node`, which emits a Node HTTP handler to
  `build/handler.js` plus `build/client/` (browser assets) and `build/server/`
  (SSR + `+server.ts` routes). In production `electron/main.ts`
  (`startSvelteKitServer`) imports that handler and `createServer(...).listen(0,
  "127.0.0.1")`, giving the SPA a real local origin. `+layout.ts` sets
  `ssr=false`, so pages are client-rendered; the "API" surface is the
  `+server.ts` routes served by the same handler.
- **app:// protocol (a proxy)** — `electron/main.ts` calls
  `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard, secure, supportFetchAPI, stream } }])`
  at module load and `protocol.handle("app", ...)` inside `app.whenReady`. The
  handler does NOT read files — it **proxies** each `app://local/*` request to
  `http://127.0.0.1:<skServerPort>` with `fetch`, so both the SPA and every
  `fetch("/api/…")` from it hit the adapter-node handler. In dev
  (`VITE_DEV_SERVER_URL` set) the window loads the vite dev server directly and
  this local server is skipped.
- **fetch for routes, IPC for the rest** — most host calls are
  `fetch("/api/…")` to `+server.ts` routes; the `window.electron` bridge
  (`preload.ts`) is reserved for push-event streams and the preview/build
  pipeline (e.g. `window.electron.startPreview({input})`). The renderer only
  ever calls `getPlatform().X(...)`.
- **Build** — `electron-vite` builds the ESM main + preload into `out/`
  (externalizing electron + the lib); SvelteKit's adapter-node builds the
  renderer + host routes into `build/`. No CJS↔ESM interop trick: the ESM main
  just does `await import("@dimm-city/print-md")`, cached so subsequent calls
  reuse the module. Packaged with asar (puppeteer-core unpacked;
  `build/handler.js` is loaded from inside the asar).
- **Preview iframe** — `lib.startPreviewServer` returns an `http://127.0.0.1:N`
  URL that the renderer puts in `<iframe src={url}>`. Iframe is cross-origin
  (different scheme) from the SPA's `app://` parent; postMessage bridge
  (`pagedjs-bridge.js`) handles communication.
- **Vendored assets** — paged.polyfill.js + viewer scripts are served from
  the lib's process-wide embedded-assets dir, not copied into each preview
  session's tempDir. See `packages/cli/src/preview/http-server.ts`
  `EMBEDDED_PREFIXES`.
