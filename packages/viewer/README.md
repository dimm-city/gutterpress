# print-md viewer

Electron + SvelteKit desktop app for the print-md authoring workflow.

The SvelteKit server imports `@dimm-city/print-md` directly as a workspace
dependency — no subprocess, no JSON IPC. All heavy lifting (markdown rendering,
PDF export, preview server) happens in-process via the library API.

## Architecture

```
Electron main process
  └─ spawns: bun build/index.js   (SvelteKit Node server)
                └─ imports: @dimm-city/print-md
                └─ serves:  http://127.0.0.1:<port>
  └─ BrowserWindow loads the above URL
```

The preview server (a separate `Bun.serve` instance on a different port) is
started on demand when the user opens a project folder. The Svelte toolbar
drives it via `postMessage` to `window.previewAPI`.

## Runtime dependency: system Bun

The Electron main process spawns `bun build/index.js` to start the SvelteKit
server. **Bun must be installed on the host machine.** The packaged app does
not bundle a Bun binary.

Install Bun: https://bun.sh/install

## Development

```bash
# From repo root — install all workspace dependencies
bun install

# SvelteKit dev server only (no Electron, browser at http://localhost:5173)
bun --cwd packages/viewer run dev

# Full Electron app (dev mode — compiles electron/ then launches)
bun --cwd packages/viewer run electron:dev

# Or from repo root
bun viewer:electron
```

## Building for production

```bash
# From packages/viewer:

# 1. Build the SvelteKit Node bundle (output: build/)
bun run build

# 2. Compile the Electron main process (output: electron-dist/)
bun run electron:build

# 3. Package as Linux AppImage (requires electron-builder)
bun run dist:linux
```

The `dist:linux` script runs all three steps in sequence.

## Packaging (electron-builder)

Configuration lives in `electron-builder.yml`. The Linux AppImage target is
supported. macOS and Windows packaging is not yet configured.

To produce an unpacked directory for inspection without creating the installer:

```bash
bunx electron-builder --linux AppImage --config electron-builder.yml --dir
```

The resulting unpacked app is at `dist/linux-unpacked/`. The app depends on a
system `bun` binary — see runtime dependency note above.

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
│   │   ├── +page.svelte    # Toolbar + iframe shell (DO NOT EDIT — parity agent)
│   │   └── api/            # +server.ts routes wrapping @dimm-city/print-md
│   └── lib/
│       ├── preview-client.ts       # postMessage wrappers (DO NOT EDIT)
│       ├── iframe-styles.ts        # Injected iframe CSS (DO NOT EDIT)
│       └── components/
│           ├── Toast.svelte        # (DO NOT EDIT — parity agent)
│           └── LoadingOverlay.svelte (DO NOT EDIT — parity agent)
├── build/                  # SvelteKit Node bundle output (git-ignored)
├── electron-builder.yml
├── svelte.config.js        # adapter-node
├── vite.config.ts          # SSR externals for @dimm-city/print-md + native deps
└── package.json
```
