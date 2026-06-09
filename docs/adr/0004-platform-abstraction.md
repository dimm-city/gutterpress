# ADR 0004 — Platform abstraction: the renderer is host-agnostic, the host runs platform code

**Status:** Accepted (2026-06-08)
**Relates to:** ADR 0002 (in-process libraries over OS deps), ADR 0003 (web-UI auto-update)
**Implements:** GitHub #41 (platform abstraction layer)
**Codifies:** CLAUDE.md Architectural Rule §8

## Context

The print-md viewer is an Electron shell that hosts a **static SvelteKit SPA**
(`@sveltejs/adapter-static`, served over a custom `app://` protocol). The same
SPA is intended to run, unchanged, as a browser **PWA** in a later milestone
(0.6.0). Electron's renderer is a Chromium page: it has **no Node.js APIs**, and
a browser PWA has even fewer host capabilities.

Without a disciplined seam between the UI and the host, every native call site
(file dialogs, file IO, OS keychain, file watchers, preview server, PDF build,
auto-updater) gets reached for directly from components. That has two failure
modes:

1. **PWA portability dies** — every call site has to branch on `electron` vs
   `web`, scattered across the codebase (the original #41 motivation).
2. **Silent packaged-app crashes** — importing a Node-oriented value into the
   SPA *builds fine* (vite shims `node:*` to empty objects) but throws at
   runtime in the browser. This is not theoretical: 0.4.0-beta.4 shipped a hard
   launch crash — `TypeError: (0, xs.fileURLToPath) is not a function` — because
   the CSS editor imported `checkCss` from the lib, and `checkCss` is
   postcss-based, and `postcss/lib/input.js` does `require('url').fileURLToPath`.
   The build was green; the AppImage was dead on launch.

The CLI binary is the **opposite** environment — `bun build --compile`
deliberately bundles the lib's Node code into a self-contained executable
(ADR 0001/0002, CLAUDE.md §1/§3). So "bundle the lib" is correct for the CLI and
catastrophic for the renderer. The two must not be conflated.

## Decision

Define exactly **one seam** between the UI and the host, and keep the renderer
**PWA-clean** — zero platform/host code in `packages/viewer/src/`.

### The seam

- A canonical, narrow, host-divergent primitive contract — `PlatformAdapter` —
  lives in the shared lib (`packages/lib/src/platform.ts`): `openFolder`,
  `readFile`, `writeFile`, `watchFolder`, `getSecret`, `setSecret`, `platform`.
- The viewer composes `Platform = PlatformAdapter & HostServices`, where
  `HostServices` is the broader host RPC surface (preview/build/doctor/prefs/
  updater/settings/recovery/lint/…). Both are typed in
  `src/lib/platform/contract.ts`, with all payload types defined **locally**
  (decoupled from the lib, so no runtime lib import leaks in).
- `getPlatform()` returns an `ElectronAdapter` (delegates 1:1 to
  `window.electron`) when the preload bridge is present, else a `WebAdapter`
  (0.6.0 stub: rejects / throws / safe no-ops). `isDesktop()` is the single
  sanctioned bridge-presence check. Only `electron-adapter.ts` touches
  `window.electron`.

### The rules (enforced)

1. **No runtime imports from `@dimm-city/print-md-lib` in the SPA.** `import type`
   only (erased). A value import drags the Node-target lib into the browser.
2. **No `node:*` / `fs` / `path` / `url` / `child_process` / `postcss` /
   `isomorphic-git` in the SPA.** Node-oriented libraries belong in the host.
3. **All host work goes through `getPlatform()`.** No direct
   `window.electron` / `ipcRenderer` outside the adapter.
4. **New host capability = five layers** (`main.ts` IPC → `preload.ts` bridge →
   `types.d.ts` → `contract.ts` HostServices/ElectronBridge → ElectronAdapter
   delegate + WebAdapter stub), then call via `getPlatform()`.
5. **When the UI needs node code, run it in the host.** The canonical example:
   `checkCss` (postcss) runs in `main` behind a `lint:checkCss` IPC; the editor
   gutter calls `getPlatform().checkCss(...)` (async — CodeMirror accepts a
   `Promise` lint source). Same check the CLI's `print-md validate` uses, so the
   gutter and CLI never disagree, and postcss never enters the renderer.

### Verification

After `npm run build`, the SPA bundle must contain no host code:

```sh
grep -rlE "fileURLToPath|node:module|createRequire|node:fs|node:url|isomorphic-git" build/_app/
# must output nothing
```

A hit is a **release-blocking regression**. This catches the exact class of bug
that a green `tsc`/`svelte-check`/build does not.

## Consequences

- **Positive:** the SPA is portable to a browser PWA with no app-code changes
  (only a real `WebAdapter` implementation). Host code is testable in isolation;
  the UI is testable with a fake bridge. The "works in dev, crashes packaged"
  trap is structurally impossible if the bundle audit is run.
- **Cost:** a new host capability touches five files instead of one. This is
  intentional friction — it is the price of the seam, and it is small relative
  to a shipped launch crash.
- **Scope note:** this governs the **renderer**. The `bun build --compile` CLI
  binary bundles the lib's Node code on purpose (§1/§3) — opposite environment,
  opposite rule.

## Gold standard for new Electron applications

This pattern is the **default starting architecture for any new Electron app in
this org**, not a print-md-specific choice. Build the typed adapter seam
**first**, before the first feature adds a host call. The renderer/host split is
the only thing that simultaneously keeps an Electron UI (a) portable to web,
(b) testable without a host, and (c) free of build-passes-but-runtime-crashes
defects. Reach for "run it in the host, expose a narrow async method" the moment
a UI feature wants a node-oriented library.
