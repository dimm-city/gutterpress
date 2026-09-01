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

Shape, per the design constraint: **plain module functions over ONE shared
bridge accessor** — `src/lib/platform/bridge.ts` (new). No classes, no
injection framework, no manager objects. Every capability module's public
surface is a set of top-level `export function`s with the exact same
signature the deleted `Platform` member had (so every migrated call site is
a 1:1 name swap, not a redesign) — see §4 for the one case
(`getPlatformCapabilities`) where the signature's *behavior* (not shape)
needed a deliberate, documented preservation.

**"The capability's own DTO types" is only partly true as built.** Two DTO
sets actually moved to their owning capability module this run (review round
1): `editor-projection-capability.ts` owns `EditorProjectionArgs`/
`EditorProjectionOutcome`/`EditorProjectionPluginError` (the one module this
map already treats as the deliberate "pure forwarding dies" exception, §3),
and `build-preview-capability.ts` owns `PlatformCapabilities` (never actually
referenced by `ElectronBridge`, so nothing blocked its move). Every other
capability module still imports its DTOs from `platform/contract.ts` — the
run specification's "DTOs move to their owning capability" constraint is
therefore **deliberately deferred, not met**, for `FolderRef`/
`PreviewStartArgs`/`BuildArgs`/`NativeThemeState`/`FolderChangedEvent`/
`UpdaterApi` (each referenced by `ElectronBridge` directly — moving them
would create the same type-only module cycle the two exceptions above prove
is safe, but this run judged spreading that pattern to every module a bigger
readability cost than the two deliberate exceptions justify) and for
`FileRef`/`DesktopPrefs`/`SyncState`/`SyncStatus`/the re-exported IPC payload
types (real consumers outside this run's write ownership). `contract.ts`'s
own header carries the per-type accounting; P5c is the candidate to revisit
the deferred set as it takes ownership of the surrounding `api.ts` surface.

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

### 2.1 `HostServices` (desktop-only RPC surface, 22 members) — deleted

| Member | Real consumers before this run | Disposition |
|---|---|---|
| `apiVersion` | none (only tests) | **DEAD relative to the locator** — kept as an `ElectronBridge` field only (§5), since it is genuinely on `window.electron` (`electron/types.d.ts`); no capability wrapper, because nothing calls it |
| `updater: UpdaterApi` | `update-controller.svelte.ts` | → `updater-capability.ts`. Real split preserved: `getStatus`/`check`/`download` go through `api.updater.*` (HTTP, ARCH review #8); `applyNow`/`onEvent` stay on the bridge |
| `capabilities()` | `+page.svelte` (`canSavePdf`) | → `build-preview-capability.ts`'s `getPlatformCapabilities()`. Values are a fixed local synthesis (Electron is the only host), but **the `bridge()` call is deliberately kept** — see §4, this is the one place a pure behavior-preservation decision was needed |
| `onNativeThemeUpdated` | `theme.svelte.ts` (sole caller) | **Collapsed, not migrated to a module** — `theme.svelte.ts` calls `bridge().onNativeThemeUpdated(...)` inline. One consumer, pure 1:1 forward — a wrapper function would be ceremony (see §3) |
| `onOpenMarkdownFile` | `+page.svelte` | → `app-lifecycle-capability.ts` |
| `saveSnapshot` | **none** — `+page.svelte` (the `await api.vcs.saveSnapshot(dir)` call site, ~line 4018 as of review round 1; the exact line moves with unrelated edits) already called `api.vcs.saveSnapshot(dir)` directly | **DEAD — deleted.** Search proof: `grep -rn "\.saveSnapshot(" packages/desktop/src` outside `platform/`/`api.ts` → only the direct `api.vcs.saveSnapshot` call site. Bonus finding: `ElectronBridge.saveSnapshot` was ALSO a type-level lie — `electron/types.d.ts`'s real `Window.electron` never declared it either; fixed as part of this deletion (§5) |
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

**Dead-member count this run: 5** (`saveSnapshot`, `openFolder`, `listDir`,
`getSecret`, `setSecret` — each an individually dead interface member,
though `getSecret`/`setSecret` are a matched scaffolding pair) — all with
the search proofs above. `apiVersion` is a sixth "no consumer" case but is
not a deletable *member*: it is a real, still-declared field on
`window.electron` (`electron/types.d.ts`), so `ElectronBridge` keeps it (a
type must describe the real preload boundary, not just today's callers)
with no capability wrapper, since nothing calls it. The `platform:
"electron"` discriminant (§2.2) is a seventh member gone from the interface
surface, but it is neither moved nor "dead" in the search-proof sense — it
dies with the deleted `ElectronAdapter` class itself, having had no
app-code reader before this run either.

### 2.3 `getPlatform()` / `isDesktop()` / `Platform`-type census — before vs. after

| | Before (P0a §10) | After this run |
|---|---|---|
| `getPlatform()` feature call sites | 31, across 9 files | **0** |
| `getPlatform()` — files that only *imported* it unused | not separately counted by P0a | 2 (`EditorToolbar.svelte`, `ProjectsListBody.svelte` — dead imports, fixed as part of deleting the export they referenced) |
| `isDesktop()` feature call sites | 65, across 22 files | **67, across 24 files** (P0a's own command, re-run in review round 1 — `grep -rn "isDesktop(" packages/desktop/src --include="*.ts" --include="*.svelte" \| grep -v "platform/index.ts" \| grep -vE '^\s*[^:]+:[0-9]+:\s*(//\|\*\|/\*\*)' \| wc -l` → 67; the file count uses the same unfiltered `grep -rl` P0a's own "22 files including service-worker.ts (comment-only guard reference)" phrasing implies, since 4 of the 24 files carry only a comment-level mention). NOT unchanged: the delta is not evidence of un-narrowed consumption (the `getPlatform()` row above is 0, and every real call is a plain, still-needed boolean check, D10: "`isDesktop()` survives only if a real consumer remains") — it nets P5a's deletion of `service-worker.ts`/the `+layout.svelte` registration gate (both counted in the 65/22 baseline) against this run's own new call sites (`bridge.ts`'s two internal uses, the 5 new capability modules' consumers, and `update-controller.svelte.ts`) |
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
and this run's own honesty principle for the map — record plainly where a
member collapsed into its consumer file instead of getting a module, so the
map cannot be read as claiming more structure than actually landed:

- **`onNativeThemeUpdated` — collapsed into `theme.svelte.ts`.** Sole
  consumer, pure 1:1 forward (`bridge().onNativeThemeUpdated(cb)`), no
  marshalling. A dedicated `theme-capability.ts` holding one function that
  does nothing but call `bridge()` would be exactly the "manager/provider
  layer that merely forwards calls" the design constraint forbids. Matches
  the shape the design constraint's "consumed by direct import" framing
  points at — one bounded context, one consumer file, no forwarding module
  in between (`theme`'s slice lives entirely in `theme.svelte.ts`).
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
  forward, and this time the DTOs came with it.** Unlike the two cases
  above, this KEPT its own file (`editor-host/editor-projection-capability.ts`)
  even though the forwarding itself has zero marshalling. Reason: the D14
  diagnostic contract (`EditorProjectionArgs`/`EditorProjectionOutcome`/
  `EditorProjectionPluginError`) is a stable, independently-documented seam
  worth keeping discoverable next to `desktop-document-host.ts` in the same
  `editor-host/` directory, even at the cost of one thin forwarding
  function. To make that exception real rather than nominal (a prior
  revision of this map kept the module but left its DTOs behind in
  `contract.ts` — corrected here), the module now OWNS those three types
  (plus their two supporting shapes, `EditorProjectionResult`/
  `EditorProjectionFailureCode`) directly: `contract.ts`'s `ElectronBridge`
  imports them back with a type-only import, which does not create a
  runtime cycle (type-only imports are erased at build) even though the
  module graph would be circular if the import carried a value. Recorded
  here as the one deliberate exception to "pure forwarding dies" — a
  judgment call, not an oversight — and, per the run specification's DTO
  constraint, the one capability module whose DTOs actually moved to their
  owning capability this run (`contract.ts`'s header records why the rest
  were deferred instead of moved).
- **`onFolderChanged`/`onFlushBeforeClose`/`onOpenMarkdownFile`/
  `watchFolder` — real module, real reason.** Individually each is a pure
  1:1 forward too, but `onFolderChanged` has **two** independent real
  consumers (`FileTree.svelte`, `MediaPanel.svelte`) sharing the exact same
  "why we need the bridge" reasoning, and the module's other three members
  are consumed by `+page.svelte` — across the module as a whole that is
  three consumer files sharing D10's own named "app lifecycle" bounded
  context. The module earns its keep by being the one place that reasoning
  is written down once instead of scattered across those three files, not
  by `onFolderChanged` alone having three consumers (§2.1 correctly lists
  two for that row).
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
fail-loudly trigger point — a behavior change this map must stop and report
rather than absorb silently, the same honesty standard applied throughout
this document. Resolution: `getPlatformCapabilities()`
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
| `onSyncStatus` | **yes, but typed `cb: (data: unknown)`** (`electron/types.d.ts:108`) | yes | **yes, typed `handler: (status: SyncStatus)`** — a real, pre-existing type drift `remote-capability.ts:62` papers over with `handler as (data: unknown) => void`, the same cast the deleted `ElectronAdapter` carried |
| `startPreview`/`build` (raw `{ input: string }`) | **yes, but `build`'s inline args end at `skipPostValidate` — no `allowShrink`** (`electron/types.d.ts:119-130`) | yes | **yes — `{ input: string } & Omit<BuildArgs, "input">`, and `BuildArgs` carries `allowShrink?: boolean`** (contract.ts). `allowShrink` is live on this path (`+page.svelte` passes it; `electron/export/controller.ts` consumes it), so `electron/types.d.ts` is the stale side, not `ElectronBridge` |
| `stopPreview`/`cancelExport` | yes | yes | yes |
| `buildEditorProjection` | yes | yes | yes |
| `onBuildProgress`/`onUrlPreviewBlocked` | yes | yes | yes |
| `onFlushBeforeClose`/`onFolderChanged` | yes | yes | yes |
| `saveSnapshot` | **no** | **yes (drift)** | **no — removed** |

Three drifts found, not one: `saveSnapshot` was never real (§2.1, fixed —
removed from `ElectronBridge`); `build`'s `allowShrink` and `onSyncStatus`'s
payload type are real, PRE-EXISTING drifts on the `electron/types.d.ts` side
that this run did NOT introduce and cannot fix (that file is out of this
run's write ownership) — `electron/types.d.ts`'s `Window.electron` block is
the stale copy in both cases, not `ElectronBridge`. This matters less than
it sounds: nothing in the main/preload TS program actually reads
`window.electron` (`preload.ts` types its own bridge from
`bridge-types.ts`, not `electron/types.d.ts`), so that block is a
zero-consumer duplicate — which is exactly why it drifted unnoticed, and a
P5c/P6 deletion candidate. Every OTHER row matches exactly.

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
src/lib/platform/contract.ts:51: *   never a bridge member; `getPlatformCapabilities()` is a local
src/lib/platform/contract.ts:433://     `getPlatformCapabilities()` — a local synthesis, not a bridge call.
src/lib/export/build-preview-capability.ts:27: * bridge call — see {@link getPlatformCapabilities}'s own doc comment), so
src/lib/export/build-preview-capability.ts:83:export function getPlatformCapabilities(): PlatformCapabilities {
src/routes/+page.svelte:97:    getPlatformCapabilities,
src/routes/+page.svelte:293:  // PDF/build gating via the getPlatformCapabilities() seam. `nativeSavePath`
src/routes/+page.svelte:300:  const canSavePdf = $derived(getPlatformCapabilities().nativeSavePath);
(the new capability function's own name and its doc-comment mentions — not
 the deleted locator; re-run in review round 1 after `PlatformCapabilities`
 itself moved from `contract.ts` to `build-preview-capability.ts`, which is
 why the line numbers differ from the original run)

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
```

The command above is real but its raw output is a full import-block dump for
every FILE that imports anything from `$lib/platform` (barrel or not) — not
a clean per-symbol tally, so it is summarized here rather than pasted (a
prior revision of this map pasted a summary AS IF it were that command's
literal output, misnaming path helpers and `bridge` as barrel exports they
never were — corrected in review round 1):

- `isDesktop` — the only value re-export with real barrel consumers: **15**
  component/module files (`ProjectsListBody`, `FileTree`, `SyncStatusPill`,
  `GitHubDialog`, `NewProjectWizard`, `MediaPanel`, `EditorToolbar`,
  `HelpContent`, `LeftPanel`, `ProjectConnectionsSection`, `ExportDialog`,
  `ConnectionsSettings`, `SettingsView`, `update-controller.svelte.ts`,
  `+page.svelte`) plus one test file's wildcard import
  (`tests/updater/update-controller.test.ts`'s `import * as platformModule`,
  spying on `platformModule.isDesktop`).
- `DEFAULT_SETTINGS` — **1** file (`settings.svelte.ts`).
- `basenameOf`/`isPathAtOrUnder`/`joinPath` are real and used (e.g.
  `+page.svelte`, `ProjectsListBody.svelte`, `GitHubDialog.svelte`,
  `EditorToolbar.svelte`) but from `$lib/platform/paths` directly — a
  different subpath `index.ts` never re-exported. They cannot appear in this
  command's output (it matches only the bare `"$lib/platform"` specifier)
  and index.ts's trim (review round 1) does not touch them.
- `bridge` is likewise real (the capability modules + `theme.svelte.ts` all
  call it) but imported from `$lib/platform/bridge`, never from the bare
  barrel — same reason, same non-appearance in this command's output.

`index.ts` was trimmed in review round 1 to match this reality: it now
re-exports only `isDesktop`, `DEFAULT_SETTINGS`, `AppSettings`, `DeepPartial`,
`UpdaterAvailableAction`, `PrintSafeWarning`, `WorkspaceMode` — the seven
names (plus the `isDesktop` wildcard case above) that actually have an
importer through the bare `$lib/platform` specifier.

---

## 8. Net diffstat (this run)

Reproduced against the recorded SHA range (review round 1 — D15 requires
reproducible evidence, not a working-tree snapshot):

```
$ git diff --numstat 951623d7..f45d7961 -- packages/desktop/src
→ 21 files, +580 / -531  (net +49)

$ git diff --numstat 951623d7..f45d7961 -- packages/desktop/tests
→ 11 files, +487 / -207  (net +280)
```

The original hand-off recorded production as `+583 / -531 (net +52)` from
`git diff --cached --numstat` inside the lane's own working tree at the
time; the committed range reproduces 3 fewer insertions (`+580`). The file
count and every other figure (tests included) match exactly. This does not
change any conclusion drawn from the diffstat (production is still
near-flat, tests are still the expected net-positive kind) — recorded here
so the range-based figure is the one future runs can reproduce, per D15.

Production is near-flat (+49 lines) despite deleting an entire 253-line
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
- `packages/desktop/electron/auto-sync/orchestrator.ts:76`'s doc comment
  ("`ElectronAdapter.onSyncStatus` forwards the raw push payload…") describes
  a class this run deleted — `electron/` is host/main-process code, out of
  this run's write ownership (this run's surface is the SPA-side capability
  modules under `src/lib/`, per the run specification's deliverables).
- `packages/desktop/src/lib/editor/css-editor.ts:6`'s doc comment ("File
  load/save already go through `PlatformAdapter.readFile`/`writeFile` in
  `+page.svelte`") is stale — `+page.svelte` now passes `api.fs` directly,
  satisfying `EditorBuffer`'s own narrow `EditorBufferFs` shape (§3); no
  `PlatformAdapter`-typed object exists on the desktop side any more. Not
  edited: this run's write ownership covers the platform seam and its
  consumers' IMPORT/call-site lines, not every file's unrelated prose.
- `packages/desktop/src/lib/editor-host/desktop-document-host.ts:30`'s doc
  comment ("no `getPlatform()`, no ambient lookup") is still literally true
  of the constructor's design (D4) but now name-drops a symbol that no
  longer exists anywhere in the tree — worth a rewrite to describe the
  positive contract ("explicit values and callbacks only") without the
  dangling reference, next time this file is touched.
- `packages/desktop/README.md` — four stale `getPlatform()`/
  `electron-adapter.ts` mentions: line 27 ("Components call typed api.*
  wrappers for routes and getPlatform() for the narrow adapter surface;
  only electron-adapter.ts touches window.electron"), line 108 ("`getPlatform()`
  has no non-Electron implementation and throws `DesktopHostRequiredError` on
  first call (`initTheme()` in `+layout.svelte`'s `onMount`)" — the call site
  and exception class are still accurate as written (`+layout.svelte`'s
  `onMount` really does call `initTheme()`, which really does throw
  `DesktopHostRequiredError` off-Electron via the now-unconditional
  `bridge().onNativeThemeUpdated(...)` call — capability-map.md's own new
  `theme.test.ts` proves the subscribe half of that); only the named symbol
  is stale — `bridge()` replaced `getPlatform()` as the thing that throws),
  line 297 ("The renderer reaches both through `getPlatform().updater`"), and
  line 323 ("The renderer only ever calls `getPlatform().X(...)`") — a
  packaging/dev-workflow doc, out of this run's write ownership.
- **CLAUDE.md §8** — marked a non-negotiable core requirement "for every
  Electron application started in this org", and stale in five places this
  run's own deletions directly contradict:
    - "The Platform/HostServices seam (`src/lib/platform/contract.ts` +
      `ElectronAdapter`, reached via `import { getPlatform, isDesktop } from
      "$lib/platform"`) is real and still owns three narrower capability
      classes" — `Platform`/`HostServices`/`ElectronAdapter`/`getPlatform()`
      no longer exist.
    - The "(B) Platform adapter" recipe ("add it to `HostServices`",
      "`ElectronAdapter` … and `WebAdapter`") — `WebAdapter` was already
      deleted in SFE-P5a; `HostServices`/`ElectronAdapter` are deleted this
      run.
    - The worked example "the editor's lint gutter calls
      `getPlatform().checkCss(...)`" — doubly wrong even before this run:
      `checkCss` was never a `Platform`/`HostServices` member (confirmed by
      this run's own §2 inventory), and `css-editor.ts` already calls
      `api.lint.checkCss` directly (a plain server-route wrapper, seam (A)).
    - The "only `electron-adapter.ts` may [touch `window.electron`]" rule —
      contradicted by this run's own new rule: only the capability modules'
      shared bridge accessor (`$lib/platform/bridge.ts`) may.
    - The `WebAdapter` PWA-scaffolding paragraph — describes a class SFE-P5a
      deleted.

  The run correctly did NOT edit CLAUDE.md (a governing document, out of
  every run's write ownership by default) — the defect is only that this
  §9 sweep, scoped to `packages/desktop/{src,tests}`, did not previously
  name it as a location needing a future update. Recorded here so a future
  run (or a maintainer) has the exact replacement ready rather than having
  to re-derive it:
    - Seam (A) is unchanged: a server route (`src/routes/api/**/+server.ts`)
      plus a typed `src/lib/api.ts` wrapper, called as `api.<ns>.<op>(...)`
      — still the default path for new host capabilities.
    - Seam (B) becomes a feature-owned capability module
      (`$lib/<feature>/<feature>-capability.ts`, plain exported functions,
      no classes) over the ONE shared accessor `bridge()` in
      `$lib/platform/bridge.ts` — now the only module permitted to touch
      `window.electron`. It covers push streams and calls that must drive a
      live `BrowserWindow`; the third narrower class D10 originally named
      (FSA-divergent fs primitives) is gone with `WebAdapter` (SFE-P5a) — the
      web target no longer exists inside this package.
    - `getPlatform()`/`Platform`/`HostServices`/`ElectronAdapter`/
      `WebAdapter` no longer exist anywhere in the tree. `isDesktop()`
      survives, still imported from `$lib/platform` (the barrel, trimmed to
      real consumers — SFE-P5b review round 1).
    - Replace the `getPlatform().checkCss(...)` worked example with a plain
      `api.lint.checkCss(...)` call — `checkCss` was never routed through
      the adapter seam; the CSS editor's lint gutter has always called the
      server route directly (seam (A)), so the example was already
      incorrect before this run, not just stale after it.
    - Drop or fully restate the `WebAdapter` PWA-scaffolding paragraph —
      that class no longer exists (SFE-P5a).
  The `tools/check-render-purity.mjs` paragraph and everything else in §8 is
  unaffected by this run and needs no change.

None of the above affect `bun run typecheck`/`build`/`test` — they are
prose only, in files outside this run's write ownership.
