# print-md viewer

Electron + SvelteKit desktop app for the print-md authoring workflow.

Non-technical users launch this app to open a project directory, see a
paginated preview with toolbar controls (page navigation, view modes, zoom),
and export a PDF — no terminal required, no runtime to install.

## Architecture

```
Electron main process (electron-dist/main.js)
  ├─ protocol.handle("app", ...)        — serves the SvelteKit SPA from build/
  ├─ ipcMain.handle("api:status", ...)  — viewer status check
  ├─ ipcMain.handle("api:preview", ...) — wraps lib.startPreviewServer
  └─ ipcMain.handle("api:build", ...)   — wraps lib.runBuild for Save PDF

BrowserWindow loads app://local/
  ├─ preload.ts installs window.electron bridge (contextBridge)
  └─ renderer (Svelte SPA) calls window.electron.* — never fetch()

lib.startPreviewServer is the only HTTP server in the picture: it serves
the rendered book.html + project assets on an ephemeral http://127.0.0.1:N
port that the SPA loads in an <iframe>. The viewer never spawns subprocesses
and never hosts its own HTTP server.
```

## What's NOT here anymore

If you're coming from the pre-v0.1.0 architecture, several things have been
removed:

- **No more SvelteKit HTTP server inside Electron** — adapter-static replaced
  adapter-node. The SPA is plain static files served via `protocol.handle`.
- **No more `/api/*` HTTP routes** — `+server.ts` files are gone, replaced
  by `ipcMain.handle()` calls in `electron/main.ts`.
- **No more `afterPack.cjs`** — electron-builder's default dependency walker
  handles the lib correctly.
- **No more Bun runtime requirement** — the packaged app is self-contained.

## Prerequisites (dev only)

For developing this package locally:

- **Bun** (or **Node 20+**) for installing workspace deps and running tests
- **Chromium** is downloaded by puppeteer-core on first PDF generation;
  set `PUPPETEER_SKIP_DOWNLOAD=true` to skip if you have system Chrome on
  PATH (the lib auto-detects)

The packaged binaries that ship to end users need none of these.

## Development

```bash
# From repo root — install all workspace dependencies
bun install

# SvelteKit dev server only (browser at http://localhost:5173)
bun --cwd packages/viewer run dev

# Full Electron app (dev mode — compiles electron/ then launches)
bun --cwd packages/viewer run electron:dev
```

## Building for production

```bash
# From packages/viewer:

# 1. Build the SvelteKit SPA (output: build/)
npm run build

# 2. Compile the Electron main + preload (output: electron-dist/)
npm run electron:build

# 3. Package as platform installer (electron-builder)
npm run dist:linux   # → dist/print-md-viewer-X.Y.Z.AppImage
npm run dist:win     # → dist/print-md-viewer-X.Y.Z-win.zip
npm run dist:mac     # → dist/print-md-viewer-X.Y.Z-arm64.dmg
```

Each `dist:*` script runs the build and electron:build steps automatically
before packaging.

### Windows

```bash
npm run dist:win
# Output: dist/print-md-viewer-X.Y.Z-win.zip
```

Extract the zip and run `print-md-viewer.exe`. The release CI runs this on
`windows-latest` so the binary is signed by electron-builder's default
config for the right platform.

### macOS

```bash
npm run dist:mac
# Output: dist/print-md-viewer-X.Y.Z-arm64.dmg
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
├── electron-dist/           # Compiled Electron CJS output (git-ignored)
│   ├── main.js
│   ├── preload.js
│   └── package.json         # {"type": "commonjs"}
├── src/                     # SvelteKit SPA
│   ├── routes/
│   │   ├── +layout.ts       # ssr=false, prerender=true (SPA mode)
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
├── build/                   # SvelteKit static SPA output (git-ignored)
├── tests/integration/       # Playwright-driven end-to-end tests
├── electron-builder.yml     # Packaging config (Linux AppImage, Windows zip, macOS dmg)
├── svelte.config.js         # adapter-static, paths.relative
└── package.json
```

## Architecture notes

- **adapter-static** — the SPA is plain HTML/JS/CSS in `build/`. SvelteKit's
  client router still handles navigation; the `+layout.ts` sets `ssr=false`
  and `prerender=true` so adapter-static emits a working SPA fallback.
- **app:// protocol** — `electron/main.ts` calls
  `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard, secure, supportFetchAPI, stream } }])`
  at module load and `protocol.handle("app", ...)` inside `app.whenReady`.
  The handler resolves `app://local/*` to files under `build/`. SPA fallback
  serves `index.html` for unknown paths so client-side routes work.
- **IPC, not fetch** — the renderer calls `window.electron.startPreview({input})`
  rather than `fetch("/api/preview")`. The bridge lives in `preload.ts`.
- **Lib loader** — `electron-dist/main.js` is CJS and the lib is ESM, so the
  lib is loaded via `new Function("spec", "return import(spec)")` (TypeScript's
  CJS transform won't rewrite that to `require()`). The promise is cached so
  subsequent IPC calls reuse the already-imported module.
- **Preview iframe** — `lib.startPreviewServer` returns an `http://127.0.0.1:N`
  URL that the renderer puts in `<iframe src={url}>`. Iframe is cross-origin
  (different scheme) from the SPA's `app://` parent; postMessage bridge
  (`pagedjs-bridge.js`) handles communication.
- **Vendored assets** — paged.polyfill.js + viewer scripts are served from
  the lib's process-wide embedded-assets dir, not copied into each preview
  session's tempDir. See `packages/lib/src/preview/http-server.ts`
  `EMBEDDED_PREFIXES`.
