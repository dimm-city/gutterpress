# Gutterpress desktop

Electron + SvelteKit desktop app for the Gutterpress authoring workflow.

Non-technical users launch this app to open a project directory, see a
paginated preview with toolbar controls (page navigation, view modes, zoom),
and export a PDF — no terminal required, no runtime to install.

## Architecture

```
Electron main process (out/main/main.js — ESM, built by electron-vite)
  ├─ loadSvelteKitServer()   — constructs the SvelteKit Server from build/server/
  ├─ protocol.handle("app", ...) — serves build/client/ files, and answers every
  │                            other app:// request with Server.respond() in-process
  │                            (so +server.ts routes run; no HTTP server, no port)
  ├─ secureHandle("api:preview", ...)  — wraps lib.startPreviewServer
  ├─ secureHandle("api:build", ...)    — delegates to export/controller.ts
  │                            (secureHandle wraps ipcMain.handle and rejects
  │                            any invocation from an untrusted sender frame)
  └─ webContents.send(...) push channels  — build progress, extension download
                                            progress, folder-changed, sync status, updater events

BrowserWindow loads app://local/
  ├─ preload.ts installs the narrow window.electron bridge (contextBridge)
  └─ renderer (Svelte SPA) reaches the host two ways:
       • fetch("/api/…")   → src/routes/api/**/+server.ts host routes (the bulk)
       • window.electron.* → only push streams + the preview/build pipeline
     Components call typed api.* wrappers for routes and getPlatform() for the
     narrow adapter surface; only electron-adapter.ts touches window.electron.

Host capabilities live in ~100 src/routes/api/**/+server.ts routes — status, fs,
dialog, extension, remote/sync, vcs, recovery, lint, media, and more. These
are host Node code (they may import gutterpress and node:*) that happens
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
  with a plain dynamic `import("gutterpress")`.
- **No more Bun runtime requirement** — the packaged app is self-contained.

## Prerequisites

### Dev (this package)

- **Bun** for workspace installation, tests, and the shared library build
- **Node 22+** for the Node-based build/check scripts invoked by package scripts

### End users (packaged desktop)

- **No separate browser or runtime is required.** Save PDF uses Electron's own
  bundled Chromium through `webContents.printToPDF`; the packaged desktop never
  looks for or launches an external Chromium.

- **Ghostscript is not used for plain Save PDF.** Electron creates the PDF and
  the lib stamps `/Creator` metadata in-process with `pdf-lib`. Ghostscript is
  required only for the optional PDF/X format (CMYK conversion and ink checks).

  - Windows: https://www.ghostscript.com/ → AGPL release
  - macOS: `brew install ghostscript`
  - Linux: `apt install ghostscript` / `dnf install ghostscript`

See [User Guide: Chapter 7 — System Setup](../../examples/gutterpress-user-guide/07-system-setup.md) for the full per-feature matrix of what
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
# so any IPC-driven feature (Open Folder, Save PDF) fails with
# "ElectronAdapter used outside Electron". Good for pure UI/CSS iteration.
bun --cwd packages/desktop run dev

# Full Electron with SvelteKit HMR — RECOMMENDED for most desktop dev.
# Runs vite dev + Electron together; Electron loads the vite dev
# server (http://localhost:5173) instead of the static build. You
# get HMR + the real IPC bridge in one process.
#
# DevTools opens detached on launch. Edit Svelte files → live reload.
# Edit electron/*.ts → rebuild + restart manually (Ctrl+C, re-run).
bun --cwd packages/desktop run electron:hmr

# Full Electron against the production build (no HMR — the built SPA
# served over the app:// protocol exactly like the packaged app does).
# Use when you need to test something protocol-handler-specific or
# when the HMR version misbehaves and you want a clean baseline.
bun --cwd packages/desktop run electron:dev
```

The `electron:hmr` script wires `VITE_DEV_SERVER_URL=http://localhost:5173`
into the Electron main process; `electron/main.ts` checks that env var
and calls `mainWindow.loadURL(devUrl)` when set, otherwise falls back to
the static `app://local/`. Preload + IPC are identical in both modes.

## Building for production

