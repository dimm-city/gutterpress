# Gutterpress desktop

Electron + SvelteKit desktop app for the Gutterpress authoring workflow.

Non-technical users launch this app to open a project directory, see a
paginated preview with toolbar controls (page navigation, view modes, zoom),
and export a PDF — no terminal required, no runtime to install.

## Architecture

```
Electron main process (out/main/main.js — ESM, built by electron-vite)
  ├─ registerAppProtocol(buildDir) — protocol.handle("app", ...) reads the
  │                            adapter-static build (build/) directly from
  │                            disk (electron/app-protocol.ts); no local
  │                            server, no proxy, no bearer token
  ├─ secureHandle(...) × 120  — typed, runtime-validated IPC request/reply
  │                            channels (fs, dialog, shell, log, app, project,
  │                            manifest, tpl, snip, media, plugin, theme, vcs,
  │                            style, remote, publish, updater, recovery,
  │                            doctor, lint, …) — electron/api/*.ts
  └─ webContents.send(...) push channels  — build progress, folder-changed,
                                            sync status, updater events

BrowserWindow loads app://local/
  ├─ preload.ts installs the narrow window.electron bridge (contextBridge)
  └─ renderer (Svelte SPA) reaches the host entirely through IPC:
       window.electron.* (preload) → bridge.ts → feature capability module.
     There is no fetch("/api/…") surface — every request/reply operation
     that used to be a SvelteKit +server.ts route moved to a validated IPC
     channel (SFE-P5c); only src/lib/platform/bridge.ts touches
     window.electron (SFE-P5b deleted electron-adapter.ts and the
     getPlatform() service locator it backed).

Host capabilities are the 120 secureHandle(...) IPC channels in
electron/api/*.ts — status, fs, dialog, theme, plugin, remote/sync, vcs,
recovery, lint, media, and more. These run in the main process (they may
import gutterpress and node:*) and are compiled into out/main/main.js, never
into the client bundle.

lib.startPreviewServer is a SEPARATE HTTP server — the CLI's own preview
server, unrelated to the app:// protocol or IPC: it serves the rendered
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
- **No more `@sveltejs/adapter-node`, local HTTP server, or proxy** —
  `svelte.config.js` uses `@sveltejs/adapter-static`; `electron/main.ts`
  reads the static build directly from disk under `app://` (SFE-P5d). No
  `build/handler.js`, no `127.0.0.1` loopback bind, no per-session bearer
  token, no `fetch`-based proxy request.
- **No more `src/routes/api/**` SvelteKit routes or `src/lib/api.ts`** —
  every request/reply operation the renderer needs is a typed, runtime-
  validated IPC channel (SFE-P5c). Components call the feature-owned
  capability module for that operation (`$lib/update/updater-capability`,
  `$lib/remote/remote-capability`, `$lib/export/build-preview-capability`,
  `$lib/editor-host/editor-projection-capability`,
  `$lib/app-lifecycle/app-lifecycle-capability`, `$lib/lint/lint-capability`,
  …); nothing calls `fetch("/api/…")` anymore, and the old `getPlatform()`
  service locator is gone too (SFE-P5b).

## Prerequisites

### Dev (this package)

- **Bun** for workspace installation, tests, and the shared library build
- **Node 20+** for the Node-based build/check scripts invoked by package scripts

### End users (packaged desktop)

- **No separate browser or runtime is required.** Save PDF uses Electron's own
  bundled Chromium through `webContents.printToPDF`; the packaged desktop does
  not use the CLI's `puppeteer-core` browser discovery path.

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

Two dev modes, pick by what you're iterating on:

```bash
# Full Electron with SvelteKit HMR — RECOMMENDED for most desktop dev.
# Runs vite dev + Electron together; Electron loads the vite dev
# server (http://localhost:5173) instead of the static build. You
# get HMR + the real IPC bridge in one process.
#
# DevTools opens detached on launch. Edit Svelte files → live reload.
# Edit electron/*.ts → rebuild + restart manually (Ctrl+C, re-run).
bun --cwd packages/desktop run electron:hmr

# Full Electron against the production build (no HMR — static SPA
# served via app:// protocol exactly like the packaged app does).
# Use when you need to test something protocol-handler-specific or
# when the HMR version misbehaves and you want a clean baseline.
bun --cwd packages/desktop run electron:dev
```

The `electron:hmr` script wires `VITE_DEV_SERVER_URL=http://localhost:5173`
into the Electron main process; `electron/main.ts` checks that env var
and calls `mainWindow.loadURL(devUrl)` when set, otherwise falls back to
the static `app://local/`. Preload + IPC are identical in both modes.

