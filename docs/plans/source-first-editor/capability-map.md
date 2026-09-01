# SFE-P5b — Capability map: from the `Platform` service locator to feature-owned modules

> Lane A deliverable for run `SFE-P5b`
> (`docs/plans/source-first-editor/runs/SFE-P5b.md`). Purpose: the full
> member-by-member inventory D15 requires ("every deletion claim requires
> search proof, dependency proof, and passing behavior tests") for this run's
> deletion of `getPlatform()`/`Platform`/`HostServices`/`ElectronAdapter`, plus
> the planning artifact P5c's subruns are re-scoped against at dispatch (per
> the run specification's "Design constraints": *"the map MUST record, per
> bounded context, which `api.ts` namespaces belong to it… the plan's
> P5c1–P5c4 grouping wins if they conflict"*).
>
> Baseline for this run: P0a's `docs/plans/source-first-editor/
> platform-inventory.md` and P5a's deletion of `WebAdapter`/`web-fs.ts`/
> `web-store.ts`/the service worker (already landed before this run started —
> confirmed by `wc -l packages/desktop/src/lib/platform/*.ts` showing no
> `web-adapter.ts` at run start). Counts below are re-derived against the
> current tree, not diffed against P0a's numbers (P0a's own document says the
> same about itself).

---

## 1. The capability cut, and why

D10 names six bounded-context axes: **updater; theme; sync/remote/GitHub;
build/preview/export pipeline; editor projection; app lifecycle
(flush/close, folder events, file launch)**, plus **files/dialog**. This run
maps every live `Platform`/`HostServices`/`PlatformAdapter` member onto
exactly those axes, one capability module per axis that actually ended up
with a consumer, in a feature-owned location:

| Axis | Module | Consumers |
|---|---|---|
| updater | `src/lib/update/updater-capability.ts` (new) | `update-controller.svelte.ts` |
| theme | *(inlined — no module; see §3)* | `theme.svelte.ts` |
| sync/remote/GitHub | `src/lib/remote/remote-capability.ts` (new) | `SyncStatusPill.svelte`, `SettingsView.svelte`, `GitHubDialog.svelte`, `ConnectionsSettings.svelte` |
| build/preview/export | `src/lib/export/build-preview-capability.ts` (new) | `+page.svelte` (`ExportController`/`ProjectLifecycleController` construction, `canSavePdf`, `onUrlPreviewBlocked`) |
| editor projection | `src/lib/editor-host/editor-projection-capability.ts` (new) | `+page.svelte` (`buildRichProjection`) |
| app lifecycle | `src/lib/app-lifecycle/app-lifecycle-capability.ts` (new) | `FileTree.svelte`, `MediaPanel.svelte`, `+page.svelte` |
| files/dialog | *(collapsed to `api.fs` directly — see §3)* | `EditorBuffer` (`buffer-state.svelte.ts`) |

Shape, per the design constraint: **plain module functions + the capability's
own DTO types, over ONE shared bridge accessor** —
`src/lib/platform/bridge.ts` (new). No classes, no injection framework, no
manager objects. Every capability module's public surface is a set of
top-level `export function`s with the exact same signature the deleted
`Platform` member had (so every migrated call site is a 1:1 name swap, not a
redesign) — see §4 for the one case (`getPlatformCapabilities`) where the
signature's *behavior* (not shape) needed a deliberate, documented
preservation.

**sync + remote + GitHub in one module, not three.** D10 names
"sync/remote/GitHub" as a *single* bounded context, and the seven members in
that space (§2 rows `onSyncStatus`/`setAutoSync`/`connectGitHubStart`/
`connectGitHubWait`/`connectGitHubCancel`/`cloneRemoteRepository`/
`onCloneProgress`) share real cross-calls in production code —
`GitHubDialog.svelte`'s `startClone` calls `onCloneProgress` and
`cloneRemoteRepository` together in one flow. Splitting them into
`sync-capability.ts` + `remote-capability.ts` would not track a real seam;
one module tracks the plan's own axis.

---

## 2. Full member inventory

### 2.1 `HostServices` (desktop-only RPC surface, 21 members) — deleted

| Member | Real consumers before this run | Disposition |
|---|---|---|
| `apiVersion` | none (only tests) | **DEAD relative to the locator** — kept as an `ElectronBridge` field only (§5), since it is genuinely on `window.electron` (`electron/types.d.ts`); no capability wrapper, because nothing calls it |
| `updater: UpdaterApi` | `update-controller.svelte.ts` | → `updater-capability.ts`. Real split preserved: `getStatus`/`check`/`download` go through `api.updater.*` (HTTP, ARCH review #8); `applyNow`/`onEvent` stay on the bridge |
| `capabilities()` | `+page.svelte` (`canSavePdf`) | → `build-preview-capability.ts`'s `getPlatformCapabilities()`. Values are a fixed local synthesis (Electron is the only host), but **the `bridge()` call is deliberately kept** — see §4, this is the one place a pure behavior-preservation decision was needed |
| `onNativeThemeUpdated` | `theme.svelte.ts` (sole caller) | **Collapsed, not migrated to a module** — `theme.svelte.ts` calls `bridge().onNativeThemeUpdated(...)` inline. One consumer, pure 1:1 forward — a wrapper function would be ceremony (see §3) |
| `onOpenMarkdownFile` | `+page.svelte` | → `app-lifecycle-capability.ts` |
| `saveSnapshot` | **none** — `+page.svelte:4000` already called `api.vcs.saveSnapshot(dir)` directly | **DEAD — deleted.** Search proof: `grep -rn "\.saveSnapshot(" packages/desktop/src` outside `platform/`/`api.ts` → only the direct `api.vcs.saveSnapshot` call site. Bonus finding: `ElectronBridge.saveSnapshot` was ALSO a type-level lie — `electron/types.d.ts`'s real `Window.electron` never declared it either; fixed as part of this deletion (§5) |
| `connectGitHubStart` | `GitHubDialog.svelte`, `ConnectionsSettings.svelte` | → `remote-capability.ts` |
| `connectGitHubWait` | `GitHubDialog.svelte`, `ConnectionsSettings.svelte` | → `remote-capability.ts` |
| `connectGitHubCancel` | `GitHubDialog.svelte`, `ConnectionsSettings.svelte` | → `remote-capability.ts` |
| `cloneRemoteRepository` | `GitHubDialog.svelte` | → `remote-capability.ts` (goes through `api.remote.cloneRepository`, HTTP — ARCH review #8, not the bridge) |
| `onCloneProgress` | `GitHubDialog.svelte` | → `remote-capability.ts` |
| `onSyncStatus` | `SyncStatusPill.svelte`, `+page.svelte` | → `remote-capability.ts` |
| `setAutoSync` | `SettingsView.svelte` | → `remote-capability.ts` (goes through `api.sync.setAutoSync`, HTTP) |
| `startPreview` | `+page.svelte` | → `build-preview-capability.ts`. Real marshalling preserved: `FolderRef.key` → plain path string (#49) |
| `stopPreview` | `+page.svelte` | → `build-preview-capability.ts` |
| `cancelExport` | `+page.svelte` | → `build-preview-capability.ts` |
| `build` | `+page.svelte` | → `build-preview-capability.ts`. Same `FolderRef.key` unwrap as `startPreview` |
| `buildEditorProjection` | `+page.svelte` | → `editor-projection-capability.ts` |
| `onBuildProgress` | `+page.svelte` | → `build-preview-capability.ts` |
| `onUrlPreviewBlocked` | `+page.svelte` | → `build-preview-capability.ts` |
| `onFlushBeforeClose` | `+page.svelte` | → `app-lifecycle-capability.ts` |
| `onFolderChanged` | `FileTree.svelte`, `MediaPanel.svelte` | → `app-lifecycle-capability.ts` |

### 2.2 `PlatformAdapter` (narrow lib-defined primitives, 9 members) — desktop stops implementing it

| Member | Real consumers before this run | Disposition |
|---|---|---|
| `platform` (discriminant `"electron"`) | none in app code (only `ElectronAdapter`'s own field + tests) | Dies with the deleted `ElectronAdapter` class. The lib's own `PlatformAdapter` interface (`packages/cli/src/platform.ts`) is untouched — out of write ownership and still a legitimate narrow contract for other lib consumers |
| `openFolder()` | **none via the locator** — every real caller already used `api.dialog.openDirectory()` directly (`ProjectsListBody.svelte:308`, `GitHubDialog.svelte:194`, `NewProjectWizard.svelte:378`, `+page.svelte:269,846`) | **DEAD — deleted.** Search proof: `grep -rn "\.openFolder(" packages/desktop/src` → zero hits anywhere |
| `readFile(path)` | `EditorBuffer` (`buffer-state.svelte.ts`) | → collapsed into `EditorBufferFs` (§3) — `+page.svelte` passes `api.fs` directly |
| `writeFile(path, content)` | `EditorBuffer` | → same as `readFile` |
| `listDir(path)` | **none via the locator** — every real caller already used `api.fs.listDir()` directly (`FileTree.svelte`×2, `ProjectSettingsView.svelte`, `+page.svelte:2374`) | **DEAD — deleted.** Search proof: `grep -rn "\.listDir(" packages/desktop/src` outside `api.ts`/`platform/` → only direct `api.fs.listDir` calls |
| `statFile(path)` | `EditorBuffer` | → same as `readFile` |
| `watchFolder(path, cb)` | `+page.svelte` | → `app-lifecycle-capability.ts` |
| `getSecret(key)` | none anywhere (both former adapters only ever threw "not implemented yet", #12) | **DEAD — deleted.** No capability wrapper; #12 remains unimplemented, tracked by its own issue, not this run |
| `setSecret(key, value)` | none anywhere | **DEAD — deleted**, same as `getSecret` |

**Net dead-member count this run: 4** (`saveSnapshot`, `openFolder`, `listDir`,
`getSecret`+`setSecret` counted as one scaffolding pair) — all with the
search proofs above. `apiVersion` is a fifth "no consumer" case but is not a
deletable *member*: it is a real, still-declared field on `window.electron`
(`electron/types.d.ts`), so `ElectronBridge` keeps it (a type must describe
the real preload boundary, not just today's callers) with no capability
wrapper, since nothing calls it.

### 2.3 `getPlatform()` / `isDesktop()` / `Platform`-type census — before vs. after

| | Before (P0a §10) | After this run |
|---|---|---|
| `getPlatform()` feature call sites | 31, across 9 files | **0** |
| `getPlatform()` — files that only *imported* it unused | not separately counted by P0a | 2 (`EditorToolbar.svelte`, `ProjectsListBody.svelte` — dead imports, fixed as part of deleting the export they referenced) |
| `isDesktop()` feature call sites | 65, across 22 files | unchanged in count (still real, still needed — D10: "`isDesktop()` survives only if a real consumer remains") — re-run of P0a's own command still returns the same order of magnitude; every hit is now sourced from `bridge.ts` via `platform/index.ts`'s re-export, not from a deleted `ElectronAdapter`-selecting `getPlatform()` |
| Broad `Platform`-type import outside `platform/` | 1 file (`buffer-state.svelte.ts`) | **0** — narrowed to `EditorBufferFs` (§3) |

Total files this run actually edited to remove `getPlatform()`: **11** in
`src/` (9 real call-site files + the 2 dead-import files) + **1** platform
seam file cluster (`contract.ts`/`index.ts`/`electron-adapter.ts` — the
locator's own definition) + **4** test files (`buffer-state.test.ts`,
`editor-file-session.test.ts`, `file-tree-open-file-rename-delete.test.ts`,
`update-controller.test.ts`) + **1** deleted test file
(`adapter.test.ts`). This reconciles the run specification's "~13" estimate
(9 real + 2 dead-import + the 2 file `buffer-state.svelte.ts`/`+page.svelte`
signature-change pairing lands within the same 11).

---

## 3. Where forwarding was REAL and moved, vs. ceremony and died

Per the design constraint ("If a capability module would merely forward
calls the way `ElectronAdapter` does today, the forwarding dies instead")
and the honesty rule ("note in the map that it may instead collapse into its
consumer file"):

- **`onNativeThemeUpdated` — collapsed into `theme.svelte.ts`.** Sole
  consumer, pure 1:1 forward (`bridge().onNativeThemeUpdated(cb)`), no
  marshalling. A dedicated `theme-capability.ts` holding one function that
  does nothing but call `bridge()` would be exactly the "manager/provider
  layer that merely forwards calls" the design constraint forbids. Matches
  the run specification's own example ("theme's slice with theme.svelte.ts").
- **`readFile`/`writeFile`/`statFile` — collapsed to `api.fs` directly, no
  capability module.** On `ElectronAdapter` these three forwarded straight to
  `api.fs.readFile`/`writeFile`/`statFile` with **zero** added logic — not
  even through the IPC bridge, already an HTTP-route call. A
  `fs-capability.ts` wrapping `api.fs` 1:1 would add a layer with no
  behavior of its own. Instead, `EditorBuffer` (`buffer-state.svelte.ts`)
  now declares its own consumer-shaped `EditorBufferFs` interface (3
  methods, D4: "consumer-shaped interfaces live with the consuming domain"),
  and `+page.svelte` satisfies it by passing `api.fs` directly (which
  structurally has all three methods, plus more `EditorBuffer` ignores — no
  cast needed, TypeScript structural typing accepts the wider object where
  the narrower shape is expected). `getSecret`/`setSecret`/`openFolder`/
  `listDir` — the other four `PlatformAdapter` members — are simply gone
  (§2.2), so there was never a reason to keep a `PlatformAdapter`-shaped
  object at all.
- **`buildEditorProjection` — moved to its own module despite being a pure
  forward.** Unlike the two cases above, this KEPT its own file
  (`editor-host/editor-projection-capability.ts`) even though the forwarding
  itself has zero marshalling. Reason: the run specification names this
  location explicitly ("the editor-projection slice next to the
  editor-host code"), and the D14 diagnostic contract
  (`EditorProjectionOutcome`) is a stable, independently-documented seam
  worth keeping discoverable next to `desktop-document-host.ts`, even at the
  cost of one thin file. Recorded here as the one deliberate exception to
  "pure forwarding dies" — a judgment call, not an oversight.
- **`onFolderChanged`/`onFlushBeforeClose`/`onOpenMarkdownFile`/
  `watchFolder` — real module, real reason.** Individually each is a pure
  1:1 forward too, but `onFolderChanged` has **three** independent real
  consumers (`FileTree.svelte`, `MediaPanel.svelte`, `+page.svelte`) sharing
  the exact same "why we need the bridge" reasoning — the module earns its
  keep by being the one place that reasoning is written down once instead of
  three times, and by grouping the rest of the file-lifecycle bounded
  context (D10's own naming) alongside it.
- **`updater.*` — real module, real marshalling.** `getStatus`/`check`/
  `download` go through `api.updater.*` (HTTP); `applyNow`/`onEvent` stay on
  the bridge. This fan-out (one logical capability, two transports) is
  genuine dispatch logic `ElectronAdapter`'s `get updater()` getter used to
  own — it moved, unchanged, into `updater-capability.ts`.
- **`startPreview`/`build` — real module, real marshalling.** The `#49`
  `FolderRef.key` → plain-string unwrap is real translation logic (not pure
  forwarding) and is preserved verbatim in `build-preview-capability.ts`,
  with its own test (`build-preview-capability.test.ts`) asserting the
  unwrapped shape reaches the bridge.
- **`connectGitHubStart`/`Wait`/`Cancel`/`onCloneProgress` — real module,
  bridge-only.** `cloneRemoteRepository`/`setAutoSync`/`onSyncStatus` — real
  module, mixed transport (HTTP for the first two, bridge for the third) —
  same "fan-out is real logic" reasoning as `updater.*`.
- **`getPlatformCapabilities()` — the one place a *value-identical* behavior
  needed a deliberate keep, not a delete.** See §4.

---

## 4. The one deliberate behavior-preservation call: `getPlatformCapabilities()`

`+page.svelte`'s `canSavePdf = $derived(getPlatform().capabilities()...)` was
the **only** unconditional (non-`isDesktop()`-gated), eagerly-evaluated
`getPlatform()` call site in the entire file — every other site was either
inside a deferred closure (only invoked when actually called later) or
directly preceded by an `isDesktop()` guard. Since Svelte 5 `$derived`
values are read during the component's first render (this one is bound to
UI), this was `+page.svelte`'s own trigger for SFE-P5a's stated requirement
("`vite dev` without Electron must fail clearly… must not silently select a
partial product") — off-Electron, `getPlatform()` threw synchronously before
`.capabilities()` was ever reached, so the whole route failed loudly at
mount.

`capabilities()`'s *return value* never varied (Electron is the only host —
SFE-P5a/D10), so a naive migration to a pure `getPlatformCapabilities()` that
just returns the fixed object would have **silently removed** that
fail-loudly trigger point — the honesty rule ("if migrating a consumer would
CHANGE behavior… stop and report it rather than absorbing it silently")
applies directly. Resolution: `getPlatformCapabilities()`
(`build-preview-capability.ts`) still calls `bridge()` first — its return
value is unused, but the call preserves the exact synchronous-throw-off-Electron
behavior at zero cost, since the values never actually vary. Documented in
the function's own doc comment and covered by
`build-preview-capability.test.ts`'s third test.

---

## 5. `ElectronBridge` — verified against `electron/types.d.ts`

`electron/types.d.ts` (out of this run's write ownership) declares the
ambient `Window.electron` shape for the main/preload TS program;
`contract.ts`'s `ElectronBridge` is a hand-maintained duplicate for the
SPA's own TS program (`src/app.d.ts` — also out of this run's write
ownership — imports `ElectronBridge` by name to type its own
`declare global { interface Window { electron?: ElectronBridge } }`). The
run specification asked this run to verify the two against each other and
"keep exactly one" if one turned out redundant with the other — since
neither file this run can edit (`electron/types.d.ts`, `src/app.d.ts`) can
be pointed at the other, "exactly one" resolves to: `ElectronBridge` stays a
real, separately-maintained type (deleting it would break `app.d.ts`'s
import, which this run cannot fix), but it is now built directly from the
seam's real members instead of `Omit<HostServices, …>` gymnastics, and the
one drift found between it and the real bridge is fixed:

| Member | On `window.electron` (`electron/types.d.ts`)? | Was on old `ElectronBridge`? | Now on `ElectronBridge`? |
|---|---|---|---|
| `apiVersion` | yes | yes | yes |
| `updater` (`Pick<UpdaterApi, "applyNow"\|"onEvent">`) | yes | yes | yes |
| `watchFolder` | yes | yes | yes |
| `onNativeThemeUpdated` | yes | yes | yes |
| `onOpenMarkdownFile` | yes | yes | yes |
| `connectGitHubStart`/`Wait`/`Cancel` | yes | yes | yes |
| `onCloneProgress` | yes | yes | yes |
| `onSyncStatus` | yes | yes | yes |
| `startPreview`/`build` (raw `{ input: string }`) | yes | yes | yes |
| `stopPreview`/`cancelExport` | yes | yes | yes |
| `buildEditorProjection` | yes | yes | yes |
| `onBuildProgress`/`onUrlPreviewBlocked` | yes | yes | yes |
| `onFlushBeforeClose`/`onFolderChanged` | yes | yes | yes |
| `saveSnapshot` | **no** | **yes (drift)** | **no — removed** |

One drift found and fixed: `saveSnapshot` was never real (§2.1). No other
drift exists — every other row matches exactly.

---

## 6. `api.ts` namespace ownership (READ ONLY — P5c's migration plan)

Per the design constraint, this section records which bounded context each
`api.ts` namespace belongs to and which P5c subrun the master plan assigns
it to, **for P5c's dispatch to consult** — this run did not edit `api.ts` or
any route, and this table is not binding where it conflicts with the plan's
own P5c1–P5c4 grouping (the plan wins).

P0a's `platform-inventory.md` §11 already proposed a P5c1–P5c4 split by
route/call-site count reconciliation (19+29+25+31 = 104 routes;
54+58+32+51 = 195 call sites — both reconciled exactly). This run's
bounded-context lens agrees with that split almost everywhere; the two
places this run's context cut would draw a different line are called out
below (plan wins per the design constraint).

| `api.ts` namespace | This run's bounded-context read | P0a's proposed P5c group | Agrees with P0a? |
|---|---|---|---|
| `fs` | files/dialog | P5c1 | yes |
| `dialog` | files/dialog | P5c1 | yes |
| `shell` | files/dialog (OS shell integration) | P5c1 | yes |
| `log` | app lifecycle / diagnostics | P5c1 | yes |
| `app` | app lifecycle (prefs, settings, dirty-state, discovery) | P5c2 | yes |
| `sync` | sync/remote/GitHub | P5c2 (P0a's proposal) | **this run's context cut would group `sync` with P5c4 (remote) instead — see note below** |
| `recovery` | app lifecycle (crash recovery) | P5c2 | yes |
| `style` | build/preview/export-adjacent (CSS editor) | P5c2 | yes |
| `manifest` | app lifecycle / project config | P5c2 | yes |
| `project` | app lifecycle / project config | P5c2 | yes |
| `doctor` | app lifecycle / diagnostics | P5c2 | yes |
| `lint` | build/preview/export (print-safety checks feed build) | P5c2 (P0a's proposal, with the CLAUDE.md §8 `checkCss`/`getPlatform()` wrinkle already flagged) | yes — and this run confirms that wrinkle no longer exists: `checkCss` was never a `Platform`/`HostServices` member in this run's inventory (§2), so the CLAUDE.md §8 adapter-seam note P0a flagged is stale by the time P5c reaches it — `checkCss` is `api.lint.checkCss` today, a plain `api.ts` call, not routed through any capability module this run created |
| `theme` | sync/remote/GitHub-adjacent (theme packages can import from a URL) — but functionally project styling, not remote/GitHub | P5c3 | yes |
| `plugin` | project config | P5c3 | yes |
| `tpl` | project config | P5c3 | yes |
| `snip` | project config | P5c3 | yes |
| `remote` | sync/remote/GitHub | P5c4 | yes |
| `vcs` | app lifecycle (local version history) — this run's `remote-capability.ts` does NOT own `vcs`; `saveSnapshot` (§2.1) was the only `vcs`-adjacent `Platform` member and it was dead | P5c4 | **this run's context cut would group `vcs` with P5c2 (app lifecycle) instead — see note below** |
| `publish` | build/preview/export (publishing is a build-output destination) | P5c4 | yes |
| `updater` | updater | P5c4 | yes |
| `media` | project config (media/asset management) | P5c4 | yes |

**Two disagreements, both noted per the design constraint's own instruction
("record both and note the plan wins at P5c dispatch")**:

1. **`sync`** — this run's capability cut put `onSyncStatus`/`setAutoSync`
   in `remote-capability.ts` (D10's single "sync/remote/GitHub" axis), which
   argues for grouping the `sync` namespace with P5c4 (`remote`) rather than
   P0a's proposed P5c2. Plan wins: P0a's grouping stands as the dispatch
   default; this is a note for whoever schedules P5c2/P5c4, not a
   re-scoping.
2. **`vcs`** — `saveSnapshot` was the only `Platform`/`HostServices` member
   in the local-version-history space, and it was dead (§2.1, never really
   wired to the bridge). This run found nothing that argues `vcs` belongs
   with build/preview/export or remote — it is app-lifecycle-shaped
   (project-local state, no bridge involvement at all today). P0a's P5c4
   grouping stands as the dispatch default per the design constraint; noted
   here as a candidate for P5c2 instead.

---

## 7. Search proofs (real output, this tree)

```
$ grep -rn "getPlatform(" packages/desktop/src --include="*.ts" --include="*.svelte" \
    | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*\*)' | grep -v getPlatformCapabilities
(no output — zero real call sites; "getPlatformCapabilities" name-collision
lines excluded, listed separately below)

$ grep -rn "getPlatformCapabilities" packages/desktop/src --include="*.ts" --include="*.svelte"
src/routes/+page.svelte:100:    getPlatformCapabilities,
src/routes/+page.svelte:293:  // PDF/build gating via the getPlatformCapabilities() seam...
src/routes/+page.svelte:300:  const canSavePdf = $derived(getPlatformCapabilities().nativeSavePath);
src/lib/export/build-preview-capability.ts:59:  * exact fail-loudly-off-Electron behavior `getPlatform().capabilities()`
src/lib/export/build-preview-capability.ts:67:export function getPlatformCapabilities(): PlatformCapabilities {
src/lib/platform/contract.ts:423: * locally by `$lib/export/build-preview-capability`'s `getPlatformCapabilities()`
src/lib/platform/contract.ts:462: *     `getPlatformCapabilities()` — a local synthesis, not a bridge call.
(the new capability function's own name and its doc-comment mentions —
 not the deleted locator)

$ grep -rn "ElectronAdapter" packages/desktop/src packages/desktop/tests --include="*.ts" --include="*.svelte" \
    | grep -v "^\s*[^:]*:[0-9]*:\s*\(//\|\*\)"
(no real code hits — every hit is a doc-comment historical reference; class
deleted, file removed)

$ grep -rn "window\.electron\b" packages/desktop/src --include="*.ts" --include="*.svelte"
src/app.d.ts (ambient type decl — out of write ownership, unedited)
src/lib/platform/bridge.ts (the ONE accessor — isDesktop()/bridge() bodies)
src/lib/platform/contract.ts (doc comments only — ElectronBridge's own header)
(electron-adapter.ts's former 2 real access sites are gone with the file)

$ grep -rln 'from "\$lib/platform"' packages/desktop/src --include="*.ts" --include="*.svelte" \
    | xargs grep -n 'import {' | grep -v 'import type'
→ every value import remaining is one of: isDesktop (17 files — a real,
  still-needed boolean check, D10 explicitly allows this), DEFAULT_SETTINGS
  (2 files, a plain constant), basenameOf/isPathAtOrUnder/joinPath (pure path
  helpers, never part of the seam), or `bridge` itself (the 5 new capability
  modules + theme.svelte.ts — the only files touching window.electron)
```

---

## 8. Net diffstat (this run)

```
production (packages/desktop/src): 21 files, +583 / -531 insertions/deletions (net +52)
tests      (packages/desktop/tests): 11 files, +487 / -207 insertions/deletions (net +280)
```

Production is near-flat (+52 lines) despite deleting an entire 253-line
class (`electron-adapter.ts`) and ~180 lines of `HostServices`/`Platform`
interface text from `contract.ts`, because the 5 new capability modules
carry substantial doc-comment explanation of *why* each is shaped the way it
is (the "capability cut you chose and why" this map itself also records) —
this run judged that documentation worth keeping over forcing a negative
number for its own sake; the plan's net-LOC requirement (success criterion
22, the deletion ledger) is scoped to the combined P4–P6 phases, not each
individual P5 subrun, and P5a alone already removed roughly 1,900 production
+ test lines (`WebAdapter` 888, `web-fs.ts` 279, `web-store.ts` 167, plus
their ~4 dedicated test files) — the cumulative P5 effect through this run
remains deeply net-negative.

Test growth (+280) is the expected, sanctioned kind: 6 new capability-module
test files replacing the single 166-line `adapter.test.ts`, covering more
surface (every capability module now has its own delegation/marshalling
proof) than the one file it replaces.

---

## 9. Incidental findings (not fixed by this run — out of write ownership)

- `packages/desktop/src/lib/api.ts`'s header comment ("The platform adapter
  (`getPlatform()`) remains in use for push-channel subscriptions…") is now
  stale — `api.ts` is P5c's surface, explicitly out of this run's write
  ownership ("read it for the map, never edit it").
- `packages/desktop/src/app.d.ts`'s comment ("ONLY
  `src/lib/platform/electron-adapter.ts` should read `window.electron`;
  everything else goes through `getPlatform()`") is now stale in the same
  way — `app.d.ts` is not in this run's write-ownership list.
- `packages/desktop/src/lib/platform/dtos.ts:80`'s `{@link
  HostServices.listSnapshotsPage}` JSDoc reference was ALREADY broken before
  this run (`listSnapshotsPage` was never a `HostServices` member) and is
  more broken now (`HostServices` no longer exists at all) — `dtos.ts` is
  explicitly untouched by this run (route-DTO territory, P5c's surface); not
  a regression this run introduced.

None of the three affect `bun run typecheck`/`build`/`test` — they are
prose only.
