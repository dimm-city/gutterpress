# Issue #44 — Unsaved changes: dirty indicator, discard warning, external-edit detection

> **Status:** IMPLEMENTED (all four acceptance criteria). Milestone 0.4.0.
> Builds on the in-app editor (#38), chapter list (#42), session-state restore
> (#43), settings (#45) and the platform abstraction (#41).
>
> Implementation notes (delta from the original design below):
> - The renderer single-owner store is `src/lib/editor/buffer-state.svelte.ts`
>   (`EditorBuffer`), constructed lazily on first desktop editor use and owned by
>   `+page.svelte`. It carries the dirty/save machine, debounced disk write,
>   debounced recovery snapshot, close/navigate flush, and external-edit
>   reconciliation (`reconcileExternalChange` implements the §3.3 decision table).
> - The recovery sidecar store is `electron/recovery.ts` (pure index transforms +
>   IO, recoveryDir injected for unit-testing — unit-tested in
>   `tests/recovery/recovery.test.ts`). IPC: `recovery:write/clear/list`.
> - External-edit detection wires `fs:watchFolder`/`fs:unwatchFolder` +
>   `fs:folderChanged` (debounced ~150ms) + `fs:statFile`. The app subscribes via
>   `PlatformAdapter.watchFolder`; on each debounced change the buffer re-stats +
>   re-reads and applies the decision table.
> - Close gate: renderer pushes `app:setDirtyState`; main's `BrowserWindow`
>   `close` handler intercepts when dirty, sends `app:flushBeforeClose`, and
>   destroys the window on `app:flushDone` (3s watchdog forces the close).
> - `writeFile` widened to resolve `{ mtimeMs }` (lib `FileWriteResult`); the
>   editor records that as the on-disk baseline to suppress its own self-echo.
> - `DESKTOP_API` bumped 1 → 2 (new ipcMain handles the SPA calls);
>   `requiresDesktopApi` is read from `DESKTOP_API` by the manifest scripts.
> - `editor.crashRecovery` (default `true`) added to settings + a Settings
>   checkbox; toggles sidecar snapshotting at runtime.
> - The adapter test (`tests/platform/adapter.test.ts`) now asserts the eight #44
>   methods DELEGATE to the bridge (moved out of the scaffold-throws test, which
>   now covers only the #12 secrets surface).

## 1. Problem

The editor (#38) auto-saves on a 500ms debounce (`onEditorChange` in
`src/routes/+page.svelte`). That leaves four gaps the author can fall into:

1. **No "dirty" feedback.** Between a keystroke and the debounced `writeFile`,
   the in-memory document differs from disk with no visible cue.
2. **Loss on close / chapter switch.** Closing the window (or selecting another
   file in `ChapterList`) before the debounce fires drops the pending write.
3. **Silent clobber of external edits.** If another process (a different editor,
   a `git checkout`, a sync client) rewrites the open file, the next debounced
   save silently overwrites it. The editor never re-reads after the first load.
4. **No crash recovery.** An unclean exit loses any in-flight buffer entirely.

## 2. Scope (and non-scope)

In scope (issue acceptance criteria):

- Dirty indicator in the chapter list when an auto-save is pending.
- External-edit detection within 2s; a non-blocking banner with
  **Reload** / **Keep mine**.
- Crash-recovery offer on next launch when a recovery file exists.
- No data loss on a normal close (debounce flushes before the window closes).

Explicitly **not** in scope:

- No conflict-merge UI — the author picks Reload or Keep mine; we never merge.
- No version history — that is #13 (local version history).
- **No Git.** This feature touches only the editor buffer, a sidecar recovery
  file, and `fs.stat`/`fs.watch`. CLAUDE.md §7 (Node-native, no system `git`,
  no `gh`) governs the *source/version* surface (#12/#13) and does **not**
  apply here — there is no Git operation in this plan. If crash-recovery were
  ever folded into local version history, the §7 isomorphic-git rule would
  apply *there*, not in this issue.

## 3. Architecture

### 3.1 The dirty/save state machine (renderer, single owner)

All edit lifecycle state lives in **one** place: a small Svelte 5 runes store
`src/lib/editor/buffer-state.svelte.ts` (new), owned by `+page.svelte`. It
replaces the three loose `$state` vars (`editorFilePath`, `editorContent`,
`saveDebounce`) currently inline in `+page.svelte` and centralises:

| field | meaning |
|---|---|
| `filePath` | absolute path of the open document, or `null` |
| `content` | live in-memory text (what CodeMirror shows) |
| `diskContent` | last text we know is on disk (last successful read or write) |
| `diskMtimeMs` | mtime of `diskContent` as observed via `stat` |
| `phase` | `"clean" \| "dirty" \| "saving" \| "error"` |
| `externalChange` | `null` or `{ diskContent, diskMtimeMs }` pending the banner |

Derived (`$derived`):

- `isDirty = content !== diskContent` → drives the chapter-list dot.
- `hasPendingSave = phase === "dirty" || phase === "saving"`.

The store exposes intent methods only — `load(path)`, `edit(text)`,
`flush()` (force-save now, await it), `acceptExternal()`, `keepMine()`,
`reset()`. No component reads/writes the raw fields except through these.

This keeps the *single-owner* discipline the existing code already follows
(`editorContent` is owned by `+page.svelte`, mirrored into `MarkdownEditor` via
props) and makes the close-flush and external-edit flows testable as pure logic.

### 3.2 Dirty indicator (chapter list)

`ChapterList.svelte` gains one optional prop: `dirtyPath?: string | null`. When
`doc.path === dirtyPath` it renders a small accent dot beside the chapter name
(a `<span class="cl-dot" aria-label="Unsaved changes">`). `+page.svelte` passes
`dirtyPath={buffer.isDirty ? buffer.filePath : null}`.

The dot is CSS-custom-property driven (`--app-accent`) per the dark-mode layer
contract — no per-component colour overrides. The dot clears when `phase`
returns to `"clean"` after a successful `writeFile`.

A single document at a time can be dirty: switching files **flushes** the
current buffer first (§3.4), so we never need a multi-file dirty set in v1. The
prop is a single path, not a set, deliberately.

### 3.3 External-edit detection

We need to notice a disk change to the *currently open* file within 2s.

**Mechanism: `watchFolder` + a `stat` confirmation.** The `PlatformAdapter`
already declares `watchFolder(path, cb): () => void` (lib `platform.ts`), stubbed
to throw in both adapters with a comment "wiring lands with the in-app editor
(#38)". #44 is where it lands.

- The Electron main process gets a new `fs:watchFolder` / `fs:unwatchFolder` IPC
  pair. It uses `fs.watch(dir, { recursive: false })` (the project root is
  shallow — chapters live at top level, matching `listProjectFiles`), debounced
  ~150ms, and pushes `app:folderChanged` events to the renderer carrying the
  changed filename. The renderer adapter (`ElectronAdapter.watchFolder`) wires
  the IPC subscribe + returns an unsubscribe that calls `fs:unwatchFolder`.
- `WebAdapter.watchFolder` continues to throw (no recursive-watch primitive in
  the browser until 0.6.0) — but the *editor itself is desktop-only today*
  (`isDesktop()` guards in `+page.svelte`), so the web path is never reached.

On a `folderChanged` event whose filename matches the open document,
`+page.svelte` calls a new platform method **`statFile(path)`** to read the
current `mtimeMs` + size, then re-reads the file content. Decision table:

| condition | action |
|---|---|
| `mtimeMs === buffer.diskMtimeMs` | spurious (our own write echo) → ignore |
| disk content `=== buffer.content` | author's edit already matches → just refresh `diskContent`/`diskMtimeMs`, stay clean |
| disk content `=== buffer.diskContent` | only mtime moved (touch) → refresh mtime |
| otherwise, **and** `buffer.isDirty` | true conflict → set `externalChange`, show banner |
| otherwise, **and not** dirty | safe to adopt → auto-reload silently (toast "Reloaded from disk") |

`statFile` is needed because `fs.watch` events are coarse and fire on our own
writes; the mtime check suppresses the self-echo without a fragile content
round-trip on every keystroke. We record `diskMtimeMs` after every successful
`writeFile` (the write handler returns the new mtime — see §3.6).

**The banner** is a new lightweight component
`src/lib/components/ExternalEditBanner.svelte` rendered above the editor pane
(not a modal — non-blocking per the issue). Two buttons:

- **Reload** → `buffer.acceptExternal()` → replaces `content` + `diskContent`
  with the disk version; CodeMirror's existing content-diff `$effect` swaps the
  document text. Undo history resets for that file (acceptable; documented).
- **Keep mine** → `buffer.keepMine()` → adopts the disk `mtimeMs` as the new
  baseline so the *next* save isn't blocked, leaves `content` untouched, marks
  the buffer dirty, and lets the normal debounce overwrite disk.

### 3.4 Close / navigate flush

- **Chapter switch:** `selectEditorFile(path)` first `await buffer.flush()`
  (cancels the debounce timer, writes synchronously-awaited) before loading the
  new file. A brief `Toast.info("Saving…")` is shown if a write was pending.
- **Window close:** the renderer can't reliably run async work during
  `beforeunload`. Instead the Electron main owns the gate:
  - New IPC `app:hasPendingSave` is *not* used (renderer state isn't visible to
    main). Instead, the renderer **pushes** its pending state to main via a new
    `app:setDirtyState(isDirty)` IPC whenever `buffer.hasPendingSave` toggles.
  - `mainWindow.on("close", e)` checks the last-pushed dirty flag. If dirty, it
    `e.preventDefault()`s, sends `app:flushBeforeClose` to the renderer, and the
    renderer calls `buffer.flush()` then replies `app:flushDone`; main then
    calls `mainWindow.destroy()`. A 3s watchdog forces the close if the renderer
    doesn't answer (never block quit indefinitely).
  - This is the same "renderer pushes state, main gates close" pattern Electron
    docs recommend for unsaved-changes prompts; it avoids a blocking
    `dialog.showMessageBoxSync` in the common (clean-flush) case.

### 3.5 Crash recovery

On every debounced edit (not every keystroke), the buffer also writes a
**sidecar recovery file** next to the project, under Electron `userData` so it
survives even if the project folder is on removable media:

```
<userData>/recovery/
  index.json            — [{ filePath, recoveryPath, savedAt, baseMtimeMs }]
  <hash(filePath)>.md   — the in-memory buffer snapshot
```

- The recovery snapshot is written *debounced* (~1s, independent of the 500ms
  disk save) by a new `app:writeRecovery(filePath, content, baseMtimeMs)` IPC.
- On a **successful disk save**, the matching recovery entry is **cleared**
  (`app:clearRecovery(filePath)`), so a clean exit leaves no orphan.
- On **launch**, `+page.svelte` (after a project opens) calls
  `app:listRecovery(projectDir)`. For each entry whose `savedAt` is newer than
  the file's current disk `mtimeMs`, it offers a **CrashRecoveryDialog**
  ("We found unsaved changes from your last session. [Restore] [Discard]").
  - **Restore** loads the recovery content into the buffer (marked dirty so it
    saves on the next debounce) and clears the entry.
  - **Discard** deletes the recovery entry only (never the user's real file).

Recovery files are in `userData` (machine state), so deleting an entry is an
app-managed lifecycle action, not user-data deletion — but the dialog still
never touches the project file itself.

### 3.6 Platform-adapter surface this needs

New capabilities, added **end-to-end** following the #41 pattern
(ipcMain.handle → preload contextBridge → `ElectronBridge`/`Window` shape →
`ElectronAdapter` delegate → `WebAdapter` stub → interface → `getPlatform()`):

**`PlatformAdapter` (lib `platform.ts`) — narrow fs primitives:**

- `statFile(path): Promise<FileStat>` — `{ mtimeMs, size, exists }`. New.
- `writeFile` return type widened from `Promise<void>` to
  `Promise<FileWriteResult>` = `{ mtimeMs }` so the renderer can record the
  post-write baseline mtime without a follow-up stat. (Back-compat: callers
  that ignore the return value are unaffected; the contract change is additive
  in value, narrowing in type — both adapters updated in lockstep.)
- `watchFolder(path, cb): () => void` — already declared; gets its real Electron
  implementation here (was a throwing stub).

**`HostServices` (viewer `contract.ts`) — viewer-specific host RPC:**

- `writeRecovery(filePath, content, baseMtimeMs): Promise<{ ok: boolean }>`
- `clearRecovery(filePath): Promise<{ ok: boolean }>`
- `listRecovery(projectDir): Promise<RecoveryEntry[]>`
- `setDirtyState(isDirty: boolean): Promise<void>` (renderer→main close gate)
- `onFlushBeforeClose(cb): () => void` (main→renderer close gate)
- `onFolderChanged(cb: (e: { filename: string }) => void): () => void`
  (the subscription `watchFolder` is built on; exposed for the editor)

`WebAdapter` stubs: `statFile` can use the File System Access API later; for
0.4.0 it rejects. `watchFolder`/recovery/dirty-state all reject or no-op (the
editor is desktop-only today, so these are never reached on web).

`DESKTOP_API` (updater contract) **must bump 1 → 2** because new
`ipcMain.handle` methods the SPA calls are added — and
`scripts/build-web-ui-manifest.mjs`'s `requiresDesktopApi` bumps to match.

### 3.7 Settings integration (#45)

The recovery debounce and watcher poll reuse existing settings, no new store:

- `advanced.fileWatcherInterval` (already in `AppSettings`) tunes the
  `fs.watch` debounce window.
- A new `editor.crashRecovery: boolean` (default `true`) is the single-line
  addition to `DEFAULT_SETTINGS.editor` (per the #45 "one line + one control"
  contract) letting a user disable sidecar snapshots. No parallel store.

## 4. Phased delivery

**Phase 0 — types only (this pass).** Add the type stubs in §3.6 to
`platform.ts` (lib) and `contract.ts` (viewer): `FileStat`, `FileWriteResult`,
`RecoveryEntry`, `EditorBufferPhase`, the new `PlatformAdapter`/`HostServices`
members. Keep both adapters compiling by adding throwing stubs for the new
methods (mirroring the existing `watchFolder`/`getSecret` stubs). No behaviour.
Compile-clean: `npm run typecheck` + `npm run check` + lib build all green.

**Phase 1 — dirty indicator.** Introduce `buffer-state.svelte.ts`, migrate the
inline editor state in `+page.svelte` into it, add the `dirtyPath` prop + dot to
`ChapterList`. Pure renderer; no new IPC. (AC #1.)

**Phase 2 — close/navigate flush.** Implement `flush()`, chapter-switch flush,
the `setDirtyState` push, and the main-process `close` gate + watchdog.
(AC #4.)

**Phase 3 — external-edit detection.** Implement `fs:watchFolder`/`statFile`
end-to-end, the decision table, and `ExternalEditBanner.svelte`. Bump
`DESKTOP_API` → 2. (AC #2.)

**Phase 4 — crash recovery.** Implement the `userData/recovery` sidecar IPC
(`writeRecovery`/`clearRecovery`/`listRecovery`), `CrashRecoveryDialog.svelte`,
the launch-time scan, and the `editor.crashRecovery` setting. (AC #3.)

Each phase ships behind the existing `isDesktop()` editor guard and is
independently verifiable. Phases 2–4 each touch the IPC surface; only Phase 3
changes `DESKTOP_API`.

## 5. Verification gate (every phase)

From `packages/viewer`:

- `npm run typecheck`
- `npm run check` (0 errors)
- `npm run electron:build`
- `npm test`

If `packages/lib/src` changed (Phases 0/3 touch `platform.ts`):

- `(cd packages/lib && bun run build && bun test && bunx tsc --noEmit)`

Phase-specific behavioural checks:

- P1: edit a chapter → dot appears within a frame, clears ≤600ms after typing
  stops.
- P2: edit, immediately `Cmd/Ctrl+W` → file on disk matches buffer (no loss).
- P3: edit file in an external editor → banner appears < 2s; Reload adopts disk,
  Keep mine overwrites on next save.
- P4: kill the app mid-edit (`SIGKILL`) → relaunch offers Restore with the lost
  text; Discard removes only the sidecar.

## 6. Files touched (projected, full feature)

- `packages/lib/src/platform.ts` — `FileStat`, `FileWriteResult`, `statFile`,
  `writeFile` return widening (Phase 0/3).
- `packages/viewer/src/lib/platform/contract.ts` — recovery/dirty/watch
  `HostServices` members + shared types (Phase 0).
- `packages/viewer/src/lib/platform/electron-adapter.ts` /
  `web-adapter.ts` — real impls / stubs (all phases).
- `packages/viewer/electron/main.ts` — `fs:watchFolder`, `fs:statFile`,
  recovery IPC, `close` gate (Phases 2–4).
- `packages/viewer/electron/preload.ts` + `types.d.ts` + `src/app.d.ts` —
  bridge surface (Phases 2–4).
- `packages/viewer/electron/updater/contract.ts` + manifest script —
  `DESKTOP_API` 1→2 (Phase 3).
- `packages/viewer/src/lib/editor/buffer-state.svelte.ts` — new (Phase 1).
- `packages/viewer/src/lib/components/ChapterList.svelte` — dirty dot (Phase 1).
- `packages/viewer/src/lib/components/ExternalEditBanner.svelte` — new (Phase 3).
- `packages/viewer/src/lib/components/CrashRecoveryDialog.svelte` — new
  (Phase 4).
- `packages/viewer/src/routes/+page.svelte` — wire the store + components
  (all phases).
- `packages/viewer/src/lib/platform/contract.ts` `AppSettings.editor` +
  `DEFAULT_SETTINGS` — `crashRecovery` flag (Phase 4).