```bash
# From packages/desktop:

# 1. Build the SvelteKit SPA (output: build/)
npm run build

# 2. Build the Electron main + preload via electron-vite (output: out/)
npm run electron:build

# 3. Package as platform installer (electron-builder)
npm run dist:linux   # → dist/Gutterpress-<version>.AppImage
npm run dist:win     # → stable-named setup .exe + versioned portable .zip
npm run dist:mac     # → dist/Gutterpress-<version>-{arm64,x64}.dmg
```

Each `dist:*` script runs the build and electron:build steps automatically
before packaging.

### Getting a build without cutting a release

Two `workflow_dispatch` workflows package a branch and upload the result as a
downloadable artifact — no tag, no GitHub release, no npm publish:

| workflow | artifact |
|---|---|
| **Gutterpress desktop debug build (Linux AppImage)** | `.AppImage` |
| **Gutterpress desktop debug build (Windows)** | setup `.exe` + portable `.zip` |

Actions → the workflow → **Run workflow** → pick the branch. Download the
artifact from the finished run's summary page; it arrives as a `.zip`, so
unzip it and `chmod +x` the AppImage before running it. Artifacts are kept for
14 days.

The Linux one also starts from a **push**, two ways:

```bash
# a disposable tag…
git tag build-appimage-my-branch && git push origin build-appimage-my-branch

# …or a marker in the commit message
git commit -m "wip: try the new editor [appimage]" && git push
```

Same job, same artifact; the pushed commit is what gets built. Every other
push skips the job in a second without starting a runner.

Both exist because dispatching a workflow requires `actions: write`, which
an automation account may not have even though it can push — and some
environments allow branch pushes while refusing tag refs.

Both come through the same composite action the release workflow uses
(`.github/actions/build-gutterpress-desktop`), so a branch build is packaged
exactly the way a released one is. What they deliberately leave out is the
electron-updater feed (`latest*.yml`, `.blockmap`): those belong to a
published release and would point the updater at a version that does not
exist.

### Linux

```bash
npm run dist:linux
# Output: dist/Gutterpress-<version>.AppImage
```

