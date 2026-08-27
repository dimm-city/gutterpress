# SFE-P0a — Desktop Platform and Transport Surface Inventory

> Lane C deliverable for run `SFE-P0a` (see
> `docs/plans/source-first-editor/runs/SFE-P0a.md`, behavior-table rows
> "Platform surface" / "Transport surface", both owned by Lane C, both
> `doc`-only — no test files are part of this run's Lane C deliverable).
>
> Purpose: give every P5 deletion subrun (P5a WebAdapter deletion, P5b
> Platform narrowing, P5c1–P5c4 route migration groups, P5d server deletion —
> D10) a section listing exactly the identifiers its search proofs must drive
> to zero, per D15 ("every deletion claim requires search proof, dependency
> proof, and passing behavior tests").
>
> Every count below carries the exact command used to produce it. Every
> command returned at least one match (liveness — lesson AP-21); a rerun that
> returns zero for a **feature** row is a fixture/repo-state error, not a
> silent pass. Counts are current-tree, not baseline-SHA-pinned — later
> P5 runs must re-run the commands against their own working tree rather than
> diff against the numbers recorded here.
>
> Scope: `packages/desktop` only. This document does not cover
> `packages/cli`'s preview HTTP server (`packages/cli/src/preview/http-server.ts`)
> — D10 explicitly leaves the standalone CLI preview server unchanged.

---

## 1. `PlatformAdapter` — narrow host-divergent primitives (owned by `gutterpress`)

Source: `packages/cli/src/platform.ts` (`export interface PlatformAdapter`).
Command: `grep -n "PlatformAdapter" packages/desktop/src/lib/platform/contract.ts`
confirms the desktop imports this type rather than redeclaring it (`import
type { PlatformAdapter, ... } from "gutterpress"`).

9 members (1 discriminant + 8 methods):

| Bounded context | Member | Signature | Notes |
|---|---|---|---|
| meta | `platform` | `readonly "electron" \| "web"` | discriminant for the one unavoidable host branch |
| dialog | `openFolder()` | `Promise<string \| null>` | `Platform` (below) overrides this to return `FolderRef`, not the raw string |
| fs | `readFile(path)` | `Promise<string>` | |
| fs | `writeFile(path, content)` | `Promise<FileWriteResult>` | |
| fs | `listDir(path)` | `Promise<Array<{name,path,isDir}>>` | |
| fs | `statFile(path)` | `Promise<FileStat>` | |
| fs / events | `watchFolder(path, cb)` | `() => void` (unsubscribe) | web has no general recursive watch primitive |
| secrets | `getSecret(key)` | `Promise<string \| null>` | scaffolding only — no live implementation on either adapter (#12) |
| secrets | `setSecret(key, value)` | `Promise<void>` | scaffolding only — same as above |

`getSecret`/`setSecret` implementation status: **both** `ElectronAdapter` and
`WebAdapter` throw `"... is not implemented yet"` — this primitive has zero
working implementation on any host today (`packages/desktop/src/lib/platform/electron-adapter.ts:89-99`,
`packages/desktop/src/lib/platform/web-adapter.ts:402-408`).

---

## 2. `HostServices` — desktop-only host RPC surface

Source: `packages/desktop/src/lib/platform/contract.ts`, `export interface
HostServices` (lines 361-455).
Command: `awk '/export interface HostServices/,/^}/' packages/desktop/src/lib/platform/contract.ts | grep -cE "^\s*[a-zA-Z].*\(.*\)|^\s*readonly [a-zA-Z]+:"` → **21**.

| Bounded context | Member(s) | Push or request/reply |
|---|---|---|
| meta | `apiVersion` | value (readonly) |
| updater | `updater` (`UpdaterApi`: `getStatus`, `check`, `download`, `applyNow`, `onEvent`) | mixed — `applyNow` request/reply, `onEvent` push, `getStatus`/`check`/`download` are HostServices members but actually implemented via `api.updater.*` HTTP routes on Electron (see §4/§6) |
| meta | `capabilities()` | request/reply (synchronous, adapter-synthesized — never an IPC/HTTP call) |
| theme / events | `onNativeThemeUpdated(cb)` | push |
| app-launch / events | `onOpenMarkdownFile(cb)` | push (with a `ready`-handshake request baked into the Electron implementation) |
| vcs | `saveSnapshot(dir, msg?)` | request/reply |
| remote / github | `connectGitHubStart()` | request/reply |
| remote / github | `connectGitHubWait()` | request/reply |
| remote / github | `connectGitHubCancel()` | request/reply |
| remote | `cloneRemoteRepository(args)` | request/reply |
| remote / events | `onCloneProgress(cb)` | push |
| sync / events | `onSyncStatus(cb)` | push |
| sync | `setAutoSync(enabled)` | request/reply |
| preview/build | `startPreview(args)` | request/reply |
| preview/build | `stopPreview()` | request/reply |
| preview/build | `cancelExport(id)` | request/reply |
| preview/build | `build(args)` | request/reply |
| preview/build / events | `onBuildProgress(cb)` | push |
| preview/build / events | `onUrlPreviewBlocked(cb)` | push |
| fs / events | `onFlushBeforeClose(cb)` | push (main asks) + implicit reply (`app:flushDone`) |
| fs / events | `onFolderChanged(cb)` | push |

`Platform = Omit<PlatformAdapter, "openFolder"> & HostServices`, plus its own
`openFolder(): Promise<FolderRef | null>` override — **30 members total**.

---

## 3. Adapter implementation matrix

### 3.1 `ElectronAdapter` (`packages/desktop/src/lib/platform/electron-adapter.ts`, 245 lines)

Implements every one of the 30 `Platform` members with **no extra members
beyond the contract**. Delegation split:

| Delegates to | Members |
|---|---|
| `bridge()` (raw `window.electron` IPC) | `watchFolder`, `updater.applyNow`/`onEvent`, `onNativeThemeUpdated`, `onOpenMarkdownFile`, `connectGitHubStart/Wait/Cancel`, `onCloneProgress`, `onSyncStatus`, `startPreview`, `stopPreview`, `cancelExport`, `build`, `onBuildProgress`, `onUrlPreviewBlocked`, `onFlushBeforeClose`, `onFolderChanged`, `apiVersion` |
| `api.*` (HTTP routes, `$lib/api.ts`) | `openFolder`→`api.dialog.openDirectory`, `readFile`→`api.fs.readFile`, `writeFile`→`api.fs.writeFile`, `listDir`→`api.fs.listDir`, `statFile`→`api.fs.statFile`, `updater.getStatus/check/download`, `saveSnapshot`→`api.vcs.saveSnapshot`, `cloneRemoteRepository`→`api.remote.cloneRepository`, `setAutoSync`→`api.sync.setAutoSync` |
| throws (scaffolding, #12) | `getSecret`, `setSecret` |
| synthesized locally | `capabilities()` (`{nativeSavePath:true, showInFolder:true, persistentFolderAccess:true}`) |

This is the live, load-bearing adapter — every method above is reachable from
real desktop UI code (see §7).

### 3.2 `WebAdapter` (`packages/desktop/src/lib/platform/web-adapter.ts`, 888 lines)

Selected only when `window.electron` is absent (`getPlatform()` in
`packages/desktop/src/lib/platform/index.ts:54-59`) — i.e. `vite dev` with no
preload, or a hypothetical browser PWA build. **Never selected in the
packaged Electron app.**

Classification of its ~55 public methods against the **current** `Platform`
contract:

**(a) Real implementations of current `Platform` members** (genuine browser
code, dormant only because nothing in the live Electron-targeted SPA calls
`getPlatform()` for them on this host):

| Member | Backing |
|---|---|
| `openFolder` | File System Access `showDirectoryPicker` |
| `readFile`/`writeFile`/`listDir`/`statFile` | `web-fs.ts` FSA primitives |
| `capabilities()` | `hasFsa()` feature probe |
| `getNativeTheme`/`onNativeThemeUpdated`* | `matchMedia` | 
| `startPreview`/`stopPreview`/`build` (html only) | in-browser `assembleBookHtml` from `gutterpress/render` |
| `connectGitHubCancel` | resolves `{ok:true}` (no in-flight state to cancel client-side) |

`getNativeTheme` is not a `Platform` member (see 3.3) but is exercised by
`onNativeThemeUpdated`, which is.

**(b) Reject/no-op stubs for current `Platform` members** (contract requires
the member; browser has no behavior yet):

| Member | Behavior |
|---|---|
| `getSecret`/`setSecret` | throw (same as Electron — #12 unimplemented everywhere) |
| `watchFolder` | no-op unsubscribe (`() => {}`) — "no FS-watch API on the web" |
| `connectGitHubStart`/`connectGitHubWait` | reject |
| `cloneRemoteRepository` | reject |
| `onCloneProgress`/`onSyncStatus`/`onBuildProgress`/`onUrlPreviewBlocked`/`onOpenMarkdownFile`/`onFlushBeforeClose`/`onFolderChanged` | no-op unsubscribe, never emit |
| `setAutoSync` | resolves silently (no-op) |
| `saveSnapshot` | reject |
| `cancelExport` | reject |
| `build` (pdf/pdfx) | throws explicit "desktop-only" message |
| `apiVersion` | `0` (constant) |
| `updater.*` | all reject except `onEvent` (no-op) |

**(c) Methods that are NOT part of the current `Platform`/`HostServices`
contract at all** — dead weight relative to the interface `WebAdapter`
declares (`implements Platform`; TypeScript does not flag extra members).
Every one of these was migrated to a desktop-only HTTP route (comments in the
file itself say so: `"migrated to server routes"`) and now exists **only**
because `WebAdapter` is retained as PWA scaffolding:

`reopenFolder`, `savePdf`, `pickImageFile`, `copyFile`, `pickImageFiles`,
`openExternal`, `showInFolder`, `readLogFile`, `getLastProject`,
`listProjectFiles`, `getDesktopPrefs`, `setDesktopPrefs`,
`getDesktopProjectState`, `setDesktopProjectState`, `getSettings`,
`setSettings`, `getNativeTheme`, `getRecentFolders`, `getFavorites`,
`toggleFavorite`, `removeRecent`, `discoverProjects`, `classifyProject`,
`createProject`, `adoptFolder` — **25 methods**, none reachable through
`getPlatform()` on the shipping Electron target (the SPA calls `api.app.*` /
`api.dialog.*` etc. directly for every one of these — see §5). `reopenFolder`
is additionally called out in `contract.ts`'s own comment: "removed from
`HostServices`... The `WebAdapter` retains its implementation for the FSA
permission re-grant flow."

Command used to enumerate 3.2(c): manual diff of `WebAdapter`'s public method
names (`grep -nE "^\s+(async )?[a-zA-Z]+\(" packages/desktop/src/lib/platform/web-adapter.ts`)
against the 30 `Platform` member names in §1/§2. This diff is exactly the
search proof P5a's WebAdapter-deletion review must reproduce.

### 3.3 `web-fs.ts` (279 lines) / `web-store.ts` (167 lines)

Both are pure-browser, zero-Node helper modules with **no purpose other than
backing `WebAdapter`**:

- `web-fs.ts` exports `registerHandle`, `reRegisterHandle`, `resolveHandle`,
  `resetRegistry`, `splitPath`, `readFileFromRoot`, `writeFileToRoot`,
  `listDirFromRoot`, `statFileFromRoot`, `listProjectFilesFromRoot`,
  `hasFsa` — all consumed only from `web-adapter.ts`.
- `web-store.ts` exports `WebStore` (interface), `InMemoryWebStore`,
  `IndexedDbWebStore`, `WEB_STORE_NAMES` — `InMemoryWebStore` is also
  imported directly by `packages/desktop/tests/platform/adapter.test.ts` and
  `web-adapter-persistence.test.ts` as a test double.

Command: `grep -rln "from \"./web-fs\"\|from './web-fs'" packages/desktop/src packages/desktop/tests` →
only `web-adapter.ts`. `grep -rln "web-store" packages/desktop/src packages/desktop/tests` →
`web-adapter.ts`, `platform/index.ts` (type-only re-export), plus the two test
files named above.

---

## 4. `ElectronBridge` — the raw `window.electron` shape

`packages/desktop/src/lib/platform/contract.ts:492-527`. Differs from
`HostServices` by omission (`startPreview`/`build` keep raw path strings,
`capabilities` is adapter-synthesized so it's omitted entirely, `setAutoSync`/
`cloneRemoteRepository`/`updater.getStatus`/`updater.check`/`updater.download`
moved to HTTP routes) plus one addition not in `HostServices`: raw
`watchFolder(path, cb)`.

---

## 5. `api.ts` — typed HTTP client (`packages/desktop/src/lib/api.ts`, 723 lines)

21 namespaces, each method mapped 1:1 to a route path. Full mapping (method →
route):

| Namespace | Methods → routes |
|---|---|
| `dialog` | `openDirectory`→`/api/dialog/open-directory`, `savePdf`→`/api/dialog/save-pdf`, `pickImageFile`→`/api/dialog/pick-image-file`, `pickPdfFile`→`/api/dialog/pick-pdf-file`, `pickImageFiles`→`/api/dialog/pick-image-files` |
| `shell` | `openExternal`→`/api/shell/open-external`, `showInFolder`→`/api/shell/show-in-folder` |
| `log` | `read`→`/api/log/read`, `list`→`/api/log/list` |
| `fs` | `readFile`→`/api/fs/read-file`, `writeFile`→`/api/fs/write-file`, `statFile`→`/api/fs/stat-file`, `listDir`→`/api/fs/list-dir`, `listProjectFiles`→`/api/fs/list-project-files`, `createFile`→`/api/fs/create-file`, `createFolder`→`/api/fs/create-folder`, `renamePath`→`/api/fs/rename`, `deletePath`→`/api/fs/delete` |
| `app` | `getDesktopPrefs`→`/api/app/gutterpress-prefs` (GET), `setDesktopPrefs`→same (POST), `getDesktopProjectState`→`/api/app/gutterpress-project-state/get`, `setDesktopProjectState`→`.../set`, `getSettings`→`/api/app/settings` (GET), `setSettings`→same (POST), `getNativeTheme`→`/api/app/native-theme`, `getRecentFolders`→`/api/app/recent-folders`, `getFavorites`→`/api/app/favorites`, `toggleFavorite`→`/api/app/favorites/toggle`, `removeRecent`→`/api/app/recent/remove`, `discoverProjects`→`/api/app/discover-projects`, `classifyProject`→`/api/app/classify-project`, `createProject`→`/api/app/create-project`, `adoptFolder`→`/api/app/adopt-folder`, `setDirtyState`→`/api/app/dirty-state`, `recordFlushFailure`/`acknowledgeFlushFailure`→`/api/app/flush-failure`, `appImageIntegration.getStatus/install/remove`→`/api/app/appimage-integration` |
| `media` | `listImages`→`/api/media/list-images`, `thumbnail`→`/api/media/thumbnail`, `inspect`→`/api/media/inspect`, `importImage`→`/api/media/import-image` |
| `lint` | `checkCss`→`/api/lint/check-css`, `project`→`/api/lint/project` |
| `tpl` | `listBuiltIn`→`/api/tpl/built-in`, `listCustom`→`/api/tpl/custom`, `saveAsTemplate`→`/api/tpl/save-as-template`, `importFromFolder`→`/api/tpl/import-from-folder` |
| `snip` | `list`→`/api/snip/list`, `read`→`/api/snip/read`, `save`→`/api/snip/save`, `delete`→`/api/snip/delete` |
| `plugin` | `list`→`/api/plugin/list`, `setEnabled`→`/api/plugin/set-enabled`, `addNpm`→`/api/plugin/add-npm`, `addLocal`→`/api/plugin/add-local`, `validate`→`/api/plugin/validate`, `recommended`→`/api/plugin/recommended` |
| `theme` | `listBuiltIn`→`/api/theme/built-in`, `listProject`→`/api/theme/project`, `getActive`→`/api/theme/active`, `apply`→`/api/theme/apply`, `importFromFolder`→`/api/theme/import-from-folder`, `importFromFile`→`/api/theme/import-from-file`, `importFromUrl`→`/api/theme/import-from-url`, `readCss`→`/api/theme/read-css`, `remove`→`/api/theme/remove`, `getPrevious`→`/api/theme/previous`, `revert`→`/api/theme/revert` |
| `project` | `listStyles`→`/api/project/list-styles` |
| `manifest` | `read`→`/api/manifest/read`, `setFields`→`/api/manifest/set-fields` |
| `style` | `setActive`→`/api/style/set-active` |
| (top-level) | `doctor()`→`/api/doctor` |
| `recovery` | `write`→`/api/recovery/write`, `clear`→`/api/recovery/clear`, `list`→`/api/recovery/list` |
| `sync` | `setAutoSync`→`/api/sync/set-auto-sync`, `getStatus`→`/api/sync/status` |
| `vcs` | `enableVersionHistory`→`/api/vcs/enable-version-history`, `listSnapshotsPage`→`/api/vcs/list-snapshots-page`, `restoreSnapshot`→`/api/vcs/restore-snapshot`, `saveSnapshot`→`/api/vcs/save-snapshot` |
| `remote` | `disconnectGitHub`→`/api/remote/disconnect-github`, `getRemoteConnection`→`/api/remote/get-connection`, `listRemoteRepositories`→`/api/remote/list-repositories`, `listRemoteBranches`→`/api/remote/list-branches`, `listRepoBooks`→`/api/remote/list-repo-books`, `diagnoseProjectRemote`→`/api/remote/diagnose-project`, `testRemoteAccess`→`/api/remote/test-remote-access`, `connectGenericHost`→`/api/remote/connect-generic-host`, `disconnectHost`→`/api/remote/disconnect-host`, `listHostConnections`→`/api/remote/list-connections`, `forgeTokenUrl`→`/api/remote/forge-token-url`, `syncChanges`→`/api/remote/sync`, `cloneRepository`→`/api/remote/clone-repository` |
| `updater` | `getStatus`→`/api/updater/get-status` (GET), `check`→`/api/updater/check`, `download`→`/api/updater/download` |
| `publish` | `listProviders`→`/api/publish/list`, `providers`→`/api/publish/providers`, `connect`→`/api/publish/connect`, `disconnect`→`/api/publish/disconnect`, `setConfig`→`/api/publish/set-config`, `preflight`→`/api/publish/preflight`, `run`→`/api/publish/run` |

Two routes have **no `api.ts` wrapper at all** (dead client-side, route kept
alive intentionally): `/api/status` (health-check GET, comment: "harmless to
keep reachable even with no current client") and `/api/fs/copy-file`
(comment: "retained deliberately: it still guards the shared picker-capability
+ fs-guard path and carries that mechanism's security regression tests" — the
SPA calls `api.media.importImage` instead).

---

## 6. Full route tree (`packages/desktop/src/routes/api/**/+server.ts`)

Command: `find packages/desktop/src/routes/api -name '+server.ts' | wc -l` → **104**.

Per-namespace counts. Command:
`find packages/desktop/src/routes/api -name '+server.ts' | sed -E 's|packages/desktop/src/routes/api/||; s|/\+server\.ts$||' | awk -F/ '{print $1}' | sort | uniq -c | sort -rn`

| Namespace | Route count |
|---|---:|
| `app` | 16 |
| `remote` | 13 |
| `theme` | 11 |
| `fs` | 10 |
| `publish` | 7 |
| `plugin` | 6 |
| `dialog` | 5 |
| `vcs` | 4 |
| `tpl` | 4 |
| `snip` | 4 |
| `media` | 4 |
| `updater` | 3 |
| `recovery` | 3 |
| `sync` | 2 |
| `shell` | 2 |
| `manifest` | 2 |
| `log` | 2 |
| `lint` | 2 |
| `style` | 1 |
| `status` | 1 |
| `project` | 1 |
| `doctor` | 1 |
| **Total** | **104** |

(Sum check: 16+13+11+10+7+6+5+4+4+4+4+3+3+2+2+2+2+2+1+1+1+1 = 104.)

Full path listing (grouped) — reproduce with:
`find packages/desktop/src/routes/api -name '+server.ts' | sort`

<details>
<summary>All 104 route files</summary>

```
app/adopt-folder, app/appimage-integration, app/classify-project,
app/create-project, app/dirty-state, app/discover-projects, app/favorites,
app/favorites/toggle, app/flush-failure, app/gutterpress-prefs,
app/gutterpress-project-state/get, app/gutterpress-project-state/set,
app/native-theme, app/recent-folders, app/recent/remove, app/settings
dialog/open-directory, dialog/pick-image-file, dialog/pick-image-files,
dialog/pick-pdf-file, dialog/save-pdf
doctor
fs/copy-file, fs/create-file, fs/create-folder, fs/delete, fs/list-dir,
fs/list-project-files, fs/read-file, fs/rename, fs/stat-file, fs/write-file
lint/check-css, lint/project
log/list, log/read
manifest/read, manifest/set-fields
media/import-image, media/inspect, media/list-images, media/thumbnail
plugin/add-local, plugin/add-npm, plugin/list, plugin/recommended,
plugin/set-enabled, plugin/validate
project/list-styles
publish/connect, publish/disconnect, publish/list, publish/preflight,
publish/providers, publish/run, publish/set-config
recovery/clear, recovery/list, recovery/write
remote/clone-repository, remote/connect-generic-host,
remote/diagnose-project, remote/disconnect-github, remote/disconnect-host,
remote/forge-token-url, remote/get-connection, remote/list-branches,
remote/list-connections, remote/list-repo-books, remote/list-repositories,
remote/sync, remote/test-remote-access
shell/open-external, shell/show-in-folder
snip/delete, snip/list, snip/read, snip/save
status
style/set-active
sync/set-auto-sync, sync/status
theme/active, theme/apply, theme/built-in, theme/import-from-file,
theme/import-from-folder, theme/import-from-url, theme/previous,
theme/project, theme/read-css, theme/remove, theme/revert
tpl/built-in, tpl/custom, tpl/import-from-folder, tpl/save-as-template
updater/check, updater/download, updater/get-status
vcs/enable-version-history, vcs/list-snapshots-page,
vcs/restore-snapshot, vcs/save-snapshot
```

</details>

---

## 7. `electron/preload.ts` — `contextBridge` surface

`window.electron` (`DESKTOP_API = 5`). Every push subscription funnels through
one helper, `forwardPush(channel, cb)` (lines 82-100) — the search proof for
"every main→renderer subscription is safe-wrapped" is `grep -c "forwardPush(" packages/desktop/electron/preload.ts` → currently **10** call sites over
**9 distinct channels**: `fs:folderChanged` is wrapped twice — once inside
`watchFolder` (line 144) and once as the standalone `onFolderChanged`
subscription (line 281) — every other channel is wrapped exactly once.

| Bridge member | Kind | IPC channel(s) |
|---|---|---|
| `apiVersion` | value | n/a |
| `updater.applyNow` | request/reply | `updater:applyNow` |
| `updater.onEvent` | push | `updater:event` |
| `watchFolder(path, cb)` | request/reply + push | invokes `fs:watchFolder`/`fs:unwatchFolder`, subscribes push `fs:folderChanged` |
| `onNativeThemeUpdated` | push | `app:nativeThemeUpdated` |
| `onOpenMarkdownFile` | push + handshake reply | push `app:openMarkdownFile`, invokes `app:openMarkdownFileReady` |
| `connectGitHubStart` | request/reply | `remote:connectGitHubStart` |
| `connectGitHubWait` | request/reply | `remote:connectGitHubWait` |
| `connectGitHubCancel` | request/reply | `remote:connectGitHubCancel` |
| `onCloneProgress` | push | `remote:cloneProgress` |
| `onSyncStatus` | push | `sync:status` |
| `startPreview` | request/reply | `api:preview` |
| `stopPreview` | request/reply | `api:stopPreview` |
| `cancelExport` | request/reply | `api:cancelExport` |
| `build` | request/reply | `api:build` |
| `onBuildProgress` | push | `build:progress` |
| `onUrlPreviewBlocked` | push | `url-preview:blocked` |
| `onFlushBeforeClose` | push + reply | push `app:flushBeforeClose`, invokes `app:flushDone` |
| `onFolderChanged` | push | `fs:folderChanged` |

**Push channels: 9** (`updater:event`, `fs:folderChanged`,
`app:nativeThemeUpdated`, `app:openMarkdownFile`, `remote:cloneProgress`,
`sync:status`, `build:progress`, `url-preview:blocked`,
`app:flushBeforeClose`).
**Request/reply channels invoked from preload: 12** (`updater:applyNow`,
`fs:watchFolder`, `fs:unwatchFolder`, `app:openMarkdownFileReady`,
`remote:connectGitHubStart`, `remote:connectGitHubWait`,
`remote:connectGitHubCancel`, `api:preview`, `api:stopPreview`,
`api:cancelExport`, `api:build`, `app:flushDone`).

---

## 8. `ipcMain` registrations across `packages/desktop/electron/**`

All `ipcMain.handle` calls in `main.ts` go through one wrapper, `secureHandle`
(`packages/desktop/electron/main.ts:975-987`) — a "drop-in replacement for
`ipcMain.handle`" that rejects any invocation whose `event.senderFrame.url`
isn't the trusted app/dev-server origin. Command: `grep -rn "ipcMain\.handle("
packages/desktop/electron/` → **2 raw-text hits**, only **1** of which is real
code — `main.ts:981` (the `secureHandle` definition itself); the other is a
doc-comment mention in `preload.ts:20` ("Bump ONLY when an ipcMain.handle()
method..."), not a call. **No raw `ipcMain.on(` calls exist anywhere** —
command: `grep -rn "ipcMain\.on(" packages/desktop/electron/` → 0 hits (a
future P5 IPC-migration search proof for "no channel bypasses `secureHandle`"
should assert both of these stay true: exactly one *real* `ipcMain.handle(`
call sitewide — comment mentions aside — and it is the `secureHandle`
definition itself).

`secureHandle("channel", ...)` registrations — command:
`grep -rn 'secureHandle(\s*"' packages/desktop/electron/`:

| Channel | File:line |
|---|---|
| `fs:watchFolder` | `main.ts:996` |
| `fs:unwatchFolder` | `main.ts:1027` |
| `remote:connectGitHubStart` | `main.ts:1346` |
| `remote:connectGitHubWait` | `main.ts:1354` |
| `remote:connectGitHubCancel` | `main.ts:1358` |
| `api:preview` | `main.ts:1548` |
| `api:stopPreview` | `main.ts:1550` |
| `api:cancelExport` | `main.ts:1552` |
| `api:build` | `main.ts:1586` |
| `updater:applyNow` | `main.ts:1628` |
| `app:openMarkdownFileReady` | `main.ts:1667` |
| `app:flushDone` | `main.ts:1046` |

**12 `secureHandle` registrations total** — exactly matching the 12
request/reply channels the preload invokes (§7), confirming no orphaned
handler and no unregistered invoke.

Push channels are sent through a second single choke point, `safeSend(channel,
...args)` (`main.ts:572-576`, guards `mainWindow && !mainWindow.isDestroyed()`)
or the `AppHooks.sendToRenderer` hook that wraps it for server-route callers.
Command: `grep -rn 'safeSend(\s*"' packages/desktop/electron/main.ts`:

| Channel | File:line |
|---|---|
| `sync:status` | `main.ts:450` |
| `fs:folderChanged` | `main.ts:477` |
| `url-preview:blocked` | `main.ts:621` |
| `app:nativeThemeUpdated` | `main.ts:812` |
| `build:progress` | `main.ts:939` |
| `remote:cloneProgress` | `main.ts:1281` |
| `app:openMarkdownFile` | `main.ts:1664` |
| `updater:event` | `main.ts:1608` |

Plus `app:flushBeforeClose`, sent directly via `mainWindow.webContents.send`
(not through `safeSend`) at `main.ts:667` — a candidate follow-up finding (not
a P0a deletion target) for a later hygiene pass: this is the one push site
that bypasses the `safeSend` choke point AP-30/AP-32 would flag if `main.ts`
is touched again before P5.

---

## 9. `electron/sveltekit-host.ts` — the loopback server P5d deletes

236 lines. Symbols P5d's search proofs must drive to zero (i.e. `grep -rn
"<symbol>" packages/desktop/electron packages/desktop/src` must return no
hits once D10's "After the last route migration" steps are complete):

| Symbol | Role |
|---|---|
| `startSvelteKitServer` | boots the adapter-node `handler.js` on `127.0.0.1:<os-assigned port>` |
| `__setSkServerPortForTests` | test seam for the module-level `skServerPort` |
| `skServerPort` | module-level port cache |
| `AUTH_HEADER` (`"x-gutterpress-token"`) | bearer-token header name |
| `isAuthorizedRequest` | pure header-check predicate |
| `withTokenAuth` | wraps the adapter-node handler with a 401-on-missing-token gate |
| `getSvelteKitHandlerPath` | resolves `build/handler.js` (packaged vs dev path) |
| `buildHostErrorPage` | 503/502 HTML shown in the `app://` window on server-not-ready/proxy-failure |
| `buildProxyRequest` | rewrites an incoming `app://local/...` request to `http://127.0.0.1:<port>/...` + injects the bearer token |
| `registerAppProtocol` | the `app://` protocol handler: hostname allowlist (`"local"` only) + proxy dispatch |
| `HTML_HEADERS` | constant used by the two error-page responses |

Call sites outside this file — command: `grep -rn
"startSvelteKitServer\|registerAppProtocol\|sveltekit-host" packages/desktop/electron/main.ts`:
both `startSvelteKitServer(...)` and `registerAppProtocol(...)` are invoked
from `main.ts` during startup, passing a per-session random bearer token
(`node:crypto`, never persisted) to both. P5d must also remove that
token-minting call site in `main.ts` and the `@sveltejs/adapter-node`
dependency (`packages/desktop/package.json`) — command:
`grep -n "adapter-node" packages/desktop/package.json packages/desktop/svelte.config.js`.

---

## 10. `getPlatform()` / `isDesktop()` call-site census

### 10.1 `getPlatform()`

- Feature call sites (non-comment, `packages/desktop/src/**`): command
  `grep -rn "getPlatform(" packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "platform/index.ts" | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*\*)' | wc -l`
  → **31**, across 9 files: `FileTree.svelte`, `SyncStatusPill.svelte`,
  `GitHubDialog.svelte`, `MediaPanel.svelte`, `ConnectionsSettings.svelte`,
  `SettingsView.svelte`, `update-controller.svelte.ts`, `theme.svelte.ts`,
  `+page.svelte` (`+page.svelte` alone accounts for 15 of the 31).
- Test-only call sites: command `grep -rn "getPlatform(" packages/desktop/tests --include="*.ts" | wc -l`
  → **5**, all in `tests/platform/adapter.test.ts`.
- Dead call sites: **0 found.** Every non-comment hit above sits inside a
  component/controller method or a subscription wired into the live SPA;
  none were unreachable in this pass. (Comment-only mentions — `app.d.ts`,
  `contract.ts`, `web-adapter.ts`, `electron-adapter.ts`, `api.ts` header
  comments — are documentation, not call sites, and are excluded from the
  count above by construction.)

### 10.2 `isDesktop()`

- Feature call sites: command `grep -rn "isDesktop(" packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "platform/index.ts" | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*\*)' | wc -l`
  → **65**, across 22 files including `service-worker.ts` (comment-only guard
  reference), `+page.svelte` (the heaviest single consumer), `+layout.svelte`
  (the service-worker registration gate — §12), and every desktop-only
  panel/dialog component that must hide itself on a hypothetical web build.
- Test-only call sites: command `grep -rn "isDesktop(" packages/desktop/tests --include="*.ts" | wc -l`
  → **7**.
- Dead call sites: **0 found** in this pass.

P5b's "narrow `Platform` consumption" search proof should re-run both
commands above against its own diff and expect the feature-call-site counts
to fall as callers move to feature-owned capabilities — a rerun that still
returns 31/65 unchanged after claimed narrowing work is itself a finding.

### 10.3 Broad `Platform` **type** imports (distinct from `getPlatform()` call sites)

Command: `grep -rl "type { Platform }\|type Platform\b" packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "platform/contract.ts\|platform/electron-adapter.ts\|platform/web-adapter.ts\|platform/index.ts"`
→ **1 file**: `packages/desktop/src/lib/editor/buffer-state.svelte.ts`. This is
the entire current "broad platform access" surface by type (as opposed to by
call): P5b has a very small, already-nearly-narrow starting point on the type
side — the work is overwhelmingly about the 31+65 call sites in §10.1/10.2,
not about a type import fan-out.

---

## 11. `api.*` call-site counts per namespace

Command template: `grep -rn "api\.<ns>\." packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "src/lib/api.ts" | wc -l`

| Namespace | Call sites |
|---|---:|
| `app` | 36 |
| `fs` | 20 |
| `remote` | 18 |
| `shell` | 15 |
| `dialog` | 14 |
| `theme` | 13 |
| `publish` | 11 |
| `plugin` | 10 |
| `media` | 9 |
| `vcs` | 8 |
| `snip` | 5 |
| `updater` | 5 |
| `recovery` | 5 |
| `log` | 5 |
| `lint` | 4 |
| `tpl` | 4 |
| `manifest` | 4 |
| `project` | 3 |
| `style` | 3 |
| `sync` | 3 |
| `doctor` | 0 (called as `api.doctor()`, not `api.doctor.`; live caller exists — see HelpContent) |

These are the per-namespace denominators P5c1–P5c4 must account for: every
one of these call sites either becomes a typed-IPC call or is proven deleted
before D10's server-deletion step (P5d) can proceed. A proposed grouping
(the run that actually schedules P5c1–c4 owns the final split; this is a
starting proposal, not a binding decision):

- **P5c1 — fs, dialog, shell, log** (39 routes, 10+5+2+2 = wait: use route
  counts from §6: `fs`10 + `dialog`5 + `shell`2 + `log`2 = 19 routes; 54
  call sites: 20+14+15+5).
- **P5c2 — app, sync, recovery, style, manifest, project, doctor, status**
  (16+2+3+1+2+1+1+1 = 27 routes; 36+3+5+3+4+3+0 = 54 call sites, `doctor()`
  top-level call not namespaced).
- **P5c3 — theme, plugin, tpl, snip, project styling** (11+6+4+4 = 25 routes;
  13+10+4+5 = 32 call sites).
- **P5c4 — remote, vcs, publish, updater, media** (13+4+7+3+4 = 31 routes;
  18+8+11+5+9 = 51 call sites).

(19+27+25+31 = 102, plus `/api/status` and `/api/fs/copy-file` which have no
`api.ts` wrapper — both already counted inside the `fs`/top-level route totals
in §6 — brings the total back to 104.)

---

## 12. Duplicate DTO shapes — route files vs. lib/desktop code

### 12.1 Route-local interfaces that duplicate an existing desktop DTO

These route files declare their own local `interface`, shape-identical (or a
strict superset) to a type already exported from `dtos.ts`/`shared-types.ts`,
instead of importing it — found via `grep -rn "^export interface\|^interface " packages/desktop/src/routes/api --include="+server.ts"`:

| Route-local interface | File | Duplicates |
|---|---|---|
| `LogFileEntry` | `routes/api/log/list/+server.ts:16` | `dtos.ts` `LogFileEntry` (identical 4 fields: `name`, `path`, `sizeBytes`, `modifiedAt`) |
| `SnapshotEntry` | `routes/api/vcs/save-snapshot/+server.ts:8` | `shared-types.ts:625` `SnapshotEntry` (identical 4 fields: `id`, `message`, `timestamp`, `author?`) |
| `ToolStatus` + `SystemDiagnostics` | `routes/api/doctor/+server.ts:5,16` | `dtos.ts` `DoctorToolStatus` + `DoctorDiagnostics` (route's `SystemDiagnostics` is a strict subset of `DoctorDiagnostics` — the route spreads `...diag` and adds `desktopVersion`/`electronVersion`/`chromeVersion` inline to reach the full shape, rather than typing the merge) |

Other route-local interfaces found by the same grep (`ProjectSourceLibModule`,
`RepoBookEntry`, `RecentFolder`, `FolderEntry`, `PreflightBody`, `Body` (x2),
`ProjectSourceLike`, `LibModule` (x3)) are request-body or lib-module-facade
shapes with no DTO twin — not duplicates, excluded from this table.

### 12.2 Desktop DTOs that intentionally mirror a `packages/cli` lib type

These are **not** bugs — `dtos.ts`'s header explains the mirroring is
deliberate (§8 renderer purity: the SPA must never value-import the lib). They
are still "duplicate DTO shapes… defined both in route files and lib code" in
the sense the run spec asks to name, and are the exact pairs a future
`gutterpress/project` or `gutterpress/publish` subpath export (D11) could
collapse if the desktop route layer imported types from a browser-safe
subpath instead of hand-mirroring. Command: `grep -n "Mirrors the lib" packages/desktop/src/lib/platform/dtos.ts packages/desktop/src/lib/platform/shared-types.ts`:

| Desktop type (file) | Mirrors lib type (file) |
|---|---|
| `PrintSafeWarning` (`dtos.ts:93`) | `PrintSafeWarning` (`packages/cli/src/lib/printsafe.ts`) |
| `ProblemEntry` (`dtos.ts:106`) | `CheckResult` (`packages/cli/src/checks/types.ts`) |
| `ProjectStyle` (`dtos.ts:214`) | `ProjectStyle` (`packages/cli/src/lib/style-resolver.ts`) |
| `StyleToken` (`dtos.ts:230`) | `StyleToken` (`packages/cli/src/lib/style-tokens.ts`) |
| `MediaImageEntry`/`MediaImageInfo` (`dtos.ts:324,337`) | `ImageInfo` (`packages/cli/src/lib/image-inspect.ts`) |
| `DoctorToolStatus`/`DoctorDiagnostics` (`dtos.ts:359,371`) | lib tool-probe result + route-added fields |
| remote-auth cluster (`shared-types.ts:345+`) | lib remote-auth types |
| sync cluster (`shared-types.ts:457+`) | lib sync types |
| publish cluster (`shared-types.ts:528+`) | lib publish types |
| source-provider cluster (`shared-types.ts:620+`) | lib source-provider types |

---

## 13. Service worker / PWA registration points

| Artifact | Location | Registration / entry point |
|---|---|---|
| Service worker source | `packages/desktop/src/service-worker.ts` (110 lines) | precaches `build`+`files`+`/engine/gutterpress-viewer.js`; cache name `Gutterpress-cache-${version}` |
| SW registration call | `packages/desktop/src/routes/+layout.svelte:16-29` | `onMount`, guarded by `if (isDesktop()) return;` then `location.protocol` http/https check, `"serviceWorker" in navigator`, and `!import.meta.env.DEV`; registers `${BASE_URL}service-worker.js` |
| Web app manifest | `packages/desktop/static/manifest.webmanifest` | PWA installability metadata |
| Vendored offline viewer bundle | `packages/desktop/static/engine/gutterpress-viewer.js` | same-origin script the SW precaches and `WebAdapter.renderBookHtml` injects into the blob-URL preview/export document |
| knip entry declaration | `knip.jsonc` workspace `packages/desktop` → `entry: ["src/service-worker.{ts,js}", ...]` | without this the SW file has no in-repo importer and would read as dead code |

---

## 14. The knip dead-code exemption D10 tells P5a/P5d to remove

`knip.jsonc` (root), `workspaces["packages/desktop"].entry`:

```jsonc
// The platform seam + typed api surface are documented scaffolding for
// the remaining PWA phases (CLAUDE.md §8, docs/pwa-webadapter-plan.md,
// docs/adr/0004-platform-abstraction.md) — intentional export surface,
// not dead code.
"src/lib/platform/{index,contract,dtos,shared-types,web-store}.ts",
"src/lib/api.ts"
```

This is the literal "dead-code exemptions" D10 names for P5a
("Delete `WebAdapter`, `web-fs`, `web-store`, PWA-only service-worker code,
PWA-only tests, **and dead-code exemptions in P5a**"). Once `WebAdapter`/
`web-fs.ts`/`web-store.ts`/`service-worker.ts` are deleted (P5a) and
`api.ts`/`routes/api/**` are deleted (P5d), this `entry` line must shrink
correspondingly — `web-store.ts` and `api.ts` drop out entirely, and
`index.ts`/`contract.ts`/`dtos.ts`/`shared-types.ts` either drop out too (if
fully deleted) or keep only the members Platform-narrowing (P5b) actually
still needs exported without an in-repo importer. **Search proof for "P5a/P5d
removed the exemption":** `grep -n "web-store\|src/lib/api.ts" knip.jsonc`
must return no hits once both deletions land; a hit surviving past P5d is a
stale exemption (AP-32).

Also relevant to P5a specifically — the 4 PWA-only test files (§3.3), listed
here as the exact "PWA-only tests" D10 names:

- `packages/desktop/tests/platform/web-fs.test.ts` (228 lines)
- `packages/desktop/tests/platform/web-store.test.ts` (56 lines)
- `packages/desktop/tests/platform/web-adapter-persistence.test.ts` (199 lines)
- `packages/desktop/tests/platform/service-worker.test.ts` (77 lines)

`tests/platform/adapter.test.ts` is **not** in this list — it tests
`getPlatform()`'s Electron-vs-Web selection logic and `ElectronAdapter`
itself as well as `WebAdapter`; per the run rule ("Deletion runs may not
delete safety tests until replacement behavior tests are already green"),
P5a must first extract or duplicate its `ElectronAdapter`/`getPlatform()`
selection-logic assertions before any `WebAdapter` branch of this file can be
removed — it is a mixed file, not a pure PWA-only file.

---

## 15. Per-P5-subrun search-proof identifier index

Consolidated pointer table — the identifiers each subrun's search proof must
drive to zero (or, for P5b, must show migrated off `getPlatform()`/`isDesktop()`
onto narrower feature imports). This section only indexes; the authoritative
detail for each row is the section named.

| Subrun | Must reach zero (or fully migrated) | Detail in |
|---|---|---|
| **P5a** — WebAdapter deletion | `WebAdapter` class + its 25 non-contract methods (§3.2c); `web-fs.ts` (§3.3); `web-store.ts`'s `IndexedDbWebStore`/`WEB_STORE_NAMES` (`InMemoryWebStore` may survive if a replacement test double is still needed — check first); `service-worker.ts`; the 4 PWA-only test files (§14); the `manifest.webmanifest` + `static/engine/*` PWA-only assets (§13); the knip `entry`/exemption lines naming any of the above (§14) | §3.2, §3.3, §13, §14 |
| **P5b** — Platform narrowing | The 31 `getPlatform()` + 65 `isDesktop()` feature call sites (§10.1/10.2) migrated to feature-owned capability imports; the 1 broad `Platform`-type import (§10.3) resolved or intentionally kept as the narrowed contract's own type | §10 |
| **P5c1–P5c4** — route→IPC migration groups | The 104 `+server.ts` routes (§6) and their `api.ts` namespace wrappers (§5), grouped per the proposed split in §11, each becoming a `secureHandle` channel (pattern in §8) | §5, §6, §11 |
| **P5d** — server deletion | `src/routes/api/**` (0 of 104 remaining); `src/lib/api.ts`; `@sveltejs/adapter-node` dependency; `electron/sveltekit-host.ts`'s 11 symbols (§9) and its 2 call sites in `main.ts`; the per-session bearer-token minting call site in `main.ts`; `AUTH_HEADER`/`x-gutterpress-token" string literal repo-wide; the knip exemption line naming `src/lib/api.ts` (§14) | §6, §9, §14 |

---

## 16. Commands index (for reproduction at any later SHA)

```sh
# §1 PlatformAdapter member count
awk '/export interface PlatformAdapter/,/^}/' packages/cli/src/platform.ts | grep -cE "^\s*[a-zA-Z_]+\("

# §2 HostServices member count
awk '/export interface HostServices/,/^}/' packages/desktop/src/lib/platform/contract.ts | grep -cE "^\s*[a-zA-Z].*\(.*\)|^\s*readonly [a-zA-Z]+:"

# §6 route count + per-namespace breakdown
find packages/desktop/src/routes/api -name '+server.ts' | wc -l
find packages/desktop/src/routes/api -name '+server.ts' | sed -E 's|packages/desktop/src/routes/api/||; s|/\+server\.ts$||' | awk -F/ '{print $1}' | sort | uniq -c | sort -rn

# §7/§8 IPC surface
grep -rn 'secureHandle(\s*"' packages/desktop/electron/
grep -rn "ipcMain\.handle(" packages/desktop/electron/
grep -rn "ipcMain\.on(" packages/desktop/electron/
grep -rn 'safeSend(\s*"' packages/desktop/electron/main.ts
grep -c "forwardPush(" packages/desktop/electron/preload.ts

# §10 getPlatform()/isDesktop() census
grep -rn "getPlatform(" packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "platform/index.ts" | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*\*)' | wc -l
grep -rn "isDesktop(" packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "platform/index.ts" | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*\*)' | wc -l
grep -rn "getPlatform(" packages/desktop/tests --include="*.ts" | wc -l
grep -rn "isDesktop(" packages/desktop/tests --include="*.ts" | wc -l
grep -rl "type { Platform }\|type Platform\b" packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "platform/contract.ts\|platform/electron-adapter.ts\|platform/web-adapter.ts\|platform/index.ts"

# §11 api.* call-site counts per namespace (repeat per namespace)
grep -rn "api\.<ns>\." packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "src/lib/api.ts" | wc -l

# §12 duplicate DTO discovery
grep -rn "^export interface\|^interface " packages/desktop/src/routes/api --include="+server.ts"
grep -n "Mirrors the lib" packages/desktop/src/lib/platform/dtos.ts packages/desktop/src/lib/platform/shared-types.ts

# §14 knip exemption
grep -n "web-store\|src/lib/api.ts" knip.jsonc
```
