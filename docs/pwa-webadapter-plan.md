# PWA / WebAdapter Implementation Plan (Issue #33)

> Status: **partially shipped, plan revised 2026-07-02.** The FSA folder-open
> path, the service worker, and the manifest are implemented (Phases 1 and 4
> below are marked accordingly). Two architecture changes since the original
> spike are folded in throughout:
>
> 1. **Desktop auto-update is now electron-updater** (full-app updates from the
>    GitHub Releases feed; see `packages/viewer/README.md` "Auto-update"). The
>    custom web-UI hot-swap system (`web-runtime.ts`, Ed25519-signed `web-v*`
>    bundles) this document originally coexisted with was **deleted** — every
>    reference has been updated.
> 2. **The viewer build is `adapter-node`, not `adapter-static`** (handler.js +
>    client/ + server/; `ssr=false`, relative paths unchanged). Host
>    capabilities are `+server.ts` routes backed by hooks the Electron main
>    registers on `globalThis`. This *adds* a delivery target: the same build
>    runs on any **node-backed website** (§3).
>
> Governing rule: **CLAUDE.md §8** (platform abstraction; the renderer stays
> PWA-clean; all host work goes through the platform seam). The whole point of
> the `Platform` adapter was to make this PWA possible — this plan fills in
> **one adapter** (`WebAdapter`) and changes **nothing** in the SPA.

---

## 0. Executive summary

The viewer is a SvelteKit SPA (`ssr=false`, relative paths, built with
`adapter-node`) that talks to its host **only** through `getPlatform()` →
`Platform = PlatformAdapter & HostServices`. Electron is one implementation;
this plan fills in `WebAdapter` as the second. The same UI publishes to
**three targets**:

- **Desktop** — Electron runs the adapter-node `handler.js` in-process;
  the app updates as a whole via **electron-updater** (GitHub Releases feed).
- **Node-backed website** — the identical adapter-node build deployed to any
  Node host (§3); updates by redeploy.
- **PWA / static host** — the client bundle + service worker on any static
  host; updates via the SW (§5).

Three facts make #33 tractable with the **simplest possible** architecture:

1. **The markdown→HTML pipeline is pure JS.** `createMarkdownRenderer()`
   (`packages/cli/src/lib/markdown/index.ts`) is `markdown-it` + plugins with
   **zero** `node:*` usage. Only the *file-reading wrapper* `renderChapters()`
   is Node-coupled (`node:fs/promises`, `node:path`). A browser render path
   reuses the renderer and replaces the file-reading wrapper with FSA reads.

2. **Paged.js already renders client-side in the browser.** Today the preview
   is an `<iframe src="http://127.0.0.1:PORT/book.html">` that loads
   `/vendor/paged.polyfill.js` and paginates **in the iframe's own browser
   context**. There is no Chromium/puppeteer in the *preview* path — puppeteer
   is only in the *PDF build* path. So "live preview without Chromium" is
   already how preview works; we only need to change **where book.html comes
   from** (a Blob URL the WebAdapter builds, instead of a localhost HTTP server).