Plain `bun --cwd packages/desktop run dev` (SvelteKit only, no Electron) is
**not** a usable UI-iteration mode since SFE-P5a: `bridge()` (`$lib/platform/
bridge.ts`) has no non-Electron implementation and throws
`DesktopHostRequiredError` on first call (`initTheme()` in `+layout.svelte`'s
`onMount`), so the page never paints — not the toast-and-degrade behavior
older versions of this doc described. Use `electron:hmr` above for all
UI/CSS iteration.

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
(status/install/remove hooks → the `app:appImageIntegrationStatus` /
`app:appImageIntegrationInstall` / `app:appImageIntegrationRemove` IPC
channels). It installs a managed copy at `~/.local/bin/gutterpress.AppImage`, the icon in
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
├── src/                     # SvelteKit SPA (adapter-static; no server routes)
│   ├── routes/
│   │   ├── +layout.ts       # ssr=false (client-rendered SPA)
│   │   └── +page.svelte     # Toolbar + iframe shell
│   ├── lib/
│   │   ├── preview-client.ts       # postMessage wrappers for the iframe bridge
│   │   ├── iframe-styles.ts        # Injected iframe CSS
│   │   └── components/
│   │       ├── PreviewFrame.svelte
│   │       ├── Toast.svelte
│   │       └── LoadingOverlay.svelte
│   └── app.html
├── static/                  # Static assets served from app:// root (favicon)
├── build/                   # adapter-static output (git-ignored): a plain
│                            #   static file tree (index.html, _app/**, …) —
│                            #   no server, no handler.js
├── tests/                   # Bun unit/contract tests + Playwright integration tests
├── electron-builder.yml     # Packaging config (Linux AppImage, Windows installer/zip, macOS dmg)
├── svelte.config.js         # adapter-static (pages/assets: build, fallback: index.html), paths.relative
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
typed IPC (`updater:getStatus`/`updater:check`/`updater:download`); Restart &
Update (`updater:applyNow`) and updater push events also use the preload
bridge because applying an update must flush the live BrowserWindow before
quitting. The renderer reaches all of it through
`$lib/update/updater-capability.ts` and never touches electron-updater
directly.


## Architecture notes

- **adapter-static, no server** — `svelte.config.js` uses
  `@sveltejs/adapter-static` (`pages`/`assets`: `build`, `fallback:
  "index.html"`), which emits a plain static file tree to `build/` — no
  `build/handler.js`, no server bundle. `src/routes/+layout.ts` sets
  `ssr=false`, so the whole SPA renders client-only; there is no `+server.ts`
  route surface at all (deleted in SFE-P5c/P5d).
- **app:// protocol (reads disk directly)** — `electron/main.ts` calls
  `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard, secure, supportFetchAPI, stream } }])`
  at module load and `registerAppProtocol(buildDir)`
  (`electron/app-protocol.ts`) inside `app.whenReady`. The handler reads the
  requested file straight out of `buildDir` (`fs/promises.readFile`) and
  returns its bytes with the right `Content-Type`; an extensionless path with
  no matching file falls back to `build/index.html` so the SvelteKit client
  router can handle a deep link. No local server, no proxy, no bearer token —
  see `app-protocol.ts`'s header for the security-equivalence statement and
  `tests/platform/app-protocol.test.ts` for the traversal-refusal tests. In
  dev (`VITE_DEV_SERVER_URL` set) the window loads the vite dev server
  directly instead.
- **IPC for everything** — every host call is a typed, runtime-validated IPC
  channel: `secureHandle(...)` in `electron/main.ts` for request/reply
  (`electron/api/*.ts` holds the actual logic), plain `ipcMain`/
  `webContents.send` for push streams (build progress, folder-changed, sync
  status, updater events) and the preview/build pipeline. The `window.electron`
  bridge (`preload.ts`) is the only way the renderer reaches any of it; app
  code never touches `window.electron` directly — only
  `src/lib/platform/bridge.ts` may — and calls the feature-owned capability
  module for that operation instead (`$lib/update/updater-capability.ts`,
  `$lib/remote/remote-capability.ts`, and so on — see "What's NOT here
  anymore" above; SFE-P5b deleted the `getPlatform()` service locator).
- **Build** — `electron-vite` builds the ESM main + preload into `out/`
  (externalizing electron + the lib); `vite build` (adapter-static) builds the
  renderer into `build/`. No CJS↔ESM interop trick: the ESM main just does
  `await import("gutterpress")`, cached so subsequent calls reuse the module.
  Packaged with asar (puppeteer-core unpacked; `build/` is read from inside
  the asar by `app-protocol.ts`).
- **Preview iframe** — `lib.startPreviewServer` returns an `http://127.0.0.1:N`
  URL that the renderer puts in `<iframe src={url}>`. Iframe is cross-origin
  (different scheme) from the SPA's `app://` parent; postMessage bridge
  (`preview-bridge.js`) handles communication.
- **Vendored assets** — the native engine's viewer bundle + desktop scripts
  are served from the lib's process-wide embedded-assets dir, not copied into
  each preview session's tempDir. See `packages/cli/src/preview/http-server.ts`
  `EMBEDDED_PREFIXES`.