The AppImage is a bare portable executable — there is no installer, so nothing
in the packaging step can add it to the KDE/GNOME application menu. That is a
runtime, **opt-in** action instead: **Settings → App → Desktop integration →
Add to application menu**, implemented in `electron/appimage-integration.ts`
(status/install/remove hooks → `src/routes/api/app/appimage-integration`). It
installs a managed copy at `~/.local/bin/gutterpress.AppImage`, the icon in
the user's hicolor theme, and an XDG `.desktop` entry — per-user, no root, no
`update-desktop-database`/`kbuildsycoca6`/AppImageLauncher required. See
[docs/desktop-shortcut.md](../../docs/desktop-shortcut.md#linux-appimage-application-menu-integration-desktop-app)
for the full contract (it is a *different* thing from the CLI installer's
`Gutterpress preview` browser shortcut).

Three identity keys must stay aligned or KDE/GNOME will not associate the
running window with its launcher: `appId`/`linux.desktop.entry.StartupWMClass`
in `electron-builder.yml`, `desktopName` in `package.json`, and the desktop
filename + icon basename written by `appimage-integration.ts` — all
`city.dimm.gutterpress`.

### Windows

```bash
npm run dist:win
# Installer: dist/Gutterpress-setup-win-x64.exe
# Portable:  dist/Gutterpress-<version>-win-x64.zip
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
# Output: dist/Gutterpress-<version>-arm64.dmg and
#         dist/Gutterpress-<version>-x64.dmg
```

Both Apple Silicon and Intel DMGs are built explicitly. Release builds remain
unsigned and unnotarized under the accepted no-signing policy; the release
notes and [installation guide](../../docs/installing.md) provide Gatekeeper
instructions. For unsigned local testing, set `CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Project structure

An abridged selection — `electron/` and `src/lib/` each hold more files than
shown here (e.g. `electron/export/`, `electron/preview/`,
`electron/server-bridge/`, `electron/updater.ts`, `electron/recovery.ts`,
`electron/auto-sync/`, and dozens more `src/lib/components/*.svelte` files).

```
packages/desktop/
├── electron/                # Electron main process (TypeScript)
│   ├── main.ts              # app lifecycle, protocol.handle("app"), ipcMain handlers
│   ├── preload.ts           # contextBridge — exposes window.electron
│   ├── appimage-integration.ts # opt-in Linux application-menu install/repair/remove
│   └── tsconfig.json
├── electron.vite.config.ts  # electron-vite config (main + preload builds)
├── out/                     # electron-vite output (git-ignored)
│   ├── main/main.js         # ESM
│   └── preload/preload.cjs  # CJS (sandboxed preload can't load ESM)
├── src/                     # SvelteKit SPA
│   ├── routes/
│   │   ├── +layout.ts       # ssr=false (client-rendered SPA; not prerendered)
│   │   ├── +page.svelte     # Toolbar + iframe shell
│   │   └── api/**/+server.ts # ~100 host routes (run in main, in-process)
│   ├── lib/
│   │   ├── preview-client.ts       # postMessage wrappers for the iframe bridge
│   │   ├── iframe-styles.ts        # Injected iframe CSS
│   │   └── components/
│   │       ├── PreviewFrame.svelte
│   │       ├── Toast.svelte
│   │       ├── ActivityIndicator.svelte  # the one loading overlay / pill
│   │       └── Spinner.svelte            # the one spinner ring
│   │   └── loading/             # stage wording + delay/min-visible timing (pure, unit-tested)
│   └── app.html
├── static/                  # Static assets served from app:// root (favicon)
├── build/                   # SvelteKit build output (git-ignored):
│                            #   server/ (host, unbundled) + client/ (SPA)
├── tests/                   # Bun unit/contract tests + Playwright integration tests
├── electron-builder.yml     # Packaging config (Linux AppImage, Windows installer/zip, macOS dmg)
├── adapter-electron.js      # the ~30-line SvelteKit adapter: unbundled server + client
├── svelte.config.js         # adapter-electron (out: build), paths.relative
└── package.json
```

## Auto-update

The desktop auto-updates as a **whole app** via
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

- **adapter-electron + in-process server** — `svelte.config.js` uses the
  package's own `adapter-electron.js`, which writes the SvelteKit server
  UNBUNDLED to `build/server/` (`index.js` exports `Server`, `manifest.js` its
  manifest) plus `build/client/` (browser assets). In production
  `electron/sveltekit-host.ts` (`loadSvelteKitServer`) constructs that Server
  once. `+layout.ts` sets `ssr=false`, so pages are client-rendered; the "API"
  surface is the `+server.ts` routes the same Server answers. Nothing listens
  on a port.
- **app:// protocol** — `electron/main.ts` calls
  `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard, secure, supportFetchAPI, stream } }])`
  at module load and `protocol.handle("app", ...)` inside `app.whenReady`. The
  handler serves a `build/client/` file when the path names one (never a path
  outside that dir), and hands every other `app://local/*` request — the SPA
  shell and every `fetch("/api/…")` — to `Server.respond()`. In dev
  (`VITE_DEV_SERVER_URL` set) the window loads the vite dev server directly and
  the built server is not loaded.
- **fetch for routes, IPC for the rest** — most host calls are
  `fetch("/api/…")` to `+server.ts` routes; the `window.electron` bridge
  (`preload.ts`) is reserved for push-event streams and the preview/build
  pipeline (e.g. `window.electron.startPreview({input})`).
- **Build** — `electron-vite` builds the ESM main + preload into `out/`
  (externalizing electron + the lib); SvelteKit builds the renderer + host
  routes into `build/`. No CJS↔ESM interop trick: the ESM main just does
  `await import("gutterpress")`, cached so subsequent calls reuse the module.
  Packaged with asar, nothing unpacked (`build/server/index.js` is imported
  from inside the asar).
- **Preview iframe** — `lib.startPreviewServer` returns an `http://127.0.0.1:N`
  URL that the renderer puts in `<iframe src={url}>`. Iframe is cross-origin
  (different scheme) from the SPA's `app://` parent; postMessage bridge
  (`preview-bridge.js`) handles communication.
- **Vendored assets** — the native engine's viewer bundle + desktop scripts
  are served from the lib's process-wide embedded-assets dir, not copied into
  each preview session's tempDir. See `packages/cli/src/preview/http-server.ts`
  `EMBEDDED_PREFIXES`.
