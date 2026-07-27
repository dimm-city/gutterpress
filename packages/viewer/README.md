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
  ├─ ipcMain.handle("api:startPreview", ...) — wraps lib.startPreviewServer
  ├─ ipcMain.handle("api:build", ...)     — wraps lib.runBuild for Save PDF
  └─ webContents.send(...) push channels  — build progress, folder-changed,
                                            sync status, updater events

BrowserWindow loads app://local/
  ├─ preload.ts installs the narrow window.electron bridge (contextBridge)
  └─ renderer (Svelte SPA) reaches the host two ways:
       • fetch("/api/…")   → src/routes/api/**/+server.ts host routes (the bulk)
       • window.electron.* → only push streams + the preview/build pipeline
     Components call typed api.* wrappers for routes and getPlatform() for the
     narrow adapter surface; only electron-adapter.ts touches window.electron.

Host capabilities live in ~100 src/routes/api/**/+server.ts routes — status, fs,
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

- **Bun** for workspace installation, tests, and the shared library build
- **Node 20+** for the Node-based build/check scripts invoked by package scripts

### End users (packaged viewer)

- **No separate browser or runtime is required.** Save PDF uses Electron's own
  bundled Chromium through `webContents.printToPDF`; the packaged viewer does
  not use the CLI's `puppeteer-core` browser discovery path.

- **Ghostscript is not used for plain Save PDF.** Electron creates the PDF and
  the lib stamps `/Creator` metadata in-process with `pdf-lib`. Ghostscript is
  required only for the optional PDF/X format (CMYK conversion and ink checks).

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
npm run dist:win     # → stable-named setup .exe + versioned portable .zip
npm run dist:mac     # → dist/print-md-viewer-<version>-{arm64,x64}.dmg
```

Each `dist:*` script runs the build and electron:build steps automatically
before packaging.

### Linux

```bash
npm run dist:linux
# Output: dist/print-md-viewer-<version>.AppImage
```

The AppImage is a bare portable executable — there is no installer, so nothing
in the packaging step can add it to the KDE/GNOME application menu. That is a
runtime, **opt-in** action instead: **Settings → App → Desktop integration →
Add to application menu**, implemented in `electron/appimage-integration.ts`
(status/install/remove hooks → `src/routes/api/app/appimage-integration`). It
installs a managed copy at `~/.local/bin/print-md-viewer.AppImage`, the icon in
the user's hicolor theme, and an XDG `.desktop` entry — per-user, no root, no
`update-desktop-database`/`kbuildsycoca6`/AppImageLauncher required. See
[docs/desktop-shortcut.md](../../docs/desktop-shortcut.md#linux-appimage-application-menu-integration-desktop-app)
for the full contract (it is a *different* thing from the CLI installer's
`print-md preview` browser shortcut).

Three identity keys must stay aligned or KDE/GNOME will not associate the
running window with its launcher: `appId`/`linux.desktop.entry.StartupWMClass`
in `electron-builder.yml`, `desktopName` in `package.json`, and the desktop
filename + icon basename written by `appimage-integration.ts` — all
`city.dimm.print-md-viewer`.

### Windows

```bash
npm run dist:win
# Installer: dist/print-md-viewer-setup-win-x64.exe
# Portable:  dist/print-md-viewer-<version>-win-x64.zip
```

For normal users, download and run the `.exe` installer. It installs per-user
without requiring administrator privileges and creates Start Menu/Desktop
shortcuts. Its basename stays stable across releases to avoid resetting an
unsigned download's SmartScreen reputation solely because its name changed.
The versioned `.zip` remains a portable extract-and-run fallback; it does not
register an uninstaller and is not the installed app's auto-update channel.

### macOS

```bash
npm run dist:mac
# Output: dist/print-md-viewer-<version>-arm64.dmg and
#         dist/print-md-viewer-<version>-x64.dmg
```

Both Apple Silicon and Intel DMGs are built explicitly. Release builds remain
unsigned and unnotarized under the accepted no-signing policy; the release
notes and [installation guide](../../docs/installing.md) provide Gatekeeper
instructions. For unsigned local testing, set `CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Project structure

```
packages/viewer/
├── electron/                # Electron main process (TypeScript)
│   ├── main.ts              # app lifecycle, protocol.handle("app"), ipcMain handlers
│   ├── preload.ts           # contextBridge — exposes window.electron
│   ├── appimage-integration.ts # opt-in Linux application-menu install/repair/remove
│   └── tsconfig.json
├── electron.vite.config.ts  # electron-vite config (main + preload builds)
├── out/                     # electron-vite output (ESM, git-ignored)
│   ├── main/main.js
│   └── preload/preload.js
├── src/                     # SvelteKit SPA
│   ├── routes/
│   │   ├── +layout.ts       # ssr=false (client-rendered SPA; not prerendered)
│   │   ├── +page.svelte     # Toolbar + iframe shell
│   │   └── api/**/+server.ts # ~100 host routes (run in main via adapter-node)
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
├── tests/                   # Bun unit/contract tests + Playwright integration tests
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
  in the background and shows an update banner when a newer release is
  present. The user chooses when to download it. Installing happens through
  "Restart & update" (or on quit after download, via `autoInstallOnAppQuit`).
- **macOS:** automatic installation is disabled because Squirrel.Mac requires
  a code-signed app. Checks still run against GitHub Releases using the selected
  Stable/Beta/Alpha channel. The update banner opens that exact release so the
  user can download its DMG manually.
- **Update channels:** Settings → App → Updates offers Stable (default), Beta,
  and Alpha. Channels are inclusive downward — Beta also receives stable
  releases, Alpha receives everything. Release tags must use `-beta.N` /
  `-alpha.N` prerelease suffixes (enforced by the release workflow):
  electron-updater hardcodes alpha/beta as its known channels, and any other
  suffix (e.g. `rc`) becomes a "custom channel" whose users are only ever
  offered releases with that exact suffix.
- **Dev:** fully inert (`app.isPackaged` gate in `updaterSupported()`), and
  packaged-but-unsupported platforms degrade to no-ops.

The engine lives in `electron/updater.ts`. Status, check, and download are
ordinary SvelteKit API routes; only Restart & Update and updater push events use
the preload bridge because applying an update must flush the live BrowserWindow
before quitting. The renderer reaches both through `getPlatform().updater` and
never touches electron-updater directly.


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