3. **PDF/build is the only genuinely desktop/CLI-bound capability** (puppeteer
   on CLI; `webContents.printToPDF` on Electron — ADR 0002). The `capabilities()`
   seam (#49) + `BuildResult.downloadUrl` field already exist precisely to gate
   this off on web.

**Recommended split (Occam's razor):** the **WebAdapter is pure-browser** — File
System Access API for folders/files, in-browser `markdown-it` + Paged.js for
preview, IndexedDB for handle persistence, `localStorage` for settings. It does
**NOT** call back to a local CLI server for any core editing/preview operation.
The CLI's `--serve` mode is **only a static file host** for the built SPA plus
the PWA assets (manifest, service worker, vendor paged.js) — it is the
*delivery* mechanism, not a runtime backend. Git sync and PDF build stay
out-of-scope for web in this milestone (degrade via `capabilities()`).

Capability-matrix headline (≈70 contract members):
- **Implementable now (pure browser): ~30** — fs primitives via FSA, settings,
  theme, preview, build-as-HTML-download, prefs/recents/favorites/project-state
  via IndexedDB, file listing, folder classification (no-git), recovery
  snapshots via OPFS.
- **Degrade via `capabilities()` / safe no-op: ~18** — showInFolder, native save
  path, splash, lint (`[]`), discoverProjects (`[]`), media thumbnails, sync
  status pill (never emits), updater (PWA uses SW update, not the desktop
  updater).
- **Out-of-scope-for-web this milestone: ~22** — PDF/pdfx build, all Git remote
  (#15) + Advanced Setup (#14) + sync (#15) + recovery-confirm (desktop-only),
  version-history mutations (#13), GitHub device flow. These keep throwing/`[]`.

**Phase 1 vertical slice:** the app **loads in Chrome** (correct adapter
selected when `window.electron` is absent), the user picks **one folder** with
`showDirectoryPicker()`, the file list and a `.md` file's contents render, and
edits write back via FSA. No preview render, no SW, no persistence yet — just
prove the FSA fs primitives behind the existing `Platform` seam.

---

## 1. HostServices + PlatformAdapter capability matrix

Columns:
- **Electron (today)** — what the real host does.
- **Web (FSA — Chrome/Edge)** — primary target; File System Access API present.
- **Web (Safari fallback)** — no FSA `showDirectoryPicker`/`FileSystemDirectoryHandle`;
  uses `<input type=file webkitdirectory>` to *import* and download to *export*,
  OPFS for working state.

Verdicts: ✅ Implementable now · 🟡 Degrade via `capabilities()`/no-op · ⛔ Out-of-scope-for-web (keep stub).

### 1a. `PlatformAdapter` primitives (the genuinely host-divergent fs/secret surface)

| Method | Electron (today) | Web (FSA Chrome/Edge) | Web (Safari) | Browser API |
|---|---|---|---|---|
| `openFolder(): FolderRef\|null` | native dir dialog → abs path, wrap as FolderRef | ✅ `showDirectoryPicker()` → `FileSystemDirectoryHandle`; stash in handle-registry, `key`=registry id | 🟡 `<input webkitdirectory>` import → copy tree into OPFS; `key`=OPFS path | `window.showDirectoryPicker()` / `<input webkitdirectory>` |
| `readFile(path): string` | `fs:readFile` IPC | ✅ resolve handle from `key`+relpath, `getFileHandle().getFile().text()` | 🟡 OPFS `getFileHandle().getFile().text()` | FSA `FileSystemFileHandle` / OPFS |
| `writeFile(path, content): FileWriteResult` | `fs:writeFile` IPC (returns mtime) | ✅ `createWritable()`+`write()`+`close()`, re-stat for mtime | 🟡 OPFS writable; "Export" downloads zip on demand | `FileSystemWritableFileStream` |
| `listDir(path): {name,path,isDir}[]` | `fs:listDir` IPC | ✅ async-iterate `dirHandle.entries()` | 🟡 iterate OPFS dir | `dirHandle.entries()` |
| `statFile(path): FileStat` | scaffolded (throws) | ✅ `getFile()` → `{ size, mtimeMs: file.lastModified }` | 🟡 OPFS `getFile()` | `File.lastModified`/`File.size` |
| `watchFolder(path, cb): ()=>void` | scaffolded (throws) | 🟡 **no FS-watch API** — return no-op unsubscribe; external-edit detection unavailable on web (acceptable: web is single-writer) | 🟡 no-op | — |
| `getSecret/setSecret` | scaffolded (throws) | ⛔ no OS keychain; only needed by Git remote (out-of-scope) — keep throwing | ⛔ throw | — |

> **Path model on web.** FSA handles have **no path strings** and are **not
> `===`-comparable**. The WebAdapter keeps an in-memory **handle registry**
> (`Map<string, FileSystemHandle>`) keyed by an opaque id; `FolderRef.key` /
> `FileRef.key` carry that id (§4). Within a project, "paths" passed to
> `readFile`/`writeFile` are **project-root-relative POSIX strings** the adapter
> resolves by walking `getDirectoryHandle()`/`getFileHandle()` from the root
> handle. The SPA already treats these as opaque (§8 / FolderRef contract), so
> no SPA change is needed.

### 1b. `HostServices` — implementable now on web

| Method | Electron | Web verdict | How on web |
|---|---|---|---|
| `apiVersion` | bridge value | ✅ | return `0` (or a `web`-specific const) |
| `capabilities()` | all-true | ✅ | FSA present → `{nativeSavePath:false, showInFolder:false, persistentFolderAccess:true}`; Safari → all-false |
| `getSettings/setSettings` | userData json | ✅ already done | `localStorage` (already implemented in stub) |
| `getNativeTheme/onNativeThemeUpdated` | nativeTheme | ✅ already done | `matchMedia('(prefers-color-scheme: dark)')` (already implemented) |
| `getViewerPrefs/setViewerPrefs` | userData json | ✅ | IndexedDB `prefs` store (or localStorage) |
| `getViewerProjectState/setViewerProjectState` | userData json | ✅ | IndexedDB keyed by `FolderRef.key` |
| `getRecentFolders/getFavorites/toggleFavorite/removeRecent` | userData json | ✅ | IndexedDB; entries hold the persisted FSA handle (§4) |
| `getLastProject` | userData | ✅ | IndexedDB last-opened handle id |
| `listProjectFiles(dir)` | `fs:listDir` shallow | ✅ | FSA: iterate root handle, filter `.md`/`.css` |
| `classifyProject(path)` | lib detect (.git) | ✅ (degraded) | return `{source:"local-folder", capabilities: noGit}` — web never has `.git` semantics; no version-history offered |
| `startPreview(args): {url,...}` | localhost HTTP server, returns `http://…/book.html` | ✅ (rearchitected) | build book.html string in-browser (§2), return a **Blob/object URL**; no server |
| `stopPreview()` | kill server | ✅ | `URL.revokeObjectURL(lastBlobUrl)` |
| `build({format:"html"})` | runBuild → file path | ✅ | render full book.html in-browser, package as a downloadable `Blob`, return `{downloadUrl}` |
| `splashStatus/rendererReady` | splash IPC | ✅ already done | no-op (no splash window) — already implemented |
| `writeRecovery/clearRecovery/listRecovery` | userData sidecars | ✅ | OPFS `recovery/` dir (handles survive reloads); listRecovery already `[]`-safe |
| `readLogFile` | reads file | 🟡 already `null` | resolve `null` (no sync logs on web) |

### 1c. `HostServices` — degrade via capabilities() / safe no-op

| Method | Electron | Web verdict | Rationale |
|---|---|---|---|
| `showInFolder` | OS reveal | 🟡 reject/no-op; UI hides via `capabilities().showInFolder=false` | no OS file manager |
| `savePdf` | save dialog → path | 🟡 reject; gated off with PDF build (§6) | PDF is desktop-only |
| `openExternal` | shell.openExternal | ✅ trivially → `window.open(url, "_blank")` | (upgrade from current reject) |
| `checkCss` | postcss IPC | 🟡 `[]` already | postcss is Node-coupled; lint is non-essential chrome (could later run postcss-in-browser, deferred) |
| `lintProject` | check runner IPC | 🟡 `[]` already | check runner is Node fs/glob — non-essential |
| `discoverProjects` | bg fs scan | 🟡 `[]` already | no ambient fs scan in browser |
| `listProjectImages/imageThumbnail/inspectImage/pickImageFiles` | media IPC | 🟡 thumbnail/inspect→`null`; listProjectImages could be ✅ via FSA later | Media panel guards with `isDesktop()`; keep degraded for v1 |
| `pickImageFile(): FileRef\|null` | dialog→FileRef | ✅ later via `showOpenFilePicker()`; v1 may keep reject | image insert is post-Phase-1 |
| `copyFile` | fs copy | 🟡 reject (no cross-FS copy without handles); image-insert deferred | — |
| `updater.*` | electron-updater (full-app, GitHub feed) | 🟡 keep `updater` rejecting on web — PWA updates via the **service worker** (§5); a node-backed site updates by redeploy | electron-updater is a desktop concern; the web auto-update story is the SW |
| `onSyncStatus/setAutoSync` | orchestrator | 🟡 never-emit / no-op already | sync out-of-scope |
| `onRecoveryConfirm/respondRecoveryConfirm` | recovery IPC | 🟡 no-op already | recovery out-of-scope |
| `onBuildProgress/onUrlPreviewBlocked/onFolderChanged/onFlushBeforeClose` | event IPC | 🟡 no-op already | no host events on web |
| `setDirtyState` | close-gate IPC | 🟡 reject→**change to no-op**; use `beforeunload` in SPA-host (still adapter-owned) | browser has no main-process close gate |
| `getStatus` | lib status | 🟡 resolve `{ok:true,runtime:"web",name:"print-md"}` (upgrade from reject) | so status chrome renders |
| `doctor` | lib doctor | ⛔ reject | diagnostics are Node-tool-bound |

### 1d. `HostServices` — out-of-scope-for-web (keep current stub: reject)

All of these stay as-is (reject / `[]`), gated in the UI by
`classifyProject()` capabilities and `getRemoteConnection()→{connected:false}`:

- **PDF/build:** `build({format:"pdf"|"pdfx"})`, `savePdf`, `cancelExport`.
- **Version history (#13):** `enableVersionHistory`, `saveSnapshot`,
  `restoreSnapshot` (and `listSnapshots`/`listSnapshotsPage` already `[]`).
- **GitHub managed (#15):** `connectGitHubStart/Wait/Cancel`, `disconnectGitHub`,
  `listRemoteRepositories/Branches`, `listRepoBooks`, `cloneRemoteRepository`,
  `onCloneProgress`.
- **Advanced setup (#14):** `diagnoseProjectRemote`, `testRemoteAccess`,
  `connectGenericHost`, `disconnectHost` (and `listHostConnections`/`forgeTokenUrl`
  already `[]`/`null`).
- **Sync (#15):** `syncChanges`, `resolveSyncConflicts`, `getConflictPreview`.
- **createProject (#25):** scaffold uses embedded templates + Node fs; reject for
  v1 (could later be FSA-write-based — deferred).

---

## 2. The render / preview path on web

### Today (Electron)
1. SPA calls `getPlatform().startPreview({input: FolderRef})`.
2. ElectronAdapter → `preview:start` IPC → main runs the CLI lib's
   `startPreviewServer()` — a **real `node:http` server inside Electron**
   (`packages/cli/src/preview/http-server.ts`).
3. The server renders the book with `renderChapters()` (`markdown-it` →
   `markdown-it-paged` HTML), writes `book.html` to a temp dir, and injects
   `<script src="/vendor/paged.polyfill.js">`.
4. Main returns `{ url: "http://127.0.0.1:PORT/book.html" }`.
5. The SPA loads it in a sandboxed cross-origin `<iframe src=previewUrl>`.
6. **Paged.js paginates inside the iframe's browser context** — no
   puppeteer/Chromium-headless involved in preview. (Puppeteer is only in the
   PDF *build* path.)

### Key finding: the render is **pure JS**, the *file loader* is Node-coupled
- `createMarkdownRenderer()` and `markdown-it-paged.js` use **zero `node:*`** —
  they run unchanged in a browser bundle.
- Only `renderChapters(inputDir, …)` is Node-coupled: it calls
  `readdir`/`readFile` from `node:fs/promises` and `join` from `node:path` to
  read the project's `.md`/`.css` off disk.
- Paged.js (`/vendor/paged.polyfill.js`) is already a browser script.

### On web (no server, no Chromium)
Add a **browser render module** that mirrors `renderChapters()` but takes its
inputs from FSA instead of `node:fs`. The simplest, §8-compliant home for it is
**inside the WebAdapter** (it is host code; the SPA never imports it):

1. SPA calls `getPlatform().startPreview({input: FolderRef})` (unchanged call).
2. WebAdapter resolves the root `FileSystemDirectoryHandle` from `input.key`.
3. It reads the `.md` files (FSA `getFile().text()`) in manifest/alpha order and
   the CSS, then runs the **pure** `markdown-it` pipeline to produce the same
   `<body>` HTML `renderChapters` produces. **Reuse, do not reimplement:**
   either (a) import `createMarkdownRenderer` + the body-assembly logic from a
   new **browser-safe entry** the lib exposes (a build that excludes the
   `node:fs` wrapper), or (b) refactor `renderChapters` to take an injected
   `readFile`/`listFiles` so the same function runs with an FSA-backed reader.
   **(b) is preferred** (one code path, satisfies §0/§6-of-CLAUDE "fix the core
   primitive"): split `renderChapters` into `assembleBookHtml({files, readText})`
   (pure) + a thin Node wrapper. The CLI keeps its wrapper; the WebAdapter
   passes an FSA reader.
4. WebAdapter builds the full `book.html` string: the same `<head>` (linked CSS
   inlined or served as Blob URLs), the assembled body, and the paged.js script
   tag pointing at the **app-shell-cached** `/vendor/paged.polyfill.js`.
5. It wraps the HTML in a `Blob` and returns
   `{ url: URL.createObjectURL(blob), port: 0, input: input.key, title }`.
6. The SPA loads it in the **same `<iframe>`** — Paged.js paginates in-browser
   exactly as on desktop. No code change in `+page.svelte`.

> **CSS / asset references inside the iframe.** `book.html` references `css/*`
> and `images/*` by relative URL. A Blob-URL document can't resolve relative
> project paths. Two options, simplest first:
> - **Inline** the project CSS into a `<style>` and rewrite `<img src>` to
>   `blob:`/`data:` URLs the adapter mints from FSA file reads. Good enough for
>   v1 (books are small; this is what `assembleBookHtml` can do directly).
> - Later: register a **`fetch`-handling service worker scope** that resolves
>   `/__project__/<relpath>` against the open FSA handle, and serve the iframe
>   from that scope. Cleaner for large asset sets; deferred.

**`markdown-it-source-map`** and the incremental per-chapter splice are
preview-perf niceties; v1 can full-render (books are small). Keep the
incremental path desktop-only initially.

---

## 3. Delivery hosts: node-backed websites and the CLI `--serve` option

The adapter-node build gives two web delivery shapes for the same SPA; in both,
the browser has no `window.electron`, so `isDesktop()` is false and the
**WebAdapter** is selected — the UI behaves identically regardless of which
host serves it.

### 3a. Node-backed website (adapter-node build, deployed as-is)

The viewer's `build/` output (handler.js + client/ + server/) runs on any Node
host — a VPS, a container, a PaaS. This is a first-class publish target: we
want the UI publishable to node-backed websites, not only as a static PWA.

- The `+server.ts` host-capability routes (api/doctor, api/fs, api/vcs, …) ship
  in the build but look up their hooks from `globalThis`
  (`electron/server-bridge/host-hooks.ts`); on a plain Node host nothing
  registers them, so they return 503/degraded — which the WebAdapter never
  calls anyway (it is pure-browser). They are inert, not harmful.
- **Future option this preserves:** a node-backed deployment MAY later register
  its own server-side hooks (e.g. server-side project storage, a Git proxy for
  #15-on-web, server-rendered PDF export) behind the same routes — the seam
  already exists. Out of scope for this milestone; noted so nobody "cleans up"
  the routes as dead code.
- Updates: redeploy. No SW required (but the SW still registers and gives the
  app-shell offline cache for free — it caches static assets only, so it is
  safe under a node host too).

### 3b. Static/PWA host and the CLI `--serve` convenience option

**Decision: static delivery only — not a runtime backend.** The WebAdapter is
pure-browser; it does not RPC back to the CLI for editing or preview. This is
the Occam's-razor split: one render path (in-browser), one fs path (FSA), no
client/server protocol to design, test, or secure.

**Gap to close first:** the current adapter-node build has **no static
`index.html`** — `+layout.ts` sets `ssr = false` but does not prerender, so the
HTML shell is rendered at request time by `handler.js`. Static/PWA hosting
needs the shell as a file. Minimal fix (keeps one build): add
`export const prerender = true` alongside `ssr = false` in `+layout.ts` —
SvelteKit then emits the empty CSR shell to `build/prerendered/`, and the
static publish artifact is `build/client/` + that shell. (Fallback if
prerendering fights a route: a second `adapter-static` build config used only
for the PWA artifact — more build surface, avoid unless needed.)

What a static host (or the CLI) must serve for the PWA:
- The **client bundle** (`build/client/` — `_app/` + static assets) plus the
  prerendered `index.html` shell described above.
- The **PWA assets**: `manifest.webmanifest`, the service worker, app icons
  (✅ these exist in `static/` and `src/service-worker.ts` today).
- The **vendored Paged.js** (`/vendor/paged.polyfill.js`) and the preview
  helper scripts, so the in-iframe render can load them offline (the SW caches
  them on first load).
- Correct headers: a) MIME types; b) the service worker served at the SPA root
  scope; c) **no** auth — it's a localhost convenience host.

Implementation is small and reuses existing infra: the preview server already
serves static files and `/vendor/*` (`http-server.ts`). Add a CLI flag
(e.g. `print-md serve [--port]` or `print-md preview --pwa`) that points the
existing static server at the viewer client bundle instead of a per-project
temp dir, and serves the manifest/SW. **No new backend endpoints.**

> The PWA is equally hostable from **any** static host (GitHub Pages, a CDN) —
> `--serve` is just the zero-config local option. Hosting it remotely is how
> mobile installs happen without the user running a terminal.

---

## 4. FSA handle persistence + the FolderRef / FileRef key

This is the concrete answer to **why #49/#61 introduced `FolderRef`/`FileRef`**:
on web there are **no path strings** and FSA handles are **not `===`-equal**
across calls, so the app cannot key recents/favorites/dedup on a path or on
object identity. `FolderRef.key` is the **stable opaque id** that works for both
hosts (Electron: the abs path; web: a handle-registry id).

### Persistence mechanism: **IndexedDB stores the handle object directly**
`FileSystemDirectoryHandle`/`FileSystemFileHandle` are **structured-cloneable**,
so they can be `put()` into IndexedDB and retrieved across sessions (Chrome/Edge).
This is the standard, documented FSA persistence pattern (`localStorage` cannot
store handles; IndexedDB can).

Design:
- An IndexedDB DB `print-md` with stores:
  - `handles` — `{ key, handle }` (the persisted FSA handle).
  - `prefs`, `projectStates`, `recents`, `favorites` — replace the userData json.
- **The `key`**: a stable, app-generated opaque id minted when a folder is first
  opened — e.g. `web:` + a UUID, or a digest of `handle.name` + a salt. It is
  **not** derived from any path. Store `{key, handle, displayName: handle.name}`.
  - `FolderRef = { key, displayName: handle.name }`.
  - `FileRef` analogous, for `showOpenFilePicker()` results.
- **Re-opening a recent folder**: look up `handles[key]` → get the handle →
  call `handle.queryPermission({mode:"readwrite"})`; if not `granted`, call
  `handle.requestPermission(...)` (must be inside a user gesture). FSA requires
  a **re-grant gesture** per session — the UI shows a "Reopen <name>" button
  that triggers the permission prompt. Document this in the recents UI.
- **In-memory registry**: a `Map<key, handle>` so within a session the adapter
  resolves `key`→handle without an IndexedDB round-trip.

### Safari (no FSA)
No persistent handles. `persistentFolderAccess:false` → the UI shows
import/export instead of "Reopen". Working copy lives in **OPFS**
(`navigator.storage.getDirectory()`), which *is* persistent and handle-based but
private to the origin (not the user's real folder). Export = download a zip.
`FolderRef.key` = the OPFS sub-path.

---

## 5. Service worker + manifest + offline

### Web app manifest (`static/manifest.webmanifest`)
```jsonc
{
  "name": "print-md",
  "short_name": "print-md",
  "start_url": "./",            // relative — matches paths.relative=true
  "scope": "./",
  "display": "standalone",
  "background_color": "#5a5a5a",
  "theme_color": "#5a5a5a",
  "icons": [ /* 192, 512, maskable */ ]
}
```
Linked from `app.html`. Install criteria (Chrome): served over HTTPS (or
localhost), valid manifest, a registered SW with a `fetch` handler, icons.
Safari installs via "Add to Home Screen" (manifest honored; no `beforeinstallprompt`).

### Service worker — **app-shell precache + runtime cache** (✅ shipped)
SvelteKit exposes `$service-worker` (`build`, `files`, `version`) under
adapter-node as well. `src/service-worker.ts` exists and implements:
- **Precache** the app shell on `install`: all `build` assets (`_app/*`),
  `index.html`, the vendored `paged.polyfill.js`, icons. This satisfies the
  acceptance criterion "service worker caches app shell for offline use".
- **Runtime**: cache-first for the precached shell; network-first (with cache
  fallback) for anything else. **Do not** cache project file *contents* — those
  come from FSA/OPFS, not the network.
- **Update flow** = the PWA's auto-update story: on a new `version`, `install`
  precaches the new shell, `activate` deletes old caches; prompt-to-reload or
  reload-on-next-launch. Keep `updater.*` rejecting on web — the SW owns web
  updates.

### Coexistence with the desktop build + electron-updater
- The SW is just another static asset in the build. `paths.relative=true`
  already makes the bundle origin-agnostic.
- **Electron must NOT register the SW** (✅ enforced in `+layout.svelte`:
  registration is gated on `!isDesktop()`). The desktop app's UI ships inside
  the installer and updates **as a whole app via electron-updater**; a SW under
  `app://` would serve stale cached assets across app updates. So:
  - **Desktop** = `app://` + electron-updater full-app updates.
  - **Node-backed website** = HTTP(S), updates by redeploy (SW shell-cache is a
    harmless bonus).
  - **Web/PWA** = HTTP(S) + service-worker cache + SW update.
  Non-overlapping update mechanisms selected by the same `isDesktop()` seam
  that selects the adapter.

---

## 6. PDF / build gating (acceptance criterion)

The seam already exists; wire the UI to it:
- `capabilities().nativeSavePath === false` on web (already in the stub).
- The "Save PDF" / export control reads `getPlatform().capabilities()` (and/or
  `isDesktop()`) and **hides or disables** the PDF option on web, showing
  "PDF export requires the desktop app." (acceptance: "'Save PDF' button hidden
  or shows 'requires desktop' message on mobile").
- `build({format:"html"})` **is** allowed on web: render in-browser, return
  `{ downloadUrl }` (the `BuildResult.downloadUrl` field exists for exactly
  this — a browser download), and the adapter triggers an `<a download>`.
- `build({format:"pdf"|"pdfx"})` and `savePdf` keep rejecting; the UI never
  offers them on web. No puppeteer, no `printToPDF` in the browser.

---

## 7. Phased implementation plan

Each phase is independently shippable and testable. TDD seam noted per phase.
The WebAdapter is exercised in `vite dev` / a plain browser (no preload) and in
unit tests with FSA/IndexedDB mocks.

### Phase 1 — Load + open one folder + read/edit a file (smallest vertical slice) — 🟡 partially shipped
> Status: `WebAdapter.openFolder` (`showDirectoryPicker`) and the adapter
> selection seam are implemented; audit the remaining fs primitives
> (`readFile`/`writeFile`/`listDir`/`statFile`) against the current
> `web-adapter.ts` before scheduling the remainder.
**Goal:** app loads in Chrome with `WebAdapter` selected; user opens a folder via
`showDirectoryPicker()`; file list shows; opening a `.md` reads it; saving writes
it back. No preview, no SW, no persistence.
- Implement: handle-registry + `openFolder`, `readFile`, `writeFile`, `listDir`,
  `statFile`, `listProjectFiles`; `capabilities()` (FSA detection); `getStatus`
  (`runtime:"web"`); `classifyProject`→`local-folder`.
- **TDD:** unit tests against a mocked FSA (`showDirectoryPicker`/handle entries);
  assert FolderRef shape, relpath resolution, write→re-stat mtime. A Playwright
  smoke test: `vite dev`, the app boots without `window.electron` and renders the
  welcome screen (no thrown "not implemented").

### Phase 2 — In-browser preview render (no server, no Chromium) — 🟡 partially shipped
> Status: `WebAdapter.startPreview`/`stopPreview` with the Blob-URL approach
> exist in `web-adapter.ts`; verify `assembleBookHtml` parity coverage before
> closing this phase.
**Goal:** "Preview renders correctly at mobile viewport sizes."
- Refactor `renderChapters` → pure `assembleBookHtml({files, readText, …})` +
  Node wrapper (CLI unchanged). Expose `assembleBookHtml` from a browser-safe
  lib entry **or** keep it host-side in the WebAdapter (no SPA import — §8).
- Implement WebAdapter `startPreview` (FSA read → assemble → Blob URL) +
  `stopPreview` (revoke). Inline CSS, rewrite `<img>` to blob/data URLs.
- **TDD:** unit test `assembleBookHtml` parity (same HTML for the same inputs as
  the Node path, on a fixture book). Playwright: load a fixture folder, assert
  the iframe `book.html` body contains a sentinel and `renderingComplete` fires.

### Phase 3 — Persistence (IndexedDB) + recents/favorites/prefs/project-state
**Goal:** reopen a previously opened folder across sessions.
- IndexedDB stores; persist handles; `getRecentFolders/getFavorites/...`,
  `getViewerPrefs/...`, `getViewerProjectState/...`, `getLastProject`.
- Permission re-grant gesture UI for reopening.
- **TDD:** unit tests with `fake-indexeddb`; assert handle round-trips, key
  stability, `queryPermission`/`requestPermission` flow (mocked).

### Phase 4 — PWA manifest + service worker + offline + install — 🟡 mostly shipped
**Goal:** "installable from Chrome/Safari," "SW caches app shell for offline."
- ✅ Manifest, icons, `src/service-worker.ts` (precache shell + paged.js),
  registration gated on `!isDesktop()` — all in the tree today.
- ⬜ **Prerendered static shell** (§3b gap): add `prerender = true` to
  `+layout.ts` so a static host has an `index.html` to serve.
- ⬜ CLI `serve`/`--pwa` static host for the client bundle + manifest/SW/vendor.
- **TDD:** Lighthouse PWA audit (installability) in CI; Playwright offline test
  (go offline, reload, shell still loads). Unit-test SW precache list includes
  `paged.polyfill.js`.

### Phase 5 — HTML export + PDF gating + polish
**Goal:** acceptance "Save PDF hidden/disabled on web"; HTML download works.
- WebAdapter `build({format:"html"})`→`{downloadUrl}`; UI download trigger.
- Wire export UI to `capabilities()`; hide PDF on web.
- `openExternal`→`window.open`; `setDirtyState`→`beforeunload` guard in the
  SPA-host seam; `getStatus` polish.
- **TDD:** unit test build-as-HTML download; Playwright assert PDF control hidden
  when adapter is web.

### Phase 6 (out of milestone, noted) — Safari import/export fallback
OPFS working copy, `<input webkitdirectory>` import, zip export, all-false
`capabilities()`. Ship after Chrome/Edge path is solid.

---

## 8. Open questions / risks

1. **Safari FSA gap (highest).** Safari has no `showDirectoryPicker`/persistent
   handles. The Phase-6 OPFS+import/export fallback is meaningfully different UX
   (no live edit-in-place of the user's real folder). **Product decision:** is a
   read/import → edit-in-OPFS → export-zip flow acceptable for Safari/iOS in
   this milestone, or is Chrome/Edge-only acceptable for v1 with Safari
   documented as "view/import only"? Issue #33 lists Safari as a fallback, not
   parity — recommend documenting the limitation and shipping Chrome/Edge first.
2. **FSA permission re-grant friction.** Every session requires a user gesture to
   re-authorize a persisted handle. Recents become "click to reopen," not
   silent. Acceptable, but a UX decision for the recents panel copy.
3. **iframe asset resolution.** Inlining CSS + blob-URL images is fine for small
   books; large image sets may want the SW-scoped `/__project__/` resolver
   (deferred). Confirm typical book asset sizes before committing to inline-only.
4. **CORS / Git remote.** Out-of-scope this milestone, but note for #15-on-web:
   isomorphic-git in a browser needs a **CORS proxy** for most remotes
   (GitHub blocks browser CORS for the smart-HTTP protocol). This is why sync
   stays desktop-only; revisit only with a hosted proxy decision.
5. **Security (FSA permissions).** FSA grants are origin-scoped and revocable;
   the app must handle a handle whose permission was revoked (re-prompt, or drop
   from recents). The handle registry must never leak across origins (it can't —
   IndexedDB is origin-scoped). No secrets in IndexedDB.
6. **`localStorage` vs IndexedDB for settings.** The stub uses `localStorage`;
   the plan moves prefs/recents to IndexedDB (handles require it). Decide whether
   to consolidate settings into IndexedDB too, or keep settings in localStorage
   (simpler, already working) and only handles/recents in IndexedDB. Recommend
   the latter (minimal churn).
7. **`apiVersion` on web.** The `DESKTOP_API` constant now lives inline in
   `electron/preload.ts` (the old `updater/contract.ts` home was deleted with
   the hot-swap updater); the WebAdapter reports `0`. Confirm the SPA branches
   that read `apiVersion` tolerate the web value before Phase 1 closes.
8. **Service worker vs `app://` collision.** Verified safe by gating SW
   registration on `!isDesktop()` (implemented in `+layout.svelte`), but add a
   regression test that the desktop build never registers a SW — it would
   serve stale cached assets across electron-updater full-app updates.
