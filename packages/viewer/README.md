# print-md viewer

Electron + SvelteKit desktop app for the print-md authoring workflow.

Non-technical users launch this app to open a project directory, see a
paginated preview with toolbar controls (page navigation, view modes, zoom),
and export a PDF — no terminal required, no runtime to install.

## Architecture

```
Electron main process (out/main/main.js — ESM, built by electron-vite)
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

If you're coming from the pre-v0.2.0 architecture, several things have been
removed:

- **No more SvelteKit HTTP server inside Electron** — adapter-static replaced
  adapter-node. The SPA is plain static files served via `protocol.handle`.
- **No more `/api/*` HTTP routes** — `+server.ts` files are gone, replaced
  by `ipcMain.handle()` calls in `electron/main.ts`.
- **No more `afterPack.cjs`** — electron-builder's default dependency walker
  handles the lib correctly.
- **No more Bun runtime requirement** — the packaged app is self-contained.

## Prerequisites

### Dev (this package)

- **Bun** (or **Node 20+**) for installing workspace deps and running tests

### End users (packaged viewer)

- **A Chromium-based browser must be installed on the user's machine** for
  the Save PDF feature. The lib uses `puppeteer-core`, which has no bundled
  Chromium and never downloads one (despite what older versions of this
  README claimed). The lib probes a hard-coded list of paths — see
  `packages/lib/src/lib/chromium.ts` — and accepts a `CHROMIUM_PATH` or
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
npm run dist:linux   # → dist/print-md-viewer-0.2.0.AppImage
npm run dist:win     # → dist/print-md-viewer-0.2.0-win.zip
npm run dist:mac     # → dist/print-md-viewer-0.2.0-arm64.dmg
```

Each `dist:*` script runs the build and electron:build steps automatically
before packaging.

### Windows

```bash
npm run dist:win
# Output: dist/print-md-viewer-0.2.0-win.zip
```

Extract the zip and run `print-md-viewer.exe`. The release CI runs this on
`windows-latest` so the binary is signed by electron-builder's default
config for the right platform.

### macOS

```bash
npm run dist:mac
# Output: dist/print-md-viewer-0.2.0-arm64.dmg
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

## Web UI auto-update

The viewer supports **silent, incremental updates to the SvelteKit SPA bundle**.
Only the UI layer is auto-updated. The Electron shell, Node.js runtime, and
`@dimm-city/print-md-lib` are **not** auto-updated — they ship as part of the
platform installer (`v*` tag line) and must be upgraded by re-downloading and
re-installing the app.

### What updates vs. what is manual

| Component | Update path |
|---|---|
| SvelteKit SPA (`build/`) | Auto-update via `web-v*` releases |
| Electron shell / Node runtime | Manual installer re-download (`v*` releases) |
| `@dimm-city/print-md-lib` | Manual installer re-download (`v*` releases) |

The SPA is a pure static bundle (HTML/JS/CSS). Swapping it requires only a file
system pointer swap and a `BrowserWindow` reload — no process restart, no
OS code-signing gate, no re-download of the 100 MB Electron binary.

### `userData` on-disk layout

The auto-updater stores everything under Electron's `userData` directory:

```
<userData>/web-runtime/
  current.json       — { version, path }  absolute pointer to the active bundle
  previous.json      — { version, path }  kept for rollback
  state.json         — persistent state (last check time, failed versions, etc.)
  staged.json        — { version, path }  a downloaded bundle not yet promoted
  versions/
    <semver>/        — extracted bundle root (index.html + _app/ at top level)
    <semver>.staging — temporary staging dir during extraction (always removed)
  downloads/         — transient .zip and .part files (cleaned up after extraction)
```

`current.json` is absent until the first successful auto-update. When it is
absent, `resolveWebRoot()` falls back to the `build/` directory baked into the
asar — so the app works without ever checking for updates. The in-asar build
also ships an `update-manifest.json` that records the baseline version; the
updater reads this as `currentVersion` when no `current.json` pointer exists.

### How a web UI release is cut

Web UI releases use a **separate tag line** (`web-v<semver>`) that never
overlaps with the full-installer tags (`v<semver>`). The updater ignores all
releases whose tag does not match `web-v*`.

**Option A — workflow dispatch (recommended):**

1. Go to **Actions → Release Web UI Bundle → Run workflow**.
2. Enter the semver string (e.g. `0.2.1`). The workflow creates and pushes
   the `web-v0.2.1` tag, builds the SPA, generates the manifest + signature,
   and creates the GitHub Release.

**Option B — push the tag manually:**

```bash
git tag web-v0.2.1
git push origin web-v0.2.1
```

This triggers the same workflow. The workflow is idempotent: if a release for
the tag already exists it is deleted and recreated.

Each release publishes exactly three assets:

| Asset | Description |
|---|---|
| `web-ui-bundle.zip` | Zip of `packages/viewer/build/` contents; `index.html` at zip root |
| `update-manifest.json` | Manifest (version, SHA-256, size, `requiresDesktopApi`, `releasedAt`) |
| `update-manifest.json.sig` | Ed25519 signature of the exact bytes of `update-manifest.json` (base64) |

Pre-release versions (any semver containing `-`, e.g. `0.2.1-rc.1`) are
published as GitHub pre-releases and are still picked up by the updater — the
updater does its own version comparison and does not filter by the GitHub
pre-release flag.

### `DESKTOP_API` compatibility contract

`DESKTOP_API` (defined in `electron/updater/contract.ts`) is an integer that
represents the IPC surface the shell exposes to the SPA. The manifest carries a
`requiresDesktopApi` field set by CI (`scripts/build-web-ui-manifest.mjs`
hard-codes it at `1`). At check time:

- If `manifest.requiresDesktopApi > DESKTOP_API` the update is refused and the
  user sees a message indicating the shell must be updated first.
- `DESKTOP_API` stays at `1` as long as no `ipcMain.handle()` method the SPA
  calls is added or removed. Bump it — and update `requiresDesktopApi` in the
  manifest script — only when such a breaking IPC change is shipped in the
  Electron shell.

### Signing key setup

The updater verifies every manifest with an Ed25519 signature before downloading
anything. The keys must be generated once and wired into two places.

**Generate the keypair:**

```bash
bash scripts/gen-web-ui-signing-key.sh
```

The script writes `web-ui-signing.key` (private) to the working directory and
prints the SPKI PEM public key block to stdout.

**Wire in the public key:**

Copy the `-----BEGIN PUBLIC KEY-----` … `-----END PUBLIC KEY-----` block the
script printed and replace the placeholder value of `WEB_UI_PUBLIC_KEY` in
`packages/viewer/electron/updater/contract.ts`. Commit the change.

**Store the private key as a secret:**

Go to **Repository → Settings → Secrets and variables → Actions → New repository
secret**, name it `WEB_UI_SIGNING_KEY`, and paste the contents of
`web-ui-signing.key`.

Do **not** commit `web-ui-signing.key` to git. Add it to `.gitignore` if it is
not already listed.

**Key rotation:**

1. Run `bash scripts/gen-web-ui-signing-key.sh` again to generate a new keypair.
2. Update `WEB_UI_PUBLIC_KEY` in `contract.ts` and ship a new Electron installer
   (the public key is baked into the shell binary).
3. Update the `WEB_UI_SIGNING_KEY` GitHub Actions secret with the new private key.
4. All future `web-v*` releases will be signed with the new key. Shells running
   the previous public key will reject those manifests until they install the new
   Electron build.

### Update lifecycle

On every launch the app runs a background check (non-blocking, never delays
startup):

1. Fetches the GitHub Releases list and selects the newest `web-v*` tag by
   semver.
2. Downloads `update-manifest.json` and `update-manifest.json.sig`. Verifies the
   Ed25519 signature. Rejects on any failure (fail closed).
3. Validates the manifest schema and checks `requiresDesktopApi`.
4. Skips the version if it is already current, was previously seen as a downgrade
   floor, or is recorded as failed.
5. Downloads `web-ui-bundle.zip` to `downloads/web-v<version>.zip.part`,
   verifies SHA-256 + exact byte size against the manifest, then renames to
   `.zip`. Extracts into `versions/<version>.staging/` with path-traversal guards
   on every entry. Asserts that `index.html` and `_app/` are present. Atomically
   renames to `versions/<version>/`. Records `staged.json`. Deletes the zip.

The update is **staged** at this point — it is not yet the active bundle.

**Applying an update:**

- **Next launch (automatic):** `promoteStaged()` runs before `resolveWebRoot()`
  at startup. `previous.json` is set to the former `current.json`, `current.json`
  points at the staged bundle, and `staged.json` is cleared.
- **Immediately via "Apply now":** The `updater:applyNow` IPC handler calls
  `promoteStaged()`, calls `refreshWebRoot()` (so the `app://` protocol handler
  starts serving the new bundle), and reloads the `BrowserWindow`. No process
  restart is required.

**Health gate (watchdog):**

After every promote — whether at launch or via "Apply now" — a 10-second watchdog
is armed. The renderer must call the `updater:markReady` IPC method within that
window. If it does:

- The version is recorded as healthy (`state.lastHealthyVersion`) and as the
  new downgrade floor (`state.minimumSeenVersion`).
- Old version directories (anything that is neither `current` nor `previous`)
  are pruned.

If the 10-second deadline elapses without a `markReady` call, the watchdog:

1. Calls `rollback()`: promotes `previous` back to `current`; records the failed
   version in `state.failedVersions` so it is never retried.
2. Calls `refreshWebRoot()` so the `app://` handler falls back to the last good
   bundle (or the bundled-in-asar baseline if no previous exists).
3. Reloads the window.

### Dev-mode inertness

The updater is **fully inert in development**. The guard is:

```ts
function updaterEnabled(): boolean {
  return app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
}
```

Every IPC handler checks `updaterEnabled()` and returns a no-op result when
false. No network requests, no filesystem mutations, no staging directory is
created during `electron:hmr` or `electron:dev` runs.

---

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
- **Build** — `electron-vite` builds the ESM main + preload into `out/`
  (externalizing electron + the lib); SvelteKit's adapter-static builds the
  renderer into `build/`. No CJS↔ESM interop trick: the ESM main just does
  `await import("@dimm-city/print-md-lib")`, cached so subsequent IPC calls
  reuse the module. Packaged with asar (puppeteer-core unpacked).
- **Preview iframe** — `lib.startPreviewServer` returns an `http://127.0.0.1:N`
  URL that the renderer puts in `<iframe src={url}>`. Iframe is cross-origin
  (different scheme) from the SPA's `app://` parent; postMessage bridge
  (`pagedjs-bridge.js`) handles communication.
- **Vendored assets** — paged.polyfill.js + viewer scripts are served from
  the lib's process-wide embedded-assets dir, not copied into each preview
  session's tempDir. See `packages/lib/src/preview/http-server.ts`
  `EMBEDDED_PREFIXES`.
