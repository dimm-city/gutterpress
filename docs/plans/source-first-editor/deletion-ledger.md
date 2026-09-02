# Source-First Editor — Deletion and Simplification Ledger

> Complexity removed is a first-class deliverable. P0a records exact baseline counts;
> each deletion run updates them. The final ledger must show reduction in runtime
> branches, concepts, modules, and production LOC — not merely file movement.

## Baseline counts (recorded by P0a)

Filled by run SFE-P0a from the recorded `origin/main` baseline SHA
`ea7b60d50340b75b9c58666e5063bcbbbb666576`. Full commands, outputs, and
cross-references live in `docs/plans/source-first-editor/baseline.md` §4–§6;
only the Baseline column is filled here per this run's write ownership —
Current/Delta are left as em-dashes for the deletion runs that will measure
against them.

| Metric | Baseline | Current | Delta |
|---|---:|---:|---:|
| Desktop HTTP routes (`+server.ts`) | 104 | 0 (SFE-P5c1 `fs`/`dialog`/`shell`/`log`/`app` migrated to typed IPC — 35 routes deleted, ratchet re-baselined 104→69; SFE-P5c2 `project`/`manifest`/`tpl`/`snip`/`media`/`plugin`/`theme`/`vcs`/`style` migrated — 37 more deleted, ratchet re-baselined 69→32; SFE-P5c3 `remote`/`sync`/`publish` migrated; SFE-P5c4 migrated `updater`/`recovery`/`doctor`/`lint`/`status`/`api`/`_lib` remnants and every route still standing, ratchet re-baselined 32→10→0 — route count is ZERO, this pair's stated finish line. Re-derived at HEAD `0758cb9e`: `find packages/desktop/src/routes -name "+server.ts" \| wc -l` → 0, and `packages/desktop/src/routes/api` no longer exists) | −104 |
| IPC handlers (`ipcMain.handle`) | 12 (`secureHandle` registrations — the sole `ipcMain.handle` call site is 1; see baseline.md §4.2) | 120 (`grep -c 'secureHandle(' packages/desktop/electron/main.ts`, every match a real registration — the generic function's own declaration, `function secureHandle<Args …>(`, does not match the literal substring; re-derived at HEAD `0758cb9e`) — the deliberate counterpart of the routes row above: baseline 12 → 13 before this run started (`feat(p3): plugin-aware rich-editor projection`, SFE-P3e's multi-line `api:editorProjection` registration, main.ts:1779 — outside this ledger row's P5c write ownership), then SFE-P5c1 added 39 (`fs`/`dialog`/`shell`/`log`/`app`, 13→52), SFE-P5c2 added 37 (`project`/`manifest`/`tpl`/`snip`/`media`/`plugin`/`theme`/`vcs`/`style`, 52→89), and SFE-P5c3+SFE-P5c4 together added 31 more (`remote`/`sync`/`publish`, then `updater`/`recovery`/`doctor`/`lint`/`status`, and every route still standing, 89→120); route migration is complete — this row and the routes row above have now converged: every deleted route became one or more IPC registrations, plus the one pre-existing P3e handler | +108 |
| Preview mutation protocol messages | 5 — the `beginBlockEdit`/`endBlockEdit` command pair plus the `blockEditRequested`/`blockEditFinished`/`blockEditStateChanged` event triplet ONLY (mutation-inventory.md §1.1–§1.2). Does NOT include the separate `contextMenuRequested` event or `getContextTargetAt` command (mutation-inventory.md §1.5, added in repair round 1): those are read/target-resolution messages the context-menu path uses, not mutations, and may survive past P4 as part of the read-only context menu D8 keeps. | 0 (SFE-P4 `6080b4a4`; `getProtocolVersion()` v8 → v9, book side) — all five identifiers verified absent from `previewAPI` and from the bridge/shell relay; `contextMenuRequested`/`getContextTargetAt` were never counted in the baseline (see the baseline note in this row) and survive unchanged, still serving the read-only context menu D8 keeps | −5 |
| `Platform`/`HostServices` methods | 31 (9 `PlatformAdapter` + 22 `HostServices`, combined with one override; platform-inventory.md §1–§2's 30/21 figures predate `buildEditorProjection` and are re-derived here against the current tree, per this map's own preamble) | 0 — SFE-P5b `Platform`/`HostServices` interfaces deleted entirely; the 31 members resolved to: 20 moved to 5 new capability-module plain functions, 4 collapsed into their sole consumer (`onNativeThemeUpdated` inlined in `theme.svelte.ts`; `readFile`/`writeFile`/`statFile` replaced by `EditorBuffer`'s own narrow `EditorBufferFs` satisfied by `api.fs`), 5 found dead with search proof and deleted (`saveSnapshot`, `openFolder`, `listDir`, `getSecret`, `setSecret`), 1 kept only as an `ElectronBridge` type field with no capability wrapper (`apiVersion` — genuinely on `window.electron`, zero desktop-app readers), 1 dropped with the deleted `ElectronAdapter` class itself (the `platform: "electron"` discriminant — never read by app code either). Full accounting: `capability-map.md` §2. | −31 (interface surface); underlying real capability count: 20 (as plain functions) + 1 (type field) = 21 of the original 31 still reachable; 5 deleted outright; 4 still reachable through their consumer (collapsed, not translated to a module); the 1 discriminant is not a behavior deletion — nothing consumed it before this run either |
| Production LOC (workspace `src/`) | 426 files / 85,668 lines (strict `src/` only); 471 files / 94,859 lines workspace-wide incl. `packages/desktop/electron/`; see baseline.md §4.5 | — | — |
| Test LOC | 316 files / 76,861 lines (at baseline SHA; see baseline.md §4.6) | — | — |
| Dependencies (workspace, prod) | 41 (summed across packages: cli 28, desktop 13, open-design-plugin 0; see baseline.md §4.7) | — | — |
| Tracked generated files | 7 (stray root-level `.svelte-kit/`, pre-existing at baseline SHA; see baseline.md §4.4) | 0 (SFE-P0b `9fc63b02`; enforced by `tools/check-generated-files.mjs` in CI) | −7 |

## Planned deletions

| Item | Why it exists today | Replacement or reason unsupported | Delete phase | Proof of removal | Net effect |
|---|---|---|---:|---|---|
| ProseMirror architecture from PR 158 | Prior rich editor model | Not merged; VS Code source-first editor | P1/P4c | dependency/import search | Prevents new engine, schema, serializer |
| Preview in-flow editor | Direct page editing | Shared rich/source editors | P4a | protocol and symbol search | Deletes third editor surface — **DONE** (SFE-P4 `6080b4a4`): `startEdit`/`finishEdit`, the caret/repagination helpers, dblclick-to-edit, and the edit CSS are gone from `preview-interface.js` |
| `InlineEditController` | Preview edit lifecycle | No preview mutation | P4a | file/symbol absent | Deletes generation/pending-render state — **DONE** (SFE-P4 `731aee7e`): `packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts` deleted (374 lines) with every caller (`+page.svelte`'s instance, `inlineEdit.subscribe`/`.show`/`.endActive` call sites, the context menu's `"block-edit"` item) |
| `CommitEngine` | Safely mutate source from stale preview | Editor commands operate on live snapshot | P4b | file/symbol absent | Deletes duplicate write policy — **DONE** (SFE-P4 `731aee7e`): `packages/desktop/src/lib/editor/commit-engine.ts` deleted (302 lines) with its constructor call site in `+page.svelte` and the `commitEngine`/`generation`/`noteRenderingComplete` references in both former consumers |
| Preview image/link rewrite scanners | Context-menu source mutations | Shared editor commands | P4b | command/scanner search | One mutation vocabulary — **DONE, DELETED WITH SURVIVORS** (SFE-P4 `731aee7e`): the preview-driven finders `findImageToken`, `resolveLinkToken`, `makeLinkToken`, and the `LinkResolution` type are deleted from `context-menu-actions.ts`; `findImageWrapper`/`rewriteImageToken`/`rewriteLinkToken`/`spliceToken`/`findImageTokenAtOffset`/`findLinkTokenAtOffset` **survive** — their real consumers, per `grep -rn "context-menu-actions" packages/desktop/src`, are `packages/desktop/src/lib/editor/caret-token-commands.ts` (value imports of the six functions — the shared source/rich-mode image/link edit commands) and `packages/desktop/src/lib/editor/toolbar-actions.ts:141` (a type-only import of `ImageTokenMatch`/`LinkTokenMatch`), plus doc-comment mentions in `image-classes.ts`, `rich-commands.ts`, and `+page.svelte:1810`; not the preview context menu |
| Preview edit protocol messages | Cross-frame editing | Read-only preview | P4a | protocol search | Smaller bridge — **DONE** (SFE-P4 `6080b4a4`): see the "Preview mutation protocol messages" row above (5 → 0); protocol version 8 → 9 |
| Mutation-only source metadata | Support preview writes | Navigation-only metadata | P4b | output/fixture diff | **PARTIALLY DONE, corrected 2026-09-01 (round-1 review repair)** — the command/engine-scoped half is done (SFE-P4 `6080b4a4`/`731aee7e`): the `beginBlockEdit` payload's write-only `text`/`caret` fields and `CommitEngine`'s patch-only fields (`expected`, `degradeLine`) are gone with the command and the engine; the surviving `{chapter, range}` navigation shape (`getContextTargetAt`, `goToSource`) is unchanged. **NOT done, carried forward:** `data-gp-source-token`/`data-gp-source-occurrence` HTML-attribute emission and its bridge payload are still live and have no remaining consumer — see "Residual: HTML-attribute source metadata" below. No lane in this run owned `packages/cli/src/lib/markdown/**`, so this half was never in scope to close; the original DONE marking overclaimed it. The required output/fixture diff for this half was never produced and still is not. |
| `WebAdapter` | Dormant future PWA | Future web host is separate package | P5a | file/import search | Deletes false host implementation — **DONE, committed `5db8c581`**: `packages/desktop/src/lib/platform/web-adapter.ts` (901 lines) deleted; class and every runtime reference gone from `contract.ts`/`index.ts`/`+layout.svelte`/`+page.svelte`/`settings.svelte.ts`/`SyncStatusPill.svelte`/`adapter.test.ts` (search proofs below); `getPlatform()` now throws `DesktopHostRequiredError` off-Electron instead of falling back to it (the run's "fail loudly, not partially" binding decision) |
| `web-fs` / `web-store` | Browser filesystem and persistence | Unsupported in desktop | P5a | file/import search | Deletes dormant stores — **DONE, committed `5db8c581`**: `web-fs.ts` (279 lines) + `web-fs.test.ts` (228 lines), `web-store.ts` (167 lines, including `InMemoryWebStore`) + `web-store.test.ts` (56 lines), and `fsa.d.ts` (31 lines) all deleted; zero remaining occurrences of `web-fs`/`web-store`/`InMemoryWebStore`/`FileSystemDirectoryHandle`/`showDirectoryPicker` under `packages/desktop/src`\|`electron`\|`tests` (search proofs below) |
| PWA service-worker path | Future browser app | Out of scope | P5a | build/search proof | Smaller desktop build — **DONE, committed `5db8c581`**: `src/service-worker.ts` (110 lines) + `tests/platform/service-worker.test.ts` (77 lines) deleted; the `!isDesktop()`-gated registration block deleted from `+layout.svelte`; `svelte.config.js`'s `serviceWorker: { register: false }` override removed (SvelteKit's default — no auto-registration to suppress once there is no SW to register); zero `serviceWorker` occurrences left under `packages/desktop/src`. Also in `5db8c581`: `app.html`'s `<link rel="manifest">` and its PWA comment removed, and `api.ts`'s stale WebAdapter-staging comment rewritten as history — both resolved in-commit, not left for a later lane. |
| Duplicate static viewer bundle | PWA fallback | Shared render asset ownership | P5a | generated file proof | One bundle output — **NOT resolved by `5db8c581`; DONE in round-1 repair (uncommitted).** `packages/desktop/static/engine/gutterpress-viewer.js` was left untouched by the SFE-P5a commit. Re-verification found it orphaned, not shared: at base `c33868f8` its only two consumers were `WebAdapter.renderBookHtml` (`web-adapter.ts:94`) and the service worker's precache list (`service-worker.ts:38`) — `5db8c581` deleted both call sites without deleting the asset they called. `platform-inventory.md` §13 does describe it as PWA-only (not "shared" as the prior note here claimed). Root cause: `packages/cli/scripts/build-engine-bundles.mjs` unconditionally copied the built viewer bundle into `packages/desktop/static/engine/` on every `packages/cli` library build (via desktop's `build:runtime` script) — deleting the static file without also fixing the generator meant the very next `bun run build` silently regenerated it. Round-1 repair deletes `packages/desktop/static/engine/` and removes that copy step (and its now-false rationale comment) from `build-engine-bundles.mjs`; verified with a full `rm -rf build .svelte-kit && npm run build` that `build/client` no longer emits `engine/gutterpress-viewer.js` and `static/engine/` stays absent. `static/icons/` is untouched (still referenced by `app.html`). |
| Broad `Platform` service locator | Electron/PWA abstraction | Narrow feature capabilities | P5b | consumer/import search | Explicit dependencies — **DONE**: `getPlatform()`, the `Platform`/`HostServices` interfaces, and `electron-adapter.ts` (253 lines) are deleted; every real member moved to one of 5 new feature-owned capability modules (`update/updater-capability.ts`, `remote/remote-capability.ts`, `export/build-preview-capability.ts`, `app-lifecycle/app-lifecycle-capability.ts`, `editor-host/editor-projection-capability.ts`) or was found dead with search proof (`saveSnapshot`, `openFolder`, `listDir`, `getSecret`/`setSecret` — 4 members/pairs) and deleted outright; `onNativeThemeUpdated` and the fs primitives (`readFile`/`writeFile`/`statFile`) collapsed into their sole consumers rather than getting a forwarding-only module. Full inventory, search proofs, and the capability-cut rationale: `docs/plans/source-first-editor/capability-map.md`. See this ledger's own SFE-P5b section below for the measured before/after. |
| Desktop typed HTTP `api.ts` | Route client | Typed IPC | P5d | file absent | One transport — **DONE**: `src/lib/api.ts` (722 lines) was deleted in SFE-P5c4, ahead of this row's own P5d phase — re-verified absent in this run (`find packages/desktop/src -iname api.ts` → zero hits) |
| `src/routes/api/**` | Electron request/reply host | Typed IPC | P5c/P5d | route count zero | One transport — **DONE**: the directory was deleted whole in SFE-P5c4 (route count 104→0) — re-verified absent in this run (`test -d packages/desktop/src/routes/api` fails; `find packages/desktop/src/routes -type f` lists only `+layout.svelte`/`+layout.ts`/`+page.svelte`) |
| Adapter-node desktop server | Execute SvelteKit routes | Static renderer + IPC | P5d | dependency/server search | Deletes loopback service — **DONE (SFE-P5d, this run)**: `@sveltejs/adapter-node` replaced by `@sveltejs/adapter-static` in `package.json`/`bun.lock`; `svelte.config.js` builds a plain static file tree (`pages`/`assets`: `build`, `fallback: "index.html"`); `electron/sveltekit-host.ts` (236 lines — `startSvelteKitServer`, the `createServer(...).listen(0, "127.0.0.1")` loopback bind, `getSvelteKitHandlerPath`) deleted outright; `electron/app-protocol.ts` (198 lines, new) reads `build/` directly from disk under `app://`. Search proofs below. |
| Loopback bearer token/proxy | Secure local server | Server absent | P5d | symbol search | Removes attack/failure mode — **DONE (SFE-P5d, this run)**: `AUTH_HEADER`/`isAuthorizedRequest`/`withTokenAuth`/`skAuthToken` (the per-session `randomBytes(32)` token) and `buildProxyRequest`/the `fetch`-based proxy in `registerAppProtocol` all deleted with `sveltekit-host.ts`; the "app-host validation tied only to the proxy" (the pre-fix host check existed to gate what got proxied) is replaced by a new, differently-reasoned host check in `app-protocol.ts` that gates what gets served from disk (kept for origin-identity consistency with `APP_ORIGIN`, not proxy protection — see that file's header). Security-equivalence statement and the traversal-refusal proof are in this run's own section below. |
| Route-only DTO duplication | HTTP transport shapes | Capability/IPC contracts | P5c/P5d | type search | Fewer models — **DONE (SFE-P5c)**: the HTTP-route-only DTO shapes were retired during the P5c migration itself (each subrun's rule 6 landed callers on the bounded context's capability module rather than a route-shaped type; `dtos.ts`'s surviving members carry "moved here from `$lib/api.ts`" provenance notes recording the consolidation). Nothing route-shaped remained for SFE-P5d to find or delete: `grep -rn "RouteOnly\|RouteResponse\|RouteRequest" packages/desktop/src packages/desktop/electron` → zero hits, and this run's `knip` pass (files/dependencies/unlisted/binaries — see the verification table below) flags no orphaned type module. |
| Tracked generated directories | Build output in source | CI-generated only | P0b | git ls-files proof | Cleaner repository |
| Stale ADR references/comments | Historical architecture drift | Current ADRs | P6c/P7 | doc link check | Discoverable rationale — **PARTIALLY DONE (SFE-P6c)**: the six plan-named ADRs (0011–0016) were added, and ADR 0009's own "Note on predecessors" was updated to point at ADR 0014/0016 for the platform-abstraction topic the missing "ADR 0004" used to cover. The dangling in-source "ADR 0004"/"ADR 0006" citations scattered through `packages/desktop/src/**` (frozen, outside this run's write ownership) are NOT edited — see the SFE-P6c section below for the search proof and why this is a documented decline, not an oversight. |
| Duplicate local-file plugin loader (desktop) | `gutterpress/plugins` subpath was missing when `electron/editor-projection.ts` needed one | `gutterpress/plugins` (SFE-P3e) | P3e | import/symbol search | One loader — **DONE, already landed in SFE-P3e** (commit `7a5e9f8e`, well before this P6c run): `packages/cli/src/plugins.ts` re-exports the real `loadPlugins`/`loadPluginsWithCss`, and `electron/editor-projection.ts` imports from `gutterpress/plugins` with no local duplicate. SFE-P6c (this run) re-verified this is still true against the current tree (search proof below) rather than re-doing work already done — see the SFE-P6c section. |
| Workflow logic in `+page.svelte` | Organic composition growth | Feature-owned controllers | P6a | responsibility review | Smaller composition root |
| Workflow logic in Electron `main.ts` | Organic host growth | Bounded services | P6b | responsibility review | Smaller composition root |

## Deletion run updates

<!-- Each deletion run appends measured before/after counts and proofs here. -->

### SFE-P5a — 2026-09-01 — delete the dormant PWA implementation

**Base SHA `c33868f8` → head SHA `5db8c581`** (`refactor(p5): delete the
dormant PWA host`). All of Lane A/B's production/test deletions and Lane C's
own doc edits landed in that single commit; nothing described below is
uncommitted except where a subsection is explicitly marked "round-1 repair."
This entry was rewritten against the committed tree in round-1 repair
(2026-09-01) — the version originally committed with `5db8c581` was a
mid-flight Lane C snapshot (written while Lane A/B's work was still
uncommitted) that a post-commit review found stale in five ways: it asserted
"no commit SHA exists to cite" against a tree that was, by the time of
review, fully committed; it reported two defects (`app.html`'s dangling
`<link rel="manifest">`, `api.ts`'s stale WebAdapter prose) as open when the
same commit had already fixed both; its `ls` transcript did not match real
`ls` output; and it cited a run-spec quote ("stays until P5b/P5c update it")
that does not appear in `docs/plans/source-first-editor/runs/SFE-P5a.md`.
Every one of those is corrected below by re-running the proofs against the
actual committed tree.

#### File-level diff, `c33868f8..5db8c581` (committed)

| File | Insertions | Deletions | Note |
|---|---:|---:|---|
| `packages/desktop/src/lib/platform/web-adapter.ts` | 0 | 901 | deleted — the `WebAdapter` class |
| `packages/desktop/tests/platform/web-adapter-persistence.test.ts` | 0 | 199 | deleted |
| `packages/desktop/tests/platform/web-fs.test.ts` | 0 | 228 | deleted |
| `packages/desktop/src/lib/platform/web-fs.ts` | 0 | 279 | deleted |
| `packages/desktop/src/lib/platform/web-store.ts` | 0 | 167 | deleted — incl. `InMemoryWebStore` |
| `packages/desktop/tests/platform/web-store.test.ts` | 0 | 56 | deleted |
| `packages/desktop/tests/platform/service-worker.test.ts` | 0 | 77 | deleted |
| `packages/desktop/src/service-worker.ts` | 0 | 110 | deleted |
| `packages/desktop/src/lib/platform/fsa.d.ts` | 0 | 31 | deleted |
| `packages/desktop/static/manifest.webmanifest` | 0 | 20 | deleted |
| `packages/desktop/src/lib/platform/index.ts` | 27 | 6 | `getPlatform()` fails loudly (`DesktopHostRequiredError`) instead of falling back to `WebAdapter` |
| `packages/desktop/src/lib/platform/contract.ts` | 29 | 36 | doc-comment/type cleanup — every "on a future PWA" branch removed from `FolderRef`/`FileRef`/`PlatformCapabilities` doc comments |
| `packages/desktop/tests/platform/adapter.test.ts` | 9 | 478 | every `WebAdapter`-targeted test deleted; one test rewritten to assert `DesktopHostRequiredError` |
| `packages/desktop/src/routes/+page.svelte` | 8 | 9 | stale `WebAdapter`/`web-adapter.ts` comment references removed |
| `packages/desktop/src/routes/+layout.svelte` | 4 | 21 | SW registration block deleted |
| `packages/desktop/src/lib/settings.svelte.ts` | 4 | 5 | doc comment: dormant `WebAdapter` `localStorage` path no longer exists |
| `packages/desktop/src/lib/components/SyncStatusPill.svelte` | 4 | 2 | doc comment: the `isDesktop()` guard is now load-bearing, not cosmetic |
| `knip.jsonc` | 7 | 10 | `src/service-worker.{ts,js}` and `web-store.ts` dropped from the desktop `entry`/exemption list, with the `docs/adr/0004-platform-abstraction.md` citation also dropped (that ADR does not exist in this repo — see "ADR statusing" below) |
| `packages/desktop/svelte.config.js` | 0 | 3 | `serviceWorker: { register: false }` override removed |
| **Total (19 files, production + test, Lane A/B)** | **92** | **2,638** | **net −2,546**, verified by `git diff c33868f8..5db8c581 --shortstat` on the same path set |

Command run: `git diff c33868f8..5db8c581 --numstat -- packages/desktop/src/lib/platform/
packages/desktop/src/service-worker.ts
packages/desktop/static/manifest.webmanifest packages/desktop/svelte.config.js
packages/desktop/tests/platform/ packages/desktop/src/routes/+layout.svelte
packages/desktop/src/routes/+page.svelte
packages/desktop/src/lib/settings.svelte.ts
packages/desktop/src/lib/components/SyncStatusPill.svelte knip.jsonc`, cross-
checked against `git diff c33868f8..5db8c581 --shortstat` on the same path
set: `19 files changed, 92 insertions(+), 2638 deletions(-)` — re-run in
round-1 repair and confirmed identical to the numbers originally recorded
here. Split by kind: production (14 files, excl. the 5 `tests/platform/*`
files): 83 insertions, 1,600 deletions, net −1,517; tests (5 files): 9
insertions, 1,038 deletions, net −1,029. Lane C's own doc edits (CLAUDE.md,
`docs/pwa-webadapter-plan.md`, this ledger) are separate and listed under
"Docs statused this run" below — not counted in the table above, which is
production/test only.

#### Search proofs (re-run 2026-09-01 in round-1 repair, from repo root, against commit `5db8c581`)

Per the run spec's D15 requirements: `WebAdapter` → zero runtime occurrences;
`web-fs`/`web-store` → zero; service-worker registration → zero;
`manifest.webmanifest` → gone unless something non-PWA consumes it.

```
$ grep -rn 'WebAdapter' packages/desktop/src packages/desktop/electron
packages/desktop/src/lib/components/SyncStatusPill.svelte:77:    // getPlatform() now throws off-Electron (the dormant WebAdapter it used
packages/desktop/src/lib/platform/index.ts:7: * SFE-P5a (D10): the dormant browser host (`WebAdapter`) was deleted — a
packages/desktop/src/lib/platform/contract.ts:540:// WebAdapter, SFE-P5a) was deleted with it — see D10.
packages/desktop/src/lib/settings.svelte.ts:34: * `WebAdapter`, but that adapter was deleted; a future web product is a
packages/desktop/src/routes/+layout.svelte:10:  // was deleted along with `src/service-worker.ts` and the dormant WebAdapter

$ grep -rln 'WebAdapter' packages/desktop/src packages/desktop/electron packages/desktop/tests
packages/desktop/src/lib/components/SyncStatusPill.svelte
packages/desktop/src/lib/platform/index.ts
packages/desktop/src/lib/platform/contract.ts
packages/desktop/src/lib/settings.svelte.ts
packages/desktop/src/routes/+layout.svelte

$ grep -rln 'web-fs' packages/desktop/src packages/desktop/electron packages/desktop/tests
(no output — exit 1)

$ grep -rln 'web-store' packages/desktop/src packages/desktop/electron packages/desktop/tests
(no output — exit 1)

$ grep -rln 'InMemoryWebStore' packages/desktop/src packages/desktop/tests
(no output — exit 1)

$ grep -rln 'showDirectoryPicker\|FileSystemDirectoryHandle\|FileSystemFileHandle' packages/desktop/src packages/desktop/electron
(no output — exit 1)

$ grep -rn 'serviceWorker' packages/desktop/src packages/desktop/electron packages/desktop/svelte.config.js
(no output — exit 1)

$ grep -rln 'manifest.webmanifest' packages/desktop/src packages/desktop/static
(no output — exit 1)

$ ls packages/desktop/static/manifest.webmanifest
ls: cannot access 'packages/desktop/static/manifest.webmanifest': No such file or directory
```

**Reading the results against D15's four required proofs:**

1. **`WebAdapter` → zero runtime occurrences: CLEAN.** Five files still
   contain the string `WebAdapter`, all doc-comment mentions describing the
   *removal* (`SyncStatusPill.svelte`, `index.ts`, `contract.ts`,
   `settings.svelte.ts`, `+layout.svelte`) — no executable reference,
   matching the P4 ledger's precedent of counting comment-only hits as
   sanctioned residuals once they describe the deletion by name.
   `packages/desktop/src/lib/api.ts` no longer appears in this grep at all:
   the stale present-tense "whose `WebAdapter.listProjectFiles` is the live
   browser implementation" prose the mid-flight snapshot of this section
   flagged as an open defect was in fact rewritten to past tense
   ("was removed with the PWA host (SFE-P5a)") in the same commit
   (`5db8c581`) — `git diff c33868f8..5db8c581 -- packages/desktop/src/lib/api.ts`
   shows 3 insertions, 4 deletions, all in that one comment. Resolved
   in-commit, not carried forward.
2. **`web-fs`/`web-store` → zero: CLEAN.** Both greps (including
   `InMemoryWebStore` by name) return no output under `src`, `electron`, or
   `tests`.
3. **Service-worker registration → zero: CLEAN.** No `serviceWorker`
   identifier remains in `src`, `electron`, or `svelte.config.js`, and
   `packages/desktop/src/app.html` no longer emits a `<link rel="manifest">`
   at all — `git diff c33868f8..5db8c581 -- packages/desktop/src/app.html`
   shows 0 insertions, 6 deletions: the tag and its PWA comment were removed
   in the same commit, not left dangling.
4. **`manifest.webmanifest` → gone unless something non-PWA consumes it:
   CLEAN.** `static/manifest.webmanifest` no longer exists (`ls` reports "No
   such file or directory") and, per point 3, nothing under `src` or
   `static` references the string `manifest.webmanifest` any more either.

**Net verdict:** all four of the run spec's D15 search-proof bullets
(`WebAdapter`, `web-fs`/`web-store`, service-worker registration,
`manifest.webmanifest`) are clean against the committed tree. The
`WebAdapter`/`web-fs`/`web-store`/service-worker-code deletion (Lane A), the
`app.html`/`api.ts` cleanup, and the doc re-statusing (Lane C) all landed in
`5db8c581`. One item outside those four bullets — the run spec's separate
Lane B search proof, "duplicate static viewer bundle path → zero generated
copy unless required by another proven host" — was **not** satisfied by this
commit: `packages/desktop/static/engine/gutterpress-viewer.js` was left in
place. See the "Duplicate static viewer bundle" row in "Planned deletions"
above and the "Round-1 repair" subsection below for that proof.

#### ADR statusing — no edit made, and why

The run spec directs this lane to "find the platform-abstraction ADR (0004
per knip's comment) and any ADR describing the WebAdapter/FSA path" and add
dated status notes. **`docs/adr/0004-platform-abstraction.md` does not exist
in this repository.** It was deleted, along with ADRs 0001, 0002, 0005, 0006,
and 0007, by commit `efedad64` ("docs cleaning") — a pre-existing state, not
something this run or SFE-P4 touched. `docs/adr/0009-inline-editing-source-ranges.md`
already documents this gap in its own "Note on predecessors" (line 43-47):
"`CLAUDE.md` … reference[s] ADRs 0002, 0004, 0005, 0006 and 0007, none of
which are present in this repository (`docs/adr/` holds 0008, 0009 and
0010)." Confirmed independently: `git log --all --diff-filter=D -- 'docs/adr/0004*'`
shows the deletion in `efedad64`; the pre-deletion content
(`git show efedad64^:docs/adr/0004-platform-abstraction.md`) is retrievable
from history but was not restored — restoring or authoring an ADR is outside
this lane's write ownership ("statusing notes only" on existing ADRs, not
new ones).

The three ADRs actually present (`0008-presets-and-publish-targets.md`,
`0009-inline-editing-source-ranges.md`, `0010-convergent-sync-single-repair.md`)
were checked for WebAdapter/FSA content:
`grep -in 'WebAdapter\|File System Access\|FSA\|web-adapter\|web-fs\|web-store\|service.worker\|PWA' docs/adr/*.md`
returns exactly one hit, in `0009-inline-editing-source-ranges.md`: "The
renderer stays PWA-clean: the annotation rule is node-free and ships through
`gutterpress/render`…" — a reference to the **surviving renderer/host-split
rule** (the same one this run's CLAUDE.md edit preserves), not to the deleted
`WebAdapter` implementation. It describes present, accurate behavior and
needs no status note. No ADR in this repository requires an edit for SFE-P5a.

Separately, `knip.jsonc`'s own comment used to cite
`docs/adr/0004-platform-abstraction.md` by path (confirmed in this file's git
history: `git diff c33868f8..5db8c581 -- knip.jsonc` shows Lane B's edit
dropped that citation, alongside the `service-worker.{ts,js}`/`web-store.ts`
entries the same comment protected). That citation removal is Lane B's, not
this lane's; noted here only as corroborating evidence that ADR 0004 is
correctly treated as absent, not as a status-note target this lane skipped.

#### Docs statused this run

- **`CLAUDE.md` §8** — the "PWA scaffolding (`WebAdapter`, #33 — partially
  shipped)" paragraph rewritten in place to "PWA scaffolding — REMOVED (0.11,
  SFE-P5a, plan D10)": states `WebAdapter` and its dependents were deleted
  rather than completed, that a future web product is a separate package
  consuming `@dimm-city/gutterpress-editor` and `gutterpress/render`, and
  that the renderer-stays-PWA-clean rule survives as an architecture
  requirement about the renderer/host split (unrelated to whether a PWA ever
  ships from this package). Two other `WebAdapter` mentions in the
  surrounding "Adding a new host capability" walkthrough (§8, step listing
  the `ElectronAdapter`/`WebAdapter` pair) corrected to name `ElectronAdapter`
  only, with a forward reference to the rewritten paragraph. No other §8
  content touched by this commit — Lane C's write scope was "`CLAUDE.md`
  (§8's PWA paragraphs only)" per the run spec's Lane ownership table, so the
  route/adapter guidance (the "Transport", "Two seams, not one", and
  "(A)"/"(B)" capability-adding instructions) was left alone. **Correction
  (round-1 repair):** the mid-flight version of this bullet defended that as
  "per the run spec's explicit 'stays until P5b/P5c update it'" — that quoted
  string does not exist anywhere in
  `docs/plans/source-first-editor/runs/SFE-P5a.md` (confirmed:
  `grep -rn "P5b" docs/plans/source-first-editor/runs/SFE-P5a.md` returns one
  line, scoping `ElectronAdapter`/the contract's Electron half/`api.ts` route
  calls — production code, not CLAUDE.md prose). The real reason was simply
  the write-scope boundary above, not a documentation exemption. That
  boundary also left one real defect inside the "PWA paragraphs" themselves
  uncaught: capability class 3 ("FSA-divergent fs primitives") still
  described a web implementation that `5db8c581` had just deleted — fixed in
  round-1 repair (see below), not by this commit. Measured:
  `git diff c33868f8..5db8c581 --stat -- CLAUDE.md` → `21 insertions(+), 21 deletions(-)`.
- **`docs/pwa-webadapter-plan.md`** — a new status block inserted at the top
  of the existing status blockquote: "CLOSED 2026-09-01 (0.11, SFE-P5a, plan
  D10) — the implementation this plan describes was removed, not completed,"
  naming what was deleted, pointing to this ledger's SFE-P5a entry for proof,
  and stating explicitly that the rest of the document is historical and
  should not be resumed from or cited as evidence of a live web host. The
  original "partially shipped, plan revised 2026-08-23" status line is kept
  immediately below, relabeled "Status (historical)," and the body (phases,
  capability matrix, open questions) is untouched. Measured:
  `git diff c33868f8..5db8c581 --stat -- docs/pwa-webadapter-plan.md` →
  `23 insertions(+), 4 deletions(-)`.
- **`docs/adr/**`** — no file edited; see "ADR statusing" above for why
  (ADR 0004 does not exist in this repository; no present ADR describes the
  WebAdapter/FSA path).
- **This ledger** — the four P5a rows in the "Planned deletions" table above
  updated with DONE/status markers and proof pointers; this section added
  (later rewritten wholesale in round-1 repair — see below).

**Round-1 repair (uncommitted as of this rewrite) — additional docs fixed by
a post-commit review pass, not part of `5db8c581`:**

- **This ledger's own SFE-P5a section** — rewritten against the committed
  tree: added base/head SHAs, dropped the "mid-flight"/"uncommitted" framing
  throughout, re-ran every search proof against `5db8c581` (not the
  pre-commit working tree), corrected the `WebAdapter`/`app.html`/`api.ts`
  readings to reflect that both loose ends the mid-flight snapshot had
  flagged for the integrator were already resolved in the same commit,
  replaced the fabricated "stays until P5b/P5c update it" run-spec citation,
  fixed the `ls` transcript to real `ls` output, and gave the `check` row a
  real exit code (see below).
- **`CLAUDE.md` §8** — capability class 3 ("FSA-divergent fs primitives")
  deleted: it justified the Platform seam with the now-deleted `WebAdapter`'s
  File System Access implementation, which `5db8c581` removed without
  updating this enumeration. "Three narrower capability classes" /
  "the three capability classes above" reworded to "two" at every occurrence
  (4 sites). The section opener ("written so it could run unchanged in a
  browser PWA tomorrow") softened to the surviving claim — the renderer
  contains no host code, which is what would let a future separate web
  package reuse it — since `getPlatform()` now throws
  `DesktopHostRequiredError` off-Electron by design, and the literal claim no
  longer held.
- **`docs/ux-design-contract.md`** — a live product/UX contract, not a plan
  snapshot, that `5db8c581` left uncorrected even though SFE-P4's Lane C set
  the precedent of editing this exact file. Re-statused "PWA requirements"
  and "§3 Mobile / PWA editor UX" as REMOVED (0.11, SFE-P5a, plan D10) with
  wording matching CLAUDE.md §8's paragraph; dropped the "the plan wins" /
  "Normative: `docs/pwa-webadapter-plan.md`" delegations; narrowed the Scope
  section to the Electron desktop app; demoted the Vision Statement's "(via
  the PWA) on mobile" claim, the architectural-constraints table's
  FSA-divergent-fs citation, the "Mobile primary navigation (PWA)" bullet,
  the mobile perf-targets citation, and the accessibility screen-reader
  matrix's PWA row — all to historical/removed, matching the plan's success
  criterion "No documentation claims PWA support in the desktop package after
  P5a."
- **`packages/desktop/README.md`** — deleted the "SvelteKit only (no
  Electron)" dev-mode block, which documented a "pure UI/CSS iteration"
  workflow that `getPlatform()`'s unguarded call in `initTheme()`
  (`+layout.svelte`'s `onMount`) now hard-throws `DesktopHostRequiredError`
  on, before first paint — not the "Electron bridge unavailable" toast the
  doc described. Added a short note pointing contributors at `electron:hmr`
  instead, per the plan's "deleted behavior is removed from user and
  contributor docs in the same run" rule.
- **`packages/cli/scripts/build-engine-bundles.mjs`** and
  **`packages/desktop/static/engine/`** — see the "Duplicate static viewer
  bundle" row in "Planned deletions" above for the fix and its proof.

#### Verification run

| Command | Exit code | Note |
|---|---:|---|
| `git diff c33868f8..5db8c581 --stat -- CLAUDE.md docs/pwa-webadapter-plan.md docs/plans/source-first-editor/deletion-ledger.md` | 0 | Lane C's original write set, as actually committed |
| `grep -n 'WebAdapter' CLAUDE.md docs/pwa-webadapter-plan.md` (at `5db8c581`) | 0 | every remaining hit is historical/past-tense (removal description, or the plan's own pre-closure body kept as history) — see per-file confirmation in "Docs statused this run" |
| `bun run --cwd packages/desktop check` (run against a `git worktree` checked out at `5db8c581`, with `node_modules` symlinked from the main checkout — same lockfile, confirmed identical) | 0 | `889 FILES 0 ERRORS 0 WARNINGS` — resolves the mid-flight snapshot's "see notes" placeholder with a real exit code, per D15 |
| `rm -rf packages/desktop/build packages/desktop/.svelte-kit && cd packages/desktop && npm run build` (round-1 repair, current tree, after deleting `static/engine/` and fixing `build-engine-bundles.mjs`) | 0 | `check-render-purity: OK`; `find build/client -iname '*gutterpress-viewer*' -o -iname engine` returns nothing — proof for the "Duplicate static viewer bundle" row |
| `bun test packages/cli/src/assets/engine/bundle-freshness.test.ts` (round-1 repair, confirms the `build-engine-bundles.mjs` edit didn't break the committed-bundle-freshness gate) | 0 | `3 pass, 0 fail` |

### SFE-P4 — 2026-09-01 — delete preview editing and the mutation machinery

Two production commits, sequential per the run's Lane A-then-B ordering
(`docs/plans/source-first-editor/runs/SFE-P4.md`):

| Commit | Side | Files changed | Net LOC |
|---|---|---:|---:|
| `731aee7e` | Desktop (`InlineEditController`, `CommitEngine`, context-menu mutation half, `PreviewClient`'s block-edit surface) | 18 | −4,172 (336 insertions, 4,508 deletions) |
| `6080b4a4` | Book (`preview-interface.js`, `preview-bridge.js`, `preview-shell.js`; protocol v8 → v9) | 7 | −722 (147 insertions, 869 deletions) |
| **Run total (two commits, production + test)** | | 25 files | **−4,894** |
| Round-1 review repair (`0944088b`; `inline-editing.pw.mjs`, `selection-search.ts` + its test, comment/doc fixes) | Desktop | 7 | −1,825 (50 insertions, 1,875 deletions) |
| **Run total including round-1 repair** | | 32 files | **−6,719** |

Lane C's own doc edits (this ledger, `docs/inline-editing-plan.md`,
`docs/adr/0009-inline-editing-source-ranges.md`,
`docs/ux-design-contract.md`) are additive status notes — inserted headers/
notes plus, in this ledger only, the row-level replacements above (baseline
table and Planned deletions table). Measured (`git diff --numstat`):
`docs/inline-editing-plan.md` +16/−0, `docs/adr/0009-inline-editing-source-ranges.md`
+16/−0, `docs/ux-design-contract.md` +16/−2 (the original three-line status
paragraph replaced by the expanded one; the "Shipped behavior" bullets below
it are untouched), this ledger file +211/−7 (the baseline-row and
planned-deletions-row edits above). No history section's substance was
rewritten in any of the four files — every deletion is a same-paragraph
replacement, not a removed record.

#### What was deleted (measured, not merely claimed)

- **`InlineEditController`** — `packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts`
  (374 lines) deleted outright, with every production caller named in
  `mutation-inventory.md` §2 (the `+page.svelte` instance, `.subscribe`/
  `.show`/`.endActive(true)` at all four call sites, and the context menu's
  `"block-edit"` item).
- **`CommitEngine`** — `packages/desktop/src/lib/editor/commit-engine.ts`
  (302 lines) deleted outright, with its `+page.svelte` constructor call site
  and every `commitEngine.*`/`generation`/`noteRenderingComplete` reference in
  both former consumers (`InlineEditController`, gone with it;
  `ContextMenuController`, whose mutation half is also gone).
- **`ContextMenuController`'s mutation half** — `commitEngine` and
  `openInlineEdit` removed from its constructor dependencies (the
  P3d-parity-flagged signature change); it now builds exactly the **four D8
  read-only items** — `go-to-source`, `image-reveal` ("Reveal in Media
  panel"), `link-copy` ("Copy link target"), `selection-copy` ("Copy") —
  verified directly in the deleted diff (`context-menu-controller.svelte.ts`
  in `731aee7e`).
- **`context-menu-actions.ts`'s preview-driven mutation exports** —
  `findImageToken`, `resolveLinkToken`, `makeLinkToken`, and the
  `LinkResolution` type deleted (with their private helpers `findOccurrence`,
  `escapeLabel`). **Survivors, verified by re-reading the post-P4 file's
  export list** (`export function`/`export interface` grep against
  `packages/desktop/src/lib/editor/context-menu-actions.ts`):
  `findImageWrapper`, `rewriteImageToken`, `rewriteLinkToken`, `spliceToken`,
  `findImageTokenAtOffset`, `findLinkTokenAtOffset` (plus the `ImageTokenMatch`/
  `LinkTokenMatch` types). Their real consumers, per
  `grep -rn "context-menu-actions" packages/desktop/src` (8 lines across 5
  files — the command's actual output, not summarized away):

  ```
  packages/desktop/src/lib/editor/toolbar-actions.ts:141:import type { ImageTokenMatch, LinkTokenMatch } from "./context-menu-actions";
  packages/desktop/src/lib/editor/image-classes.ts:28: * directly `bun test`-able — same posture as `context-menu-actions.ts`.
  packages/desktop/src/lib/editor/caret-token-commands.ts:20: *   - `context-menu-actions.ts`'s `findImageTokenAtOffset`/
  packages/desktop/src/lib/editor/caret-token-commands.ts:36: * `context-menu-actions.ts` posture (PWA-clean, `bun test`-able without a
  packages/desktop/src/lib/editor/caret-token-commands.ts:84:} from "./context-menu-actions";
  packages/desktop/src/lib/editor/caret-token-commands.ts:265:// `findLinkTokenAtOffset`, `context-menu-actions.ts`) are UNCHANGED and
  packages/desktop/src/lib/editor/rich-commands.ts:17: * `toolbar-actions.ts`/`image-classes.ts`/`context-menu-actions.ts` posture
  packages/desktop/src/routes/+page.svelte:1810:  // tested `context-menu-actions.ts`/`image-classes.ts` primitives)
  ```

  So the real consumer set is **two** production files, not one:
  `caret-token-commands.ts` (value imports of the six surviving functions —
  the shared source/rich-mode image and link edit commands) and
  `toolbar-actions.ts:141` (a type-only import of `ImageTokenMatch`/
  `LinkTokenMatch`), plus doc-comment mentions in `image-classes.ts`,
  `rich-commands.ts`, and `+page.svelte`. Neither is the preview context
  menu, so the deletion decision is unaffected; the earlier text here and at
  the baseline-table row above understated the consumer set to one file and
  is corrected by this paragraph. `image-classes.ts` was never a P4 target
  and was not touched (per `mutation-inventory.md` §1.5's explicit warning).
- **`PreviewClient`'s block-edit surface** — `beginBlockEdit()`,
  `endBlockEdit()`, and the block-edit event typings removed, along with the
  TEST-ONLY `getContextTargetAt()` host-side wrapper `mutation-inventory.md`
  §1.5 flagged as having no production caller.
- **`selection-search.ts` and its test — added to the deletion list in round
  1 of review repair, not in the original two commits.** The file existed
  solely for "the preview context menu's selection-formatting row" (its own
  header) and its only importer was `context-menu-controller.svelte.ts`'s
  `locateSelectionInSource`/`touchesStructuralSyntax`/`hasSameDelimiter`/
  `wrapDelimiter`/`FormatKind` import, deleted along with the rest of that
  controller's mutation half in `731aee7e`. `bun run knip` did not catch
  it because it treats `selection-search.test.ts` as its own entry point.
  Verified orphaned before deletion:
  `grep -rn "locateSelectionInSource|touchesStructuralSyntax|hasSameDelimiter|wrapDelimiter|FormatKind" packages --include=*.ts --include=*.svelte --include=*.mjs`
  returned hits only inside `selection-search.ts` itself and its own test —
  no production file referenced any export. Deleted:
  `packages/desktop/src/lib/editor/selection-search.ts` (358 lines) and
  `packages/desktop/tests/editor/selection-search.test.ts` (433 lines), 791
  lines not counted in the two commits' totals above.
- **`packages/desktop/tests/integration/inline-editing.pw.mjs`** (1,047
  lines) — **deleted in round 1 of review repair (`0944088b`), added to this
  list per `mutation-inventory.md:281-289`'s explicit requirement that it
  "should be listed, not silently dropped" when P4a removes or repurposes
  it.** It was the packaged-Electron Playwright E2E smoke test for in-flow
  block editing (real mouse/keyboard input driving `startEdit`/`finishEdit`,
  the `beginBlockEdit`/`endBlockEdit` protocol pair, and the block-edit
  context-menu item) — every one of its 16 checks exercised the mutation
  surface this run deletes. The decision taken was to delete the file
  outright rather than reduce it to the D8 read-only E2E surface (go-to-source,
  image-reveal, link-copy, selection-copy), because none of its checks
  covered anything D8 keeps — there was no subset to salvage. Deleted with
  it: the `test:inline:packaged` script (`packages/desktop/package.json`)
  that ran it, and two comment rewrites in
  `.github/workflows/render-perf-gate.yml` — the header's path citation now
  names only `tests/perf/render-gate.mjs`, and the stale "inline-editing
  stays excluded … 15/16 under xvfb" paragraph is replaced with an accurate
  note that the file was deleted with the feature.
- **Book-side in-flow editing block** — `preview-interface.js`'s
  `startEdit`/`finishEdit`, the caret/repagination helpers, the
  dblclick-to-edit listener, and the edit-mode CSS (453 of the file's lines
  touched, the whole in-flow block removed). `preview-bridge.js` loses its
  three block-edit event relays (15 lines). `preview-shell.js` loses the
  `beginBlockEdit`-only focus special case and the `blockEditOpen` swap-hold
  gate (40 lines) — the swap machinery itself (`armPendingSwap`, `swap()`)
  is untouched, it simply no longer has anything holding it.
- **Protocol version** — `getProtocolVersion()` **v8 → v9**
  (`preview-interface.js`), with a version-history comment entry naming the
  deletion in place (kept deliberately — see residual (1) below).

#### Residual: HTML-attribute source metadata (`data-gp-source-token`/`-occurrence`), recorded 2026-09-01 (round-1 review repair)

Not deleted this run, and the "Mutation-only source metadata" row above is
corrected to say so. `token.meta.gpInlineSource` (the in-memory half of
`packages/cli/src/lib/markdown/inline-source.ts`) stays live — it still
serves `caret-token-commands.ts:500,507,530,537` via `gutterpress/render`'s
`inlineSourceMetaOf`/`sourceTokenOccurrenceAt` — but the HTML-attribute
emission built on top of it is now dead weight with no consumer:

- `inline-source.ts:285-286` still calls
  `token.attrSet(SOURCE_TOKEN_ATTR, …)` / `token.attrSet(SOURCE_OCCURRENCE_ATTR, …)`
  in the image/link renderer rules, so every rendered image and link in
  preview AND published `book.html` still carries `data-gp-source-token` /
  `data-gp-source-occurrence`.
- `packages/cli/src/assets/preview/scripts/preview-interface.js:548-572`
  still reads them in `sourceOf()` and ships them as `image.source` /
  `link.source` on every `contextMenuRequested` payload.
- `packages/desktop/src/lib/preview-client.ts:52,54,107,108` still types
  them as `InlineSourceToken`.

Verified dead: `grep -rn "image\.source\|link\.source" packages/desktop/src`
returns no output — no file reads either field. `context-menu-controller.svelte.ts`
builds its target purely from `kind`/`chapter`/`range`/`href`/`selection`,
never `image.source` or `link.source`. Their only consumers were
`findImageToken` and `resolveLinkToken` (`context-menu-actions.ts`), both
deleted this run.

**Why this was not fixed in this repair round:** the deletion spans
`packages/cli/src/lib/markdown/**` and `packages/cli/src/assets/preview/scripts/**`
— surface P4's Lane ownership table assigns to Lane A/B for the *protocol*
messages specifically, not this renderer-level HTML-attribute path, and no
lane's write ownership covers `inline-source.ts`. Closing it needs the
promised output/fixture diff (a `book.html` fixture diff showing the two
attributes gone) that was never produced. Carried forward as a named,
scoped follow-up rather than closed here under the wrong lane's authority:
remove the two `attrSet` calls in `inline-source.ts`, `sourceOf()` and the
`image.source`/`link.source` payload fields in `preview-interface.js`, and
the `InlineSourceToken` typing on those two fields in `preview-client.ts`,
keeping `token.meta.gpInlineSource` intact for `caret-token-commands.ts`.

#### Preview mutation protocol messages: 5 → 0 (verified against the baseline's own definition)

The baseline row (`deletion-ledger.md` baseline table, above) counts exactly
five identifiers as "mutation protocol messages": the `beginBlockEdit`/
`endBlockEdit` command pair and the `blockEditRequested`/`blockEditFinished`/
`blockEditStateChanged` event triplet. It explicitly excludes
`contextMenuRequested` and `getContextTargetAt` (added in the P0a repair
round as a correction) because those are read/target-resolution messages the
read-only context menu still uses, not mutations. This run's search proofs
(below) confirm both halves of that definition: all five counted identifiers
are gone from `previewAPI`/the bridge/the shell relay (module code, not
comments), and `contextMenuRequested`/`getContextTargetAt` are untouched and
still load-bearing for `ContextMenuController`'s surviving read-only items.

#### Search proofs (run 2026-09-01, from repo root, HEAD = working tree with `731aee7e`/`6080b4a4` applied)

```
$ grep -rn 'InlineEditController' packages/*/src
(no output — exit 1)

$ grep -rn 'CommitEngine' packages/*/src
(no output — exit 1)

$ grep -rn 'commitRangePatch' packages/*/src
(no output — exit 1)

$ grep -rn 'beginBlockEdit' packages/*/src
packages/cli/src/assets/preview/scripts/preview-interface.js:742:    // v8: in-flow block editing. ADDED beginBlockEdit()/endBlockEdit() and the
packages/cli/src/assets/preview/scripts/preview-interface.js:748:    // beginBlockEdit()/endBlockEdit() and the blockEditRequested/

$ grep -rn 'endBlockEdit' packages/*/src
packages/cli/src/assets/preview/scripts/preview-interface.js:742:    // v8: in-flow block editing. ADDED beginBlockEdit()/endBlockEdit() and the
packages/cli/src/assets/preview/scripts/preview-interface.js:748:    // beginBlockEdit()/endBlockEdit() and the blockEditRequested/

$ grep -rn 'blockEditRequested' packages/*/src
packages/cli/src/assets/preview/scripts/preview-interface.js:743:    // blockEditRequested/blockEditFinished/blockEditStateChanged events;
packages/cli/src/assets/preview/scripts/preview-interface.js:748:    // beginBlockEdit()/endBlockEdit() and the blockEditRequested/

$ grep -rn 'blockEditFinished' packages/*/src
packages/cli/src/assets/preview/scripts/preview-interface.js:743:    // blockEditRequested/blockEditFinished/blockEditStateChanged events;
packages/cli/src/assets/preview/scripts/preview-interface.js:749:    // blockEditFinished/blockEditStateChanged events are gone, along with the

$ grep -rn 'blockEditStateChanged' packages/*/src
packages/cli/src/assets/preview/scripts/preview-interface.js:743:    // blockEditRequested/blockEditFinished/blockEditStateChanged events;
packages/cli/src/assets/preview/scripts/preview-interface.js:749:    // blockEditFinished/blockEditStateChanged events are gone, along with the

$ grep -rn 'contenteditable' packages/cli/src/assets/preview
packages/cli/src/assets/preview/scripts/preview-interface.js:750:    // contenteditable authoring path and the double-click-to-edit listener

$ grep -rn 'InlineEditController\|CommitEngine\|commitRangePatch\|beginBlockEdit\|endBlockEdit' packages/*/src | wc -l
2
```

Every hit above is a **comment line inside the same version-history block**
of `preview-interface.js` (lines 742, 743, 748, 749, 750) that documents the
v8 → v9 transition by name — there is no other production-source hit for any
of the eight identifiers. Excluding that comment block specifically:

```
$ grep -rn 'InlineEditController\|CommitEngine\|commitRangePatch\|beginBlockEdit\|endBlockEdit' packages/*/src \
    | grep -v 'packages/cli/src/assets/preview/scripts/preview-interface.js'
(no output — exit 1)
```

This is why the run spec's VERIFY command
(`grep -rn '...' packages/*/src | wc -l`, "expect 0") reads **2, not 0**, on
a literal run: the command greps five of the eight identifiers, and two of
`preview-interface.js`'s five version-history lines each match twice
(`beginBlockEdit` + `endBlockEdit` on the same line). The count is real and
is reported as measured (2), not silently rounded to the expected 0 — the
non-zero count is the sanctioned residual (1) below, not a deletion gap.

**Sanctioned residuals (the only three categories D15/the run spec permit):**

1. **The v9 version-history comment in `preview-interface.js`** (lines
   734-753) — names `beginBlockEdit`/`endBlockEdit` and all three deleted
   events, and the `contenteditable` authoring path, specifically to record
   *why* `getProtocolVersion()` moved v8 → v9. This is the only production-
   source hit for any of the eight D15 identifiers.
2. **Test files asserting ABSENCE at runtime via literal command-name
   strings** — `packages/desktop/tests/preview-interface.test.mjs` (asserts
   `api.beginBlockEdit`/`api.endBlockEdit` are `undefined`),
   `packages/desktop/tests/editor/preview-separability-mutation-inert.test.ts`
   (asserts the bridge dispatches `"Unknown command: beginBlockEdit"` /
   `"Unknown command: endBlockEdit"` and that the three block-edit event
   names never fire), `packages/desktop/tests/editor/preview-navigation-protocol.test.ts`
   (asserts a `beginBlockEdit` command through the shell no longer triggers
   any focus special case), `packages/desktop/tests/preview-shell-regression.test.mjs`
   (asserts a stray `blockEditStateChanged` message no longer holds a swap),
   `packages/desktop/tests/editor/parity-replacements.test.ts` and
   `packages/desktop/tests/editor/context-menu-controller.test.ts` (header
   comments naming what was deleted and citing the replacement command, not
   assertions against the deleted symbols) and
   `packages/desktop/tests/editor/rich-doc-host-rebuild-race.test.ts` (one
   comment citing `CommitEngine`'s deletion by name for context). These are
   the permanent regression trip-wires the run spec required — deleting them
   would remove the proof that the deletion is real, not merely untested.
3. **Historical docs under `docs/plans`** — `mutation-inventory.md`,
   `parity-matrix.md`, `pr158-lessons.md`, and this run's own spec
   (`runs/SFE-P4.md`) name every identifier as history/inventory; per D15 and
   the run spec, "the docs/plans history and this spec keep the names."

No occurrence of any of the eight identifiers was found outside these three
categories. The residual list above is exactly what the greps show — it is
not widened (no additional exemption invented) or narrowed (no genuine hit
excluded).

#### Verification run (this lane, from repo root)

| Command | Exit code | Note |
|---|---:|---|
| `git diff --stat` | 0 | docs-only; see the run's structured report for the exact file list |
| `grep -rn 'InlineEditController\|CommitEngine\|commitRangePatch\|beginBlockEdit\|endBlockEdit' packages/*/src \| wc -l` | 0 (pipeline) | prints `2` — both hits are the sanctioned version-history comment (residual 1 above), not production code; 0 hits once that one comment block is excluded |

#### Docs statused this run

- `docs/inline-editing-plan.md` — **corrected 2026-09-01 (round-1 review
  repair):** the original SFE-P4 edit only appended a removal note below the
  existing status line (`git diff --numstat` was 16/0, purely additive),
  leaving "Status 2026-08-24: SHIPPED." as the first thing a reader saw,
  followed by present-tense "Entry points" text for a feature that no
  longer exists. The status line is now rewritten in place — "Status:
  SHIPPED 2026-08-24, REMOVED 2026-09-01 (0.11, SFE-P4) — historical
  record." — matching the treatment `docs/ux-design-contract.md` already
  used, and the "Entry points" sentence moved below the removal note and
  into past tense. Body kept as historical record.
- `docs/adr/0009-inline-editing-source-ranges.md` — added a status note that
  decision 3 (the commit gate) and the v8 addition to decision 5 (bridge
  protocol) were removed in SFE-P4; decisions 1-2 (`data-source-range`,
  `token.meta.line` threading) are unaffected and continue to serve
  navigation, source reveal, and editor threading. The ADR is not marked
  superseded.
- `docs/ux-design-contract.md` — §1b ("Inline editing in the preview")
  status corrected from "SHIPPED" to record the mutation half's removal in
  SFE-P4; the click-to-source and read-only context-menu items it also
  documents remain live and are not corrected.
- `docs/remaining-work.md` — checked for a "Rich editor as the PRIMARY
  authoring surface" section; none exists in this file (confirmed by
  `grep -ni "editor" docs/remaining-work.md`, zero hits) — no live claim to
  correct there. The only repo occurrence of that phrase is
  `docs/plans/source-first-editor-enterprise-refactor.md:1125`, the
  normative plan document, which this lane does not own and which does not
  misdescribe current behavior (it states the run's own historical
  purpose).
- `docs/plans/source-first-editor/parity-matrix.md` — **added 2026-09-01
  (round-1 review repair)**, not in the original two commits. Added an
  "SFE-P4 status note" recording that the `block-edit` row's first test
  citation, `rich-mode-commit-integration.test.ts`, was retired with
  `CommitEngine`, naming the surviving evidence
  (`parity-caret-token-wrappers.test.ts` for exact-bytes/locality through
  the same `DesktopDocumentHost.applyEdit` seam,
  `parity-replacements.test.ts` for the multi-line block-replacement case);
  row 44's own text is left unedited by design (the rows are preserved
  verbatim per the document's own stated policy). Also corrected the
  preamble's "REMAIN in the suite and keep running in CI" claim to note
  this one exception.

### SFE-P5b — 2026-09-01 — replace the broad `Platform` with narrow capabilities

Lane A (implementation). Base SHA `951623d7` (`docs(p5): specify run
SFE-P5b`) / head SHA `f45d7961` (`refactor(p5): replace the Platform service
locator with feature-owned capabilities`) — D15 requires both on every run;
the section originally substituted "uncommitted at hand-off" for them, which
this review-round-1 fix corrects. Review round 1's own fixes (this pass) are
uncommitted on top of `f45d7961` at hand-off; the integrator commits after
review, per the run's protocol.

**What was deleted:**

- `packages/desktop/src/lib/platform/electron-adapter.ts` (253 lines) —
  every one of its 31 forwarding members either moved to a capability module
  (20), collapsed into its sole consumer (4), died as dead surface (5), or
  was dropped with the class itself (1, the `platform: "electron"`
  discriminant), with `apiVersion` kept only as an unused-but-real
  `ElectronBridge` type field — see capability-map.md §2 for the full
  accounting.
- `Platform`/`HostServices` interfaces and `getPlatform()`/`__resetPlatform()`
  (`packages/desktop/src/lib/platform/contract.ts`/`index.ts`) — the
  service-locator surface itself.
- `packages/desktop/tests/platform/adapter.test.ts` (166 lines) — its target
  (`ElectronAdapter`) no longer exists. Real per-member delegation assertions
  moved to the new capability modules' own test files (not dropped); the
  fail-loudly host-selection tests moved to the new `bridge.test.ts`; the
  `onNativeThemeUpdated` delegation test moved to `theme.svelte.ts`'s own
  test file (added in this run's review-fix pass, matching its inline
  collapse — see capability-map.md §3). Every assertion the deleted file
  carried has a home in a still-green test file; none were dropped.
- 5 dead `Platform`/`HostServices` members, with search proof each had zero
  real desktop consumers: `saveSnapshot` (real callers already used
  `api.vcs.saveSnapshot` directly; the type was never even really on the
  preload bridge — a genuine `ElectronBridge`/`electron/types.d.ts` drift,
  fixed), `openFolder`/`listDir` (real callers already used
  `api.dialog.openDirectory()`/`api.fs.listDir()` directly), `getSecret`/
  `setSecret` (scaffolding that only ever threw "not implemented yet", #12 —
  unaffected by this run).

**What was added:**

- `docs/plans/source-first-editor/capability-map.md` — the full inventory,
  search proofs, and capability-cut rationale this run's map deliverable
  requires (see that document; not duplicated here).
- 5 new capability modules (`update/updater-capability.ts`,
  `remote/remote-capability.ts`, `export/build-preview-capability.ts`,
  `app-lifecycle/app-lifecycle-capability.ts`,
  `editor-host/editor-projection-capability.ts`) + 1 shared bridge accessor
  (`platform/bridge.ts`, moved out of `platform/index.ts`) — plain module
  functions, no classes, no injection framework, per the design constraint.
- 7 new test files covering the capability modules and the inline collapse
  (`tests/platform/bridge.test.ts`,
  `tests/updater/updater-capability.test.ts`,
  `tests/platform/remote-capability.test.ts`,
  `tests/platform/build-preview-capability.test.ts`,
  `tests/platform/app-lifecycle-capability.test.ts`,
  `tests/editor/editor-projection-capability.test.ts`,
  `tests/platform/theme.test.ts` — added in review round 1, replacing
  `onNativeThemeUpdated`'s lost delegation test with a real subscribe +
  OS-appearance-flip assertion against the collapsed `initTheme()` call
  site).

**Net diffstat**, reproduced against the recorded SHA range (review round
1 — D15 requires reproducible evidence, not a working-tree snapshot; see
capability-map.md §8 for the full reasoning):

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

Production is near-flat despite the 253-line class deletion because the 5
new capability modules carry deliberate doc-comment explanation of the
capability cut (this ledger's and capability-map.md's own "why" narrative
lives partly in those files' headers too, not only in the docs). This run's
net-LOC is not itself required to be negative — success criterion 22 scopes
the net-LOC requirement to the combined P4–P6 phases; P5a alone already
removed ~1,900 lines (`WebAdapter` 888 + `web-fs.ts` 279 + `web-store.ts`
167 + ~4 dedicated test files), so the cumulative P5 effect through this run
remains deeply net-negative.

#### Search proofs (re-run 2026-09-01, from repo root, against the working tree)

```
$ grep -rn "getPlatform(" packages/desktop/src --include="*.ts" --include="*.svelte" \
    | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*|/\*\*)' | grep -v getPlatformCapabilities
(zero real call sites)

$ grep -rn "ElectronAdapter" packages/desktop/src packages/desktop/tests --include="*.ts" --include="*.svelte" \
    | grep -v "^\s*[^:]*:[0-9]*:\s*\(//\|\*\)"
(zero — class and file deleted; remaining hits are doc-comment history)

$ grep -rn "window\.electron\b" packages/desktop/src --include="*.ts" --include="*.svelte"
(only src/app.d.ts's ambient type decl, out of write ownership, unedited;
 platform/bridge.ts's isDesktop()/bridge() bodies — the ONE accessor;
 platform/contract.ts's ElectronBridge doc-comment header)
```

Full search-proof detail, including the value-vs-type-import breakdown for
every remaining `$lib/platform` importer: capability-map.md §7.

#### Verification run (this lane, from repo root / `packages/desktop`)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` | 0 | clean across all 4 workspace packages |
| `cd packages/desktop && bun run test` | 0 | 5822 pass, 1 skip, 0 fail (was 9 fail + 1 error before the fix pass — see below) |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 894 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean |
| `cd packages/desktop && bun run build` | 0 | production build + `check-render-purity` (143 files scanned, no forbidden host/node markers) clean |
| `bun run knip` (repo root) | 0 | zero unused files/dependencies/unlisted/binaries flagged |

The 9 pre-fix test failures were 3 test files (`buffer-state.test.ts`,
`editor-file-session.test.ts`, `file-tree-open-file-rename-delete.test.ts`)
whose local `Platform`-typed test doubles needed the same mechanical
`Partial<Platform>` → `EditorBufferFs` narrowing `buffer-state.svelte.ts`
itself got (D4: consumer-shaped interface, not the deleted locator's
type) — not a behavior regression, a signature-change ripple this lane's
own write ownership (`packages/desktop/tests/**`) covers. The 1 pre-fix
error was `adapter.test.ts`'s now-broken import, resolved by its deletion
(see above). One of the 6 new capability tests also needed a same-turn fix
(`editor-projection-capability.test.ts` used `.rejects.toThrow` against a
function that fails SYNCHRONOUSLY, matching the deleted `getPlatform()`'s
own synchronous-throw behavior — a test-authoring mistake in this lane's own
new file, corrected before hand-off, not a production defect).

### SFE-P5c1 — 2026-09-01 — migrate `fs`/`dialog`/`shell`/`log`/`app` to typed IPC

Lane A (implementation). Base SHA `dc900e96` (SFE-P5c's run-specification
commit — three docs-only commits, `aee8d2d3`/`7f369ad2`/`a0e1e97e`/`dc900e96`,
landed after SFE-P5b's `f45d7961` head and before this subrun's own work
began; the diffstats below are measured against `dc900e96`, not `f45d7961`,
so they reproduce exactly). Head SHA `f6a6bb2d`.

**What was deleted:**

- 35 `+server.ts` routes (1,119 lines) under `src/routes/api/{fs,dialog,
  shell,log,app}/**`: `fs` (9 routes — `read-file`/`write-file`/`stat-file`/
  `list-dir`/`list-project-files`/`create-file`/`create-folder`/`rename`/
  `delete`), `dialog` (5 — `open-directory`/`save-pdf`/`pick-image-file`/
  `pick-pdf-file`/`pick-image-files`), `shell` (2 — `open-external`/
  `show-in-folder`), `log` (2 — `read`/`list`), `app` (16 —
  `gutterpress-prefs` GET+POST/`gutterpress-project-state/{get,set}`/
  `settings` GET+POST/`native-theme`/`recent-folders`/`favorites` GET+
  `favorites/toggle`/`recent/remove`/`discover-projects`/`classify-project`/
  `create-project`/`adopt-folder`/`dirty-state`/`flush-failure`/
  `appimage-integration` GET+POST). Route count 104 → 69 (`tools/
  architecture-baseline.json`'s `desktopHttpRoutes` re-baselined in the
  same commit, per the ratchet's WARN-on-lower contract).
- `fs/copy-file` (65 lines) was NOT ported to IPC and is a straight
  deletion, not a migration: search proof (`grep -rn "\.copyFile(\|api\.fs\."
  packages/desktop/src`, cross-checked against `api.ts`'s own pre-existing
  comment) found zero `api.ts` wrapper ever existed for it — the SPA's
  insert-image/import flows always went through `media:importImage`
  instead — and the route-level tests that exercised it
  (`fs-routes-scoping.test.ts`'s 3 copy-file cases,
  `picked-files-capability.test.ts`'s 3 copy-file cases) tested the route's
  own guard mechanism in isolation, not a real caller. The underlying
  guard mechanism (`requireWithinProjectRoot`/the picked-files one-time
  capability) is unaffected — it is exercised by every migrated `fs:*`
  operation and by the still-HTTP `media:importImage` route.
- `src/lib/api.ts`'s `fs`/`dialog`/`shell`/`log`/`app` namespaces (net
  −176 lines: +18/−194) and their now-orphaned local types (`DirEntry`,
  `ProjectFileEntry` — moved to their new owning module) and re-exports
  (`FileWriteResult`/`FileStat`/`DesktopPrefs`/`LastFlushFailure`/
  `ProjectState`/`CreateProjectResult` from `contract.ts`;
  `AppImageIntegrationStatus`/`InstallResult`/`RemoveResult`/
  `DiscoveredProject`/`ProjectClassification`/`LogFileEntry` from
  `dtos.ts` — `ProjectClassification` stays re-exported: `vcs.
  enableVersionHistory`, a surviving namespace, also returns it).
- `electron/types.d.ts`'s `Window.electron` block was DELETED then
  RESTORED in the same turn — see "Correction" below; net change to that
  file is additive (the five new namespaces' shapes), not a deletion.

**What was added:**

- `electron/api/{validation,fs,dialog,shell,log,app}.ts` (1,025 lines) —
  the main-process IPC handler logic, ported from the deleted routes.
  `validation.ts` re-implements `requireAbsolute`/`requireWithinProjectRoot`/
  `requireProjectDir`/`requireContainedOrPicked`/`requireSegment` as plain
  `Error`-throwing functions (IPC has no HTTP status code) that call the
  SAME unchanged main-process primitives the deleted route-side
  `_lib/fs-guard.ts` called (`electron/server-bridge/fs-guard.ts`'s
  `isWithinAnyRootCanonical`/`getFsGuardHooks`, `picked-files.ts`'s
  `getPickedFilesHooks`) — the security-load-bearing logic is REUSED
  verbatim, not re-derived; only the SvelteKit-specific outer shim (HTTP
  status + JSON envelope) is gone, which is inherent to the transport
  change (D14/rule 2: no caller ever branched on status — `api.ts`'s
  `post`/`get` already discarded it and kept only the message text, so
  preserving the message string is what preserves observable behavior).
- 39 new `secureHandle` IPC channel registrations in `electron/main.ts`
  (9 `fs:*` + 5 `dialog:*` + 2 `shell:*` + 2 `log:*` + 21 `app:*`), named
  `<ns>:<op>` matching the file's established convention (`fs:readFile`,
  `dialog:openDirectory`, `shell:openExternal`, `log:read`,
  `app:getDesktopPrefs`, `app:appImageIntegrationStatus`, …) — alongside 4
  PRE-EXISTING `fs:`/`app:`-prefixed channels this run did not touch
  (`fs:watchFolder`/`fs:unwatchFolder`/`app:flushDone`/
  `app:openMarkdownFileReady`, all already IPC before this run) — 34 total
  `secureHandle("fs:`/`"app:` registrations verifiable by grep (`grep -c
  'secureHandle("fs:\|secureHandle("app:' packages/desktop/electron/main.ts`:
  11 `fs:` + 23 `app:`, i.e. 9 new + 2 pre-existing `fs:*` and 21 new + 2
  pre-existing `app:*`). The earlier "43" double-counted: it added all 39
  new channels across all five namespaces to the 4 pre-existing ones, but
  only the `fs:*`/`app:*`-prefixed ones (30 new + 4 pre-existing = 34)
  actually match that grep — `dialog:*`/`shell:*`/`log:*` do not.
- `src/lib/files/files-capability.ts` (167 lines, new module — D10's
  "files/dialog" bounded context had none yet per SFE-P5b) — `fs`/
  `dialog`/`shell` (grouped per the capability map's own read: "shell |
  files/dialog (OS shell integration)").
- `src/lib/app-lifecycle/app-lifecycle-capability.ts` EXTENDED (not a new
  module) with `log`/`app` — the plan's own P5c1 scoping note ("kept
  whole here — its settings/prefs/dirty-state/discovery members are one
  bounded context") plus the capability map's "app lifecycle /
  diagnostics" read for `log`.
- 6 new IPC-handler test files (1,105 lines) replacing the deleted
  route-level tests: `tests/platform/{fs,dialog,shell,log,app}-ipc.test.ts`
  + `media-routes-scoping.test.ts` (the renamed, trimmed former
  `fs-routes-scoping.test.ts` — its `media/*` cases stay HTTP, P5c4).
  Every scenario from the deleted route tests (project-scoping 403s,
  sibling-prefix rejection, symlink/dangling-symlink escapes, no-project-
  open fail-closed, create/rename/delete conflict handling, the
  snapshot-before-delete discipline including a real-git end-to-end case,
  the picked-files one-time-capability registration/consumption, the
  http(s)-only scheme gate, the AppImage friendly-error mapping, the M20
  scan-failure-must-not-resolve-`[]` invariant) is ported, asserting the
  REJECTED PROMISE'S MESSAGE (IPC has no status code) instead of an HTTP
  status. `picked-files-capability.test.ts`, `route-scoping.test.ts`, and
  `save-path-capability.test.ts` are trimmed in place (their `dialog`/
  `shell` cases moved out; their `media`/`publish`/`vcs`/… cases, outside
  this subrun's scope, are untouched) rather than deleted outright.

**Correction made during this run (not by instruction — by running the
verification the run specification requires):** the DETAILS section's own
suggestion — "the SFE-P5b review flagged `types.d.ts`'s `Window.electron`
block as a zero-consumer duplicate… if you confirm that, DELETE the
duplicate" — was acted on, then reverted after `bun run typecheck` actually
failed. SFE-P5b's search proved zero RUNTIME reads of `window.electron`
under `electron/`, which is true and unrelated to what broke: `electron/
main.ts` value-imports `src/lib/persistence-failures.ts`, which type-imports
`platform/contract.ts`, which type-imports `EditorProjectionArgs`/
`EditorProjectionOutcome` from `editor-host/editor-projection-capability.ts`
(SFE-P5b's own deliberate "pure forwarding survives for the DTOs" exception)
— a module that VALUE-imports `platform/bridge.ts`, whose `window.electron`
reference needs SOME ambient `Window.electron` type to satisfy `tsc -p
electron/tsconfig.json` (a program that does not include `src/app.d.ts`, the
SPA's own ambient declaration). This pre-existing chain — unrelated to this
run's own new `files-capability.ts` import, which hits the identical
failure a second way — means the block was never actually a zero-consumer
duplicate; it is a TYPE-graph dependency SFE-P5b's runtime-only search could
not see. Restored, with the header rewritten to record why, and extended to
also carry `fs`/`dialog`/`shell`/`log`/`app`'s shapes so it stays in
agreement with `contract.ts`'s `ElectronBridge` (verified by hand, same as
before — both are hand-maintained mirrors of the real preload boundary,
per `contract.ts`'s own header). Recorded here per D15 ("every deletion
claim requires search proof, dependency proof, and passing behavior
tests") — this is the passing-behavior-tests proof for a deletion claim
that did NOT hold up, caught before hand-off rather than after.

**Net diffstat** (reproduced against the committed range `dc900e96..f6a6bb2d`):

```
$ git diff --numstat dc900e96..f6a6bb2d -- packages/desktop/src packages/desktop/electron
→ +1,755 / −1,484  (net +271)
```

```
$ git diff --numstat dc900e96..f6a6bb2d -- packages/desktop/tests
→ +1,238 / −1,509  (net −271)
```

Production is net-positive (+271) despite deleting 1,119 route lines +
194 `api.ts` lines (−1,313 combined) because the new `electron/api/*.ts`
modules (1,025 lines) carry the SAME validation/hook logic the routes did
— this is a transport migration, not a feature deletion, so the
underlying logic's line count does not disappear, it moves — plus IPC
channel registrations in `main.ts`, preload/bridge/contract type
additions, and doc-comment explanation of the capability cut (the "why"
this section itself also records, same rationale SFE-P5b's own near-flat
production diffstat cites). Rule 9's "net LOC per subrun should trend
negative (route files + fetch plumbing die; validation moves rather than
grows)" is met on the ROUTE+CLIENT side specifically (−1,313 route+api.ts
lines) even though the SUM across the run is positive once the new
main-process modules land; the success-criterion net-LOC requirement is
scoped to the combined P4–P6 phases, not each individual P5 subrun (same
scoping SFE-P5b's section cites), and P5c1's test suite is net-negative
(−271) — real coverage moved to a leaner set of files (the deleted
route-level suites carried SvelteKit request/response plumbing per test
that the IPC-handler suites no longer need).

#### Search proofs (from repo root, against the working tree)

```
$ find packages/desktop/src/routes/api/{fs,dialog,shell,log,app} -maxdepth 0
(all five: No such file or directory — route directories deleted)

$ grep -rn "api\.fs\.\|api\.dialog\.\|api\.shell\.\|api\.log\.\|api\.app\." packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "src/lib/api.ts"
→ 9 hits, all doc/JSDoc comments describing the migration (buffer-state.
  svelte.ts, LogsPanel.svelte, contract.ts×2, api.contract-dto.type-test.ts,
  files-capability.ts×2, settings.svelte.ts, app-lifecycle-capability.ts) —
  zero real call sites (a permissive multi-line-chain-catching variant,
  `api\s*\.\s*(fs|dialog|shell|log|app)\b`, was also run and returns the
  same 9 comment-only hits, which is what caught the two real multi-line
  chains — `api.app\n    .discoverProjects()` in `projects-discover-
  cache.ts`, `api.app\n    .getNativeTheme()` in `theme.svelte.ts` — the
  single-line pattern above would have missed during this run's own sweep)

$ find packages/desktop/src/routes/api -name "+server.ts" | wc -l
69   (matches the re-baselined tools/architecture-baseline.json exactly)
```

#### Verification run (this lane, from repo root / `packages/desktop`)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages |
| `cd packages/desktop && bun run test` | 0 | 5816 pass, 1 skip, 0 fail |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 826 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean |
| `cd packages/desktop && bun run build` | 0 | production build + `check-render-purity` (142 files scanned, no forbidden host/node markers) clean |
| `bun run check:architecture` (repo root) | 0 | route ratchet 69 == baseline 69; ProseMirror ban, D4 import direction, future-package rules all PASS |
| `bun run check:generated-files` (repo root) | 0 | 1,333 tracked files scanned, no generated/output paths tracked |
| `bun run knip` (repo root) | 0 | zero unused files/dependencies/unlisted/binaries flagged |
| `cd packages/cli && bun run build` | 0 | unaffected by this lane's write ownership |
| `cd packages/editor && bun run test` | 0 | 3038 pass, 0 fail — unaffected by this lane's write ownership |

Two defects were found and fixed before hand-off, both by actually running
the gate rather than by inspection:

1. **The `types.d.ts` deletion** — see "Correction made during this run"
   above.
2. **Synchronous throw inside capability-module wrapper functions** — every
   new `$lib/files/files-capability.ts` and `$lib/app-lifecycle/
   app-lifecycle-capability.ts` function was first written as a plain
   (non-`async`) `function X(): Promise<T> { return call(bridge().ns.op(
   ...)); }`. `bridge().ns.op(...)` is evaluated EAGERLY as `call`'s
   argument; if `bridge()` (or `.ns`) throws before producing a promise —
   `tests/platform/theme.test.ts`'s mock omits `app` from its
   `window.electron` stub — the enclosing plain function throws
   SYNCHRONOUSLY to its caller instead of returning a rejected promise,
   breaking any `.then().catch()` call site (`theme.svelte.ts`'s
   `initTheme()`, `settings.svelte.ts`'s `_loadSettings()`). This is the
   SAME class of defect SFE-P5b's own hand-off note records for
   `editor-projection-capability.test.ts` (a function that "fails
   SYNCHRONOUSLY" tripping a `.rejects.toThrow()` assertion) — evidently a
   recurring pitfall of this `call(bridge()...)` wrapper shape, worth
   naming explicitly for whichever subrun writes the next capability
   module: **declare the wrapper `async function`**, not a plain function
   returning a `Promise`, so a synchronous throw during argument
   evaluation is captured into the returned promise's rejection instead of
   escaping to the caller. Fixed by converting all 16 new
   `files-capability.ts` functions and all 20 new `app-lifecycle-
   capability.ts` functions from `export function` to `export async
   function` (mechanical, verified by re-running the full suite — 7
   failures → 0).

### SFE-P5c2 — 2026-09-01 — migrate `project`/`manifest`/`tpl`/`snip`/`media`/`plugin`/`theme`/`vcs`/`style` to typed IPC

Lane A (implementation). Base SHA `f6a6bb2d` (SFE-P5c1's committed head, per
that section above). Head SHA `c90ac668`.

**Scoping note:** the plan's own P5c subrun table
(`docs/plans/source-first-editor/runs/SFE-P5c.md`) assigns `media` to P5c2,
which is where it lands here — `capability-map.md` §6's P0a-derived proposal
had `media` in P5c4 (a pre-P5c1 estimate the plan itself supersedes; that
section's own preamble says so). `electron/preload.ts`'s P5c1-era comment
("media:* server routes… P5c4") was accordingly stale and is corrected in
this run.

**What was deleted:**

- 37 `+server.ts` routes (1,058 lines) under `src/routes/api/{project,
  manifest,tpl,snip,media,plugin,theme,vcs,style}/**`: `project` (1 —
  `list-styles`), `manifest` (2 — `read`/`set-fields`), `tpl` (4 —
  `built-in`/`custom`/`import-from-folder`/`save-as-template`), `snip` (4 —
  `list`/`read`/`save`/`delete`), `media` (4 —
  `list-images`/`inspect`/`thumbnail`/`import-image`), `plugin` (6 —
  `list`/`set-enabled`/`add-npm`/`add-local`/`validate`/`recommended`),
  `theme` (11 — `active`/`apply`/`built-in`/`import-from-{file,folder,url}`/
  `previous`/`project`/`read-css`/`remove`/`revert`), `vcs` (4 —
  `enable-version-history`/`save-snapshot`/`restore-snapshot`/
  `list-snapshots-page`), `style` (1 — `set-active`). Route count 69 → 32
  (`tools/architecture-baseline.json`'s `desktopHttpRoutes` re-baselined in
  the same commit, per the ratchet's WARN-on-lower contract).
- **No routes were confirmed dead.** All 37 had a real caller enumerated
  before migration (see the per-namespace caller lists in the header
  comments of `electron/api/*.ts` and `project-config-capability.ts`/
  `vcs-capability.ts`) — unlike P5c1's `fs/copy-file`, nothing in this
  subrun's scope was a straight deletion. `vcs/enable-version-history` has
  **zero SPA callers today** (its own deleted route carried this exact
  note) but is NOT dead code: it is CLAUDE.md §7's documented "local-folder
  → versioned project" escape hatch, explicitly retained ahead of a
  version-history UI milestone (#13) by the humans who wrote the route —
  migrated (ported, not deleted) with that same note preserved verbatim in
  `electron/api/vcs.ts`.
- `src/lib/api.ts`'s `media`/`tpl`/`snip`/`plugin`/`theme`/`project`/
  `manifest`/`style`/`vcs` namespaces (net −187 lines: +22/−209) and their
  now-orphaned local types (`TemplateInfo`/`SavedTemplateInfo`/
  `SnippetEntry`/`ProjectConfigFields` — moved to `platform/dtos.ts`, the
  file the sibling `ThemeInfo`/`ProjectPluginEntry`/`ProjectStyle`/etc.
  DTOs already lived in) and now-unused internal (non-re-exported) type
  imports (`SnapshotEntry` from `contract.ts`; `ProjectPluginEntry`/
  `PluginValidationResult`/`RecommendedPlugin`/`ThemeInfo`/
  `ApplyThemeTarget`/`ThemeImportResult`/`ProjectStyle`/
  `ProjectClassification`/`MediaImageEntry`/`MediaImageDetails` from
  `dtos.ts`). The EXPORTED type re-exports for all of these stay in
  `api.ts` unchanged — `theme-grid.ts`/`config-helpers.ts` still import
  `ThemeInfo`/`ProjectPluginEntry`/etc. from `$lib/api` (type-only, zero
  runtime coupling) and were not required to move by the run's write
  ownership ("api.ts ONLY to delete migrated namespaces").

**What was added:**

- `electron/api/{project,manifest,tpl,snip,media,plugin,theme,vcs,style}.ts`
  (830 lines) — the main-process IPC handler logic, ported from the deleted
  routes, reusing `electron/api/validation.ts` (P5c1) verbatim for every
  `projectDir` guard — no path-validation logic was re-derived. Two shared
  helpers factored out in this run: `electron/api/lib-loader.ts` (38
  lines — `loadLib()`/`loadApiLib()`, the main-process twin of
  `_lib/route.ts`'s cache-once dynamic imports, shared by all nine
  handlers) and `electron/api/git-identity-args.ts` (27 lines — extracted
  from P5c1's `fs.ts`, which had its own private copy for `fs:delete`'s
  safety snapshot; `vcs.ts`'s `vcsEnableVersionHistory`/`vcsSaveSnapshot`
  now share that one implementation instead of a second copy — `fs.ts`
  itself shrank by 19 lines as part of this dedup).
- **Plugin (SPECIAL WEIGHT, D12/§5):** `electron/api/plugin.ts`'s
  `pluginAddNpm` calls the exact same `lib.addNpmPlugin` the deleted route
  called — the vendored-install pipeline (npm registry resolution, tarball
  verification, whole-tree vendoring, schema-v2 receipt, load-test) is
  UNTOUCHED main-process code this run never imports into, only calls.
  Preserved verbatim: the `RECOMMENDED_PLUGINS`-bundled fast path (no
  trust prompt), the native `confirmNpmPluginInstall` gate for third-party
  packages (declined → resolves `null`, no partial install), and the
  hooks-check-before-validation ORDER the deleted `defineRoute({ hooks,
  validate, call })` shape enforced (verified by `plugin-ipc.test.ts`'s
  "rejects an outside directory before showing the trust prompt" case —
  `confirmations` stays `[]`). `pluginValidate`'s degrade-and-report
  `{ ref, kind, enabled, ok, error? }` shape — what the Plugins panel
  renders as "Needs install"/inline load-error rows — is untouched;
  `PluginsSectionController`/`PluginsSection.svelte` never changed (they
  already received `validate`/`list`/etc. as injected functions, not a
  hard `api.plugin.*` dependency, so only their construction site in
  `ProjectSettingsView.svelte` needed a name swap).
- **VCS (SPECIAL WEIGHT):** `electron/api/vcs.ts`'s `vcsRestoreSnapshot`
  calls the exact same `lib.restoreVersionWithBackup`
  (`packages/cli/src/lib/source-provider.ts`) the deleted route called, with
  the same arguments — this is a snapshot-BEFORE-restore contract (a restore
  first snapshots the dirty working tree, so a restore can never lose
  in-progress author work), not a merge/checkout rollback: there is no merge
  step here. It is unit-tested in
  `packages/cli/src/lib/source-provider.test.ts` (outside this lane's write
  ownership; untouched) — "restoreVersionWithBackup snapshots dirty state
  before restoring", "restoreVersionWithBackup skips the backup when the
  tree is clean", and "restore failure after a backup snapshot reports the
  backup in the error". (The actual merge-then-checkout rollback guarantee —
  a pull that dies between merge and checkout must not publish a wholesale
  revert — is `packages/cli/src/lib/remote-auth/converge-merge.ts`'s
  `tipBeforeMerge`/`CheckoutConflictError`; that is the sync/pull path,
  P5c3's `remote`/`sync` scope, and unrelated to `vcs:restoreSnapshot`.)
  What this lane owns and tests (`vcs-ipc.test.ts`) is the desktop-side
  entry point staying wired unchanged: the 40-hex-char snapshot-id format
  guard (and the `list-snapshots-page` continuation-cursor guard) still
  rejects a malformed value BEFORE it can reach the lib's checkout, exactly
  as the deleted routes' own `error(400, …)` validation did.
- **Media payload shape (run note):** none of the four media routes ever
  moved raw image bytes as an upload — `media:importImage`'s `src` is
  always an absolute HOST PATH (from a native dialog or already on disk);
  the handler copies the file itself with `node:fs`, never reading bytes
  into the request/response body. `media:thumbnail` is the only place
  bytes cross the IPC boundary, and only as a `data:` URL STRING
  (base64-in-JSON) — `getMediaHooks().createThumbnail` and the SVG/
  tiny-file fallback both return `string | null`, never a `Buffer`. IPC's
  structured clone would carry a raw `Buffer` (avoiding ~33% base64
  inflation) but that would change the shape `MediaPanel.svelte`'s `<img
  src>` binding already depends on — kept as the exact `string | null`
  data-URL shape (rule 2: preserve behavior across the transport change;
  "improve the wire shape" was not this run's job).
- **Style (run note):** verified before migrating — `style:setActive`
  is the CSS editor's project-styling surface (replaces the manifest's
  active `styles:` list). `checkCss` (print-safety linting) was NEVER a
  `style.*`/`project.*` member; it is `api.lint.checkCss`, a separate
  namespace this run does not touch (P5c4).
- 37 new `secureHandle` IPC channel registrations in `electron/main.ts`
  (1 `project:*` + 2 `manifest:*` + 4 `tpl:*` + 4 `snip:*` + 4 `media:*` +
  6 `plugin:*` + 11 `theme:*` + 4 `vcs:*` + 1 `style:*`), named `<ns>:<op>`
  matching the established convention and the deleted `api.ts` method
  names 1:1 (`project.listStyles` → `project:listStyles`, etc.).
  `DESKTOP_API` bumped 7 → 8 in `electron/preload.ts` with a dated comment,
  matching P5c1's own convention.
- `src/lib/project-config/project-config-capability.ts` (276 lines, new
  module — D10/capability-map's "project config" bounded context) — all
  eight of `project`/`manifest`/`tpl`/`snip`/`media`/`plugin`/`theme`/
  `style` in one file: they share one consumer surface
  (`ProjectSettingsView.svelte`'s composition root plus `MediaPanel`/
  `EditorToolbar`/`SnippetPicker`/`NewProjectWizard`/`ExportDialog`), and
  `style` joins `project` specifically because `project.listStyles` +
  `style.setActive` already feed the same `StylesSection`/
  `StylesSectionController` pair — a dedicated module for one function
  would be ceremony `files-capability.ts`'s own precedent (grouping
  `shell` into the `fs`/`dialog` module on the same "no separate module
  for a one-function bounded sub-context" reasoning) already rejected.
  `src/lib/vcs/vcs-capability.ts` (65 lines, new module) is its own file
  per the run's dispatch note ("vcs joins app-lifecycle or its own small
  module") — SFE-P5b's capability map found nothing tying `vcs` to the
  project-config bounded context (its one live member, `saveSnapshot`, was
  dead at the time), and it carries the crash-safety weight documented
  above, which earned it a dedicated file rather than a corner of a
  eight-namespace module.
- `src/lib/platform/dtos.ts` gained `TemplateInfo`/`SavedTemplateInfo`/
  `SnippetEntry`/`ProjectConfigFields` (+56 lines) — moved from `api.ts`'s
  "genuinely api-local shapes" section now that `tpl`/`snip`/`manifest`
  are IPC, joining their already-resident siblings (`ThemeInfo`/
  `ProjectPluginEntry`/`ProjectStyle`/etc.).
  `src/lib/platform/contract.ts`'s `ElectronBridge` interface gained the
  nine matching members (+90 lines) built from `./dtos` types (extending
  the import list already used for `DiscoveredProject`/
  `ProjectClassification`) plus `SnapshotEntry`/`SnapshotPage`/
  `RestoreVersionResult` (already imported from `./shared-types` for
  other reasons). `electron/types.d.ts` and `electron/bridge-types.ts`
  gained the mirrored ambient/re-export shapes (+66 / +30 lines) — the
  same three-way hand-maintained-mirror discipline P5c1's `ElectronBridge`
  parity note describes. `src/app.d.ts` needed **zero changes** — it only
  imports `ElectronBridge` by name.
- 5 IPC-handler test files (881 lines total: 181 lines in two renamed/
  rewritten former route-test files + 700 lines in three wholly new files)
  replacing the deleted route-level tests:
  `manifest-style-ipc.test.ts` (renamed from `project-config-routes.test.ts`,
  content ported to call `manifestRead`/`manifestSetFields`/`styleSetActive`
  directly), `plugin-ipc.test.ts` (renamed from `plugin-add-npm-route.
  test.ts`, same rename-in-place treatment), `media-ipc.test.ts` (new —
  combines the deleted `media-routes-scoping.test.ts` + `media-import-
  image-route.test.ts`), `project-config-ipc.test.ts` (new — the
  project/manifest/tpl/snip/plugin/theme/style rows of the deleted
  `route-scoping.test.ts`'s `ROUTES` table, ported to call the handler
  functions directly, plus the `project:listStyles` repo-sharing round
  trips and the symlink-escape case that table's own file carried),
  `vcs-ipc.test.ts` (new — the `vcs/*` rows of the same table, PLUS the
  SPECIAL WEIGHT snapshot-id/cursor format guards and the
  hooks-not-registered-before-validation ordering case). `route-scoping.
  test.ts` (still-HTTP `remote`/`publish`/`lint` rows) and `picked-files-
  capability.test.ts` (its `media:importImage` half) are trimmed/updated
  in place rather than deleted outright, per the run's own precedent for
  shared cross-namespace test files. Every scoping/round-trip scenario
  from the deleted route tests is ported, asserting the REJECTED PROMISE'S
  MESSAGE (IPC has no status code) instead of an HTTP status.
- 4 pre-existing source-string test files that asserted the OLD
  `api.<ns>.<method>(...)` call-site text were updated to the new call
  text (mechanical rename, same class of fix as P5c1's `NewProjectWizard.
  test.ts` precedent): `ProjectActivityView.test.ts` (`api.vcs.
  restoreSnapshot` → `vcsRestoreSnapshot`; the "all host work goes through
  the typed api wrapper" test now checks for `$lib/vcs/vcs-capability`
  instead of `$lib/api`), `SnippetPicker.test.ts` (`api.snip.delete` →
  `snipDelete`, twice), `export-dialog.test.ts` (`api.tpl.saveAsTemplate`
  → `tplSaveAsTemplate`), `git-identity-and-activity.test.ts` (the
  file-content checks that used to read `src/routes/api/vcs/{save-
  snapshot,enable-version-history}/+server.ts` for `authorName`/
  `authorEmail` now read `electron/api/vcs.ts` for the shared
  `gitIdentityArgs()` call inside each function's own body, plus a check
  that `git-identity-args.ts` calls `gitIdentityFrom`; the `activity`
  string check for `api.vcs.listSnapshotsPage` → `vcsListSnapshotsPage`).

**Host-services test-isolation fix (found and fixed by this lane, before
hand-off):** running the full suite after the initial port showed 2
order-dependent failures (`doctor-route.test.ts`, `app-ipc.test.ts`) that
both passed in isolation — a process-global `registerHostServices()` leak.
The deleted `route-scoping.test.ts`/`project-config-routes.test.ts` never
saved/restored host services in `afterEach` (only some sibling suites,
e.g. `media-import-image-route.test.ts`/`picked-files-capability.test.ts`,
already did); this run's ported/new files inherited that same gap, and
adding the new files apparently shifted execution order enough to surface
it. Fixed by adding the `savedHostServices = getHostServices()` /
`registerHostServices(savedHostServices as HostServices)` save-restore
pair (`picked-files-capability.test.ts`'s own established convention) to
`route-scoping.test.ts`, `project-config-ipc.test.ts`, `vcs-ipc.test.ts`,
`manifest-style-ipc.test.ts`, and `media-ipc.test.ts`'s
`withScopingFixture` helper. Full suite: 2 failures → 0.

**Net diffstat** (reproduced against the committed range `f6a6bb2d..c90ac668`):

```
$ git diff --numstat f6a6bb2d..c90ac668 -- packages/desktop/src packages/desktop/electron
→ +1,865 / −1,375  (net +490)
```

```
$ git diff --numstat f6a6bb2d..c90ac668 -- packages/desktop/tests   (committed range, incl. 2 renames)
→ +850 / −730  (net +120)

$ git diff --no-renames --numstat f6a6bb2d..c90ac668 -- packages/desktop/tests
→ +976 / −856  (net +120, same)

Test total: +850 / −730  (net +120)
```

(An earlier draft of this section measured `+95/−856` — net −61 — against
the uncommitted working tree while `plugin-ipc.test.ts` and
`manifest-style-ipc.test.ts`, both git-detected RENAMES of pre-existing
files once committed, were still untracked; their combined content (93 + 88
= 181 lines, per `git diff --no-renames --numstat` on each file above)
never reached that numstat while untracked, and was not counted in the "3
new *-ipc.test.ts files, 700 lines" bullet either — that bullet named only
the three genuinely new files (`vcs-ipc.test.ts`, `media-ipc.test.ts`,
`project-config-ipc.test.ts`). −61 + 181 = +120, matching the committed-range
figure above exactly.)

Same shape as P5c1's own accounting: production is net-positive (+490)
because this is a transport migration, not a feature deletion — the
`electron/api/*.ts` handlers (830 lines) carry the SAME validation/lib-call
logic the 37 deleted routes (1,058 lines) did, plus the new capability
modules (341 lines), IPC channel registrations, and preload/bridge/contract
type additions the transport change requires. Rule 9's "route files + fetch
plumbing die; validation moves rather than grows" holds on the route+api.ts
side specifically (routes −1,058, `api.ts` net −187, dtos.ts local-type
moves net neutral = −1,245 combined) even though the run-wide sum is
positive; the success-criterion net-LOC requirement is scoped to the
combined P4–P6 phases, not each P5 subrun (same scoping P5c1's own section
cites). The test suite is net-POSITIVE this subrun (+120), unlike P5c1's
own test accounting: five new IPC-handler test files (`vcs-ipc.test.ts`,
`media-ipc.test.ts`, `project-config-ipc.test.ts`, and the renamed
`plugin-ipc.test.ts`/`manifest-style-ipc.test.ts`) add real per-namespace
scoping and SPECIAL WEIGHT coverage (the plugin trust-prompt ordering case,
the vcs snapshot-id format guards, the vcs hooks-not-registered-before-
validation case) that the route-level suites they replace did not carry at
the same density, and the deleted route-level plumbing they DO remove
(SvelteKit `Request`/`Response` construction, `isHttpError` status
assertions) is smaller per-test than P5c1's own routes were.

#### Search proofs (from repo root, against the working tree)

```
$ find packages/desktop/src/routes/api/{project,manifest,tpl,snip,media,plugin,theme,vcs,style} -maxdepth 0
(all nine: No such file or directory — route directories deleted)

$ grep -rn "api\.\(media\|tpl\|snip\|plugin\|theme\|project\|manifest\|style\|vcs\)\." packages/desktop/src --include="*.ts" --include="*.svelte" | grep -v "src/lib/api.ts:"
→ 4 hits, all doc/JSDoc comments describing the migration (contract.ts's
  historical P5b note, project-config-capability.ts×1, vcs-capability.ts×1)
  — zero real call sites (the permissive multi-line-chain-catching variant,
  `api\s*\n?\s*\.\s*(media|tpl|snip|plugin|theme|project|manifest|style|
  vcs)\.`, was also run per P5c1's own report warning and returns the same
  4 files with no additional real call sites — no multi-line chain like
  P5c1's `api.app\n  .discoverProjects()` case exists for these nine
  namespaces)

$ find packages/desktop/src/routes/api -name "+server.ts" | wc -l
32   (matches the re-baselined tools/architecture-baseline.json exactly)
```

#### Verification run (this lane, from repo root / `packages/desktop`)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages |
| `cd packages/desktop && bun run test` | 0 | 5824 pass, 1 skip, 0 fail |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 755 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean |
| `cd packages/desktop && bun run build` | 0 | production build + `check-render-purity` (142 files scanned, no forbidden host/node markers) clean |
| `bun run check:architecture` (repo root) | 0 | route ratchet 32 == baseline 32; ProseMirror ban, D4 import direction, future-package rules all PASS |
| `bun run knip` (repo root) | 0 | zero unused files/dependencies/unlisted/binaries flagged |

One defect was found and fixed before hand-off, by actually running the
gate rather than by inspection: `electron/api/theme.ts`'s first-draft
`themeApply` used a hand-rolled `{ kind: string; id: string }` validation
shape instead of the real discriminated-union `ApplyThemeTarget` (`{kind:
"builtin", id} | {kind: "project", id}` — already defined in
`platform/dtos.ts`), so `lib.applyTheme(projectDir, target as
ApplyThemeTarget)` failed `bun run typecheck` with a type mismatch against
the lib's own stricter `ApplyThemeTarget`. Fixed by importing the real type
from `dtos.ts` instead of hand-declaring a loose local one (the same fix
class as reusing an existing DTO rather than inventing a parallel shape).

### SFE-P5c3 — 2026-09-01 — migrate `remote`/`sync`/`publish` to typed IPC (the credentials-sensitive group)

Lane A (implementation). Base SHA `b77a6524` (SFE-P5c1+P5c2's committed
review-repair head, per the P5c2 section above). Head SHA `4616add1`
(`refactor(p5): P5c3 — remote, sync and publish routes to typed IPC`); the
quoted diffstat below is reproducible as `git diff --numstat b77a6524
4616add1`.

**What was deleted:**

- 22 `+server.ts` routes under `src/routes/api/{remote,sync,publish}/**`:
  `remote` (13 — `clone-repository`/`connect-generic-host`/
  `diagnose-project`/`disconnect-github`/`disconnect-host`/
  `forge-token-url`/`get-connection`/`list-branches`/`list-connections`/
  `list-repo-books`/`list-repositories`/`sync`/`test-remote-access`),
  `sync` (2 — `set-auto-sync`/`status`), `publish` (7 — `connect`/
  `disconnect`/`list`/`preflight`/`providers`/`run`/`set-config`), plus
  their `_hooks.ts` shared helpers (`remote/_hooks.ts`, `publish/_hooks.ts`
  — SvelteKit-route-specific re-exports over `electron/server-bridge/
  remote-hooks.ts`/`friendly-errors.ts`, superseded by direct imports in
  the new `electron/api/*.ts` modules). Route count 32 → 10
  (`tools/architecture-baseline.json`'s `desktopHttpRoutes` re-baselined in
  the same commit).
- **No routes were confirmed dead.** All 22 had a real caller enumerated
  before migration (`ConnectionsSettings.svelte`, `GitHubDialog.svelte`,
  `ProjectConnectionsSection.svelte`, `SyncStatusPill.svelte`,
  `+page.svelte`, `publish-section-controller.svelte.ts`).
- `src/lib/api.ts`'s `remote`/`sync`/`publish` namespaces (22 methods, net
  −280 lines: +9/−289) and the now-orphaned `PublishProviderStaticInfo`
  local interface (moved to `platform/contract.ts` — see below) and unused
  type imports (`RemoteConnection`/`RemoteRepository`/`RemoteBranch`/
  `RepoBook`/`RemoteAccessResult`/`ProjectRemoteDiagnosis`/
  `ConnectGenericHostArgs`/`HostConnectionInfo`/`SyncOutcome`/`SyncStatus`/
  `CloneRepositoryArgs`/`PublishProviderCard`/`PublishIssue`/
  `PublishOutcomeInfo`/`PublishRunResult`/`PreflightRow`). `SnapshotEntry`
  (a pre-existing, already-orphaned re-export unrelated to this subrun's
  three namespaces) is left untouched — out of this run's write ownership
  ("api.ts ONLY to delete migrated namespaces").
- `src/lib/server/settings.ts` (26 lines) — a route-only `gitIdentityArgs()`
  twin whose ONLY real caller was the deleted `remote/sync` route (its
  mentions elsewhere, in `electron/git-identity.ts`'s and
  `electron/api/git-identity-args.ts`'s doc comments, were prose, not
  imports). `bun run knip` caught this as an unused file after the route
  deletion; not anticipated at design time, found by actually running the
  gate. Deleted, with the four comment references to it corrected in place
  (`electron/git-identity.ts`, `electron/api/git-identity-args.ts` ×2,
  `git-identity-and-activity.test.ts`, `auto-snapshot-scheduler.test.ts`).

**What was added:**

- `electron/api/remote.ts` (327 lines) and `electron/api/publish.ts` (372
  lines) — the main-process IPC handler logic, ported from the deleted
  routes verbatim (same validation, same `handleRemoteErrors`/
  `handlePublishErrors` wrapping — including the ordering-load-bearing
  detail of which checks run BEFORE vs. INSIDE those wrappers, since that
  ordering decides whether a message survives verbatim or gets genericized;
  reproduced exactly, not "fixed"), reusing `electron/api/validation.ts`
  (P5c1) and `electron/api/git-identity-args.ts` (P5c2) verbatim — no
  path-validation or identity logic re-derived. `remoteCloneRepository` and
  `syncSetAutoSync`/`syncGetStatus` call straight through to the SAME
  `remoteHooksImpl.cloneRepository`/`syncSettingsHooksImpl` closures
  `electron/main.ts` already built (unchanged) — `cloneRepository` in
  particular needs live `mainWindow`/`safeSend` access for its
  `remote:cloneProgress` push, which only a closure built inside `main.ts`
  can reach; the new handler module reuses it through `getRemoteHooks()`
  rather than re-deriving it. `publishPreflight` alone needs no hooks bag
  (matching the deleted route, which never touched one) and reaches the
  real lib through `electron/api/lib-loader.ts`'s process-cached
  `loadLib()`.
- 22 `secureHandle` registrations in `electron/main.ts`, reusing the
  channel names the routes' own `handleRemoteErrors`/`handlePublishErrors`
  call-site labels already used (`remote:diagnoseProject`,
  `publish:setConfig`, …) — and, for `sync:setAutoSync` /
  `remote:cloneRepository`, the exact channel names those two carried
  before ARCH review #8 moved them to HTTP (this run reverses that framing
  for the whole group, D10).
- `src/lib/publish/publish-capability.ts` (100 lines, new module) — the
  smallest-honest-shape decision named in this run's own brief: publishing
  does NOT join `$lib/export/build-preview-capability.ts` (D10's "build/
  preview/export" context owns only the live preview/build pipeline —
  `ExportController`/`ProjectLifecycleController` — a different caller set
  from publishing's `ConnectionsSettings.svelte`/`PublishWizard.svelte`/
  `+page.svelte`, and folding in 7 credential-adjacent members would mix
  two concerns that only share a word). It gets its own small file instead,
  matching the `vcs-capability.ts` precedent (own module despite being
  adjacent to another named D10 context).
- `src/lib/remote/remote-capability.ts` gained 14 new functions
  (`disconnectGitHub`/`getRemoteConnection`/`listRemoteRepositories`/
  `listRemoteBranches`/`listRepoBooks`/`diagnoseProjectRemote`/
  `testRemoteAccess`/`connectGenericHost`/`disconnectHost`/
  `listHostConnections`/`forgeTokenUrl`/`syncChanges`/`getSyncStatus`, plus
  `cloneRemoteRepository`/`setAutoSync` REWIRED from the HTTP client onto
  the bridge) — every one wrapped in the module's own `call()` helper
  (`friendlyHostError`-scrubbed), the same discipline `files-capability.ts`/
  `vcs-capability.ts` established; the pre-existing
  `connectGitHubStart`/`Wait`/`Cancel`/`onCloneProgress`/`onSyncStatus`
  members are untouched.
- `ElectronBridge` (`contract.ts`) gained `remote`/`sync`/`publish` members
  (+96 lines); `electron/preload.ts`/`types.d.ts`/`bridge-types.ts` gained
  the mirrored ambient/re-export shapes — the same three-way
  hand-maintained-mirror discipline P5c1/P5c2 established. `DESKTOP_API`
  bumped 8 → 9. `PublishProviderStaticInfo` moved from `api.ts`'s
  "genuinely api-local shapes" section to `contract.ts` proper (referenced
  by `ElectronBridge.publish.providers()` directly — the same "stays in
  contract.ts, referenced by ElectronBridge" reasoning already documented
  there for `FolderRef`/`PreviewStartArgs`/etc.), NOT a type-only
  back-import from `publish-capability.ts` — see the next paragraph for why
  that specific shape matters.
- **A landmine this lane hit and fixed, not anticipated at design time:**
  `publish.preflight()`'s natural return type is `$lib/preflight.ts`'s
  `PreflightRow[]`, but that module value-imports `./problems.ts`, which
  imported `ProblemEntry` via the `$lib/platform/dtos` ALIAS — unresolvable
  under `tsc -p electron/tsconfig.json` (no `$lib` alias configured there;
  the exact landmine `files-capability.ts`'s header already documents for
  the same reason). Reached for the first time this run because
  `electron/api/publish.ts` is the first `electron/api/*.ts` module to
  reuse `$lib/preflight.ts`'s pure shaping logic. Fixed two ways: (1)
  `problems.ts`'s `ProblemEntry` import changed from the `$lib` alias to a
  relative path (`./platform/dtos` — a type-only import, zero runtime
  change, resolves identically under both tsconfigs); (2)
  `ElectronBridge.publish.preflight()`'s raw-bridge-layer return type is
  `Promise<unknown[]>`, not `Promise<PreflightRow[]>` — the same
  loose-bridge/richly-typed-capability split `sync.getStatus` already
  carries for the analogous reason (documented inline at both sites) —
  `publish-capability.ts`'s own `preflight()` export casts to the real
  type for its callers.
- 2 new IPC-handler test files (816 lines): `remote-ipc.test.ts` (461
  lines) and `publish-ipc.test.ts` (355 lines), replacing the deleted
  route-level tests (`remote-path-validation.test.ts`, deleted outright;
  the `remote`/`publish` rows of `route-scoping.test.ts`'s `ROUTES` table;
  the `sync`/`remote` describe blocks of `migrated-ipc-routes.test.ts`).
  Each covers, per function: hooks-not-registered ("host disconnected"),
  validation that stays literal (outside `handleRemoteErrors`/
  `handlePublishErrors`) vs. genericized (inside — preserved verbatim, both
  directions, across the transport change), success paths asserting the
  exact lib/hooks call made, a dedicated "no token in response" describe
  block (see below), and the ported project-scoping table (outside/
  sibling-prefix/no-project-open/repo-root/symlink-escape cases, now
  asserting a thrown `Error`'s message instead of an HTTP status) plus
  `publishRun`'s artifactPath picked-vs-not-picked/relative/`../`-escape
  cases. `route-scoping.test.ts` and `migrated-ipc-routes.test.ts` are
  trimmed in place (not deleted) — `lint/project` and the updater describe
  block are still-HTTP, out of this subrun's scope. 6 pre-existing
  source-string test files updated to the new call-site text
  (`settings-connections.test.ts`, `publish-wizard.test.ts`,
  `ux-writer-friendly.test.ts`, `remote-capability.test.ts` — rewritten to
  assert bridge delegation instead of `fetch` for `cloneRemoteRepository`/
  `setAutoSync`, plus new delegation+scrub coverage for the 13 functions
  that joined the module this run — `git-identity-and-activity.test.ts`,
  `auto-snapshot-scheduler.test.ts`).

**SECURITY (D12) — secret-isolation proof:** every new IPC channel's
response shape was grepped for token-bearing fields
(`packages/desktop/electron/api/{remote,publish}.ts`). Three shapes touch
credential material and each is provably redaction-safe:

1. `remoteConnectGenericHost` receives a raw token and gets a FULL
   credential object back from `lib.connectGenericHost` (including
   `token`) — the handler builds a NEW literal `{ connected, host,
   username? }` return value rather than forwarding the lib's object, so
   the token can never reach the return path. Proven by a dedicated test
   (`remote-ipc.test.ts`) that stubs the lib to return a real-looking
   secret string and asserts `JSON.stringify(result)` never contains it.
2. `publishConnect` receives a raw token and returns exactly what
   `lib.connectPublishProvider` resolves to — that function's own
   TypeScript contract types its result as `{ connected, providerId }`
   (no token field), so there is no token-shaped value to accidentally
   forward; proven the same way (`publish-ipc.test.ts`).
3. `remoteGetConnection`/`remoteListConnections`/`publishListProviders`
   forward `TokenStore.status()`/`listRedacted()`'s OWN return values
   unchanged — that interface's contract (`electron/server-bridge/
   remote-hooks.ts`) already excludes `token` by construction, unchanged by
   this run; a defense-in-depth test proves the actual forwarded values
   never carry a probe secret string either.
4. `remoteSync`/`remoteCloneRepository`/`publishRun` pass the `TokenStore`
   object BY REFERENCE into the lib (never a raw token string) and return
   the lib's own sync/clone/publish outcome shapes, none of which are
   typed to carry credential material.

No channel returns a raw token **on a success response**. `remote:getConnection`'s
comment ("NEVER returns the token") and `publish:connect`'s ("Response is
redacted") are the same invariants the deleted routes documented, preserved
verbatim.

That qualifier is load-bearing, not decorative: round-1 review found the
four success-shape proofs above did not extend to the ERROR channel.
`handleRemoteErrors`/`handlePublishErrors` (`electron/server-bridge/
friendly-errors.ts`) rethrow any message matching their author-friendly
allowlist VERBATIM, and a transport failure's message (or its `.cause`) can
echo the request URL, including userinfo, when one is present — the
functions' own `redactUrlCredentials` doc comment names this exact hazard.
Before this repair round, `redactUrlCredentials` was applied only to the
copy headed for `console.error`, not to the rethrown message the renderer
actually receives, so a caught-but-friendly transport error could leak a
token through the UI. No live exploit was found: the lib's remote/publish
paths emit fixed author-facing strings by construction (this pair's own base
commit, unchanged), so no real code path was observed producing a
credentialed message. Fixed by redacting on the rethrow in both wrappers
(one line each) and pinned with a new case in each file's existing "no token
in response" describe block (`remote-ipc.test.ts`, `publish-ipc.test.ts`): a
stubbed lib throw carrying `https://author:SECRET@git.example.com/book.git`
now surfaces to the caller with the userinfo replaced by `(redacted)` and
neither the token nor `author:` present in the message.

**The merge/checkout rollback guarantee:** `remoteSync` calls
`lib.syncProject(...)` with the identical argument shape
(`projectDir`/`tokenStore`/`authorName?`/`authorEmail?`/`message?`) the
deleted route always used — the pull-dies-between-merge-and-checkout
rollback mechanism itself lives entirely inside
`packages/cli/src/lib/remote-auth/converge-merge.ts` (out of this lane's
write ownership) and is untouched by this transport change. Re-ran its
test suite directly as evidence it still exercises the real mechanism:
`cd packages/cli && bun test src/lib/remote-auth/converge-merge.test.ts` →
3 pass, 0 fail.

**Publish progress-shape finding:** `publish/run` never polled and never
used a push channel — the deleted route called `lib.runPublish(options, {
tokenStore, onProgress })`, where `onProgress` appended each butler/swa
output line into a local `string[]` (capped at 500 lines), and the route
returned `{ ...result, log }` in ONE response once the run finished.
`publishRun` (`electron/api/publish.ts`) reproduces this exactly — same
callback shape, same cap, same one-shot response — so no new stream was
invented; the "check readiness" dry-run and the real publish are each
still a single request/reply IPC call, matching run rule 3's guidance
("if a publish route polled for status, the IPC replacement may keep the
same request/reply polling — do not invent a new stream") for the case
that was actually true here (no polling either). Proven by
`publish-ipc.test.ts`'s "collects progress lines into a bounded log" test.

**Re-baseline:** `tools/architecture-baseline.json`'s `desktopHttpRoutes`
32 → 10 (matches `find packages/desktop/src/routes/api -name "+server.ts"
| wc -l` exactly — the 5 route dirs left, `{doctor,lint,recovery,status,
updater}`, are P5c4's territory).

**Net diffstat** (working tree at hand-off, `git diff --numstat` against
base `b77a6524`, new untracked files included via a stage/unstage round
trip so the numbers cover the whole subrun):

```
production (packages/desktop/electron + packages/desktop/src): +1,370 / −1,269  (net +101)
tests (packages/desktop/tests):                                   +996 / −462  (net +534)
combined:                                                       58 files changed, +2,366 / −1,731
```

Same shape as P5c1/P5c2's own accounting: production is close to flat
(net +101, smaller than either prior subrun's positive delta) because this
is a transport migration carrying real security-load-bearing logic
(credential redaction, the three-way bridge type mirror, the
`handleRemoteErrors`/`handlePublishErrors` ordering) rather than a feature
deletion — the 22 deleted routes' validation/lib-call logic moves into
`electron/api/{remote,publish}.ts` almost 1:1, plus the two new capability
modules and the IPC channel/type plumbing the transport change requires.
The route+api.ts side alone is net-negative (routes losslessly deleted,
`api.ts` net −280, `src/lib/server/settings.ts` −26 = well over −1,000
combined), consistent with rule 9's "route files + fetch plumbing die;
validation moves rather than grows" holding on that specific slice even
though the run-wide production sum is mildly positive; the success
criterion's net-LOC requirement is scoped to the combined P4–P6 phases,
not each P5 subrun individually (same scoping precedent P5c1/P5c2 cite).
Tests are net-positive (+534) for the same reason P5c1/P5c2's own test
suites were: `remote-ipc.test.ts`/`publish-ipc.test.ts` add real
per-function validation-ordering, no-token-in-response, and scoping
coverage that route-level tests did not carry at the same density.

#### Search proofs (from repo root, against the working tree)

```
$ find packages/desktop/src/routes/api/{remote,sync,publish} -maxdepth 0
(all three: No such file or directory — route directories deleted)

$ find packages/desktop/src/routes/api -name "+server.ts" | wc -l
10   (matches the re-baselined tools/architecture-baseline.json exactly)

$ grep -rn "api\.remote\.\|api\.sync\.\|api\.publish\." packages/desktop/src packages/desktop/tests
→ 5 hits, all doc/JSDoc comments describing the migration (SyncStatusPill.svelte,
  api.ts, publish-capability.ts, remote-capability.ts,
  remote-capability.test.ts) — zero real call sites
```

#### Verification run (this lane, from repo root / `packages/desktop`)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages |
| `cd packages/desktop && bun run test` | 0 | 5898 pass, 1 skip, 0 fail |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 711 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean |
| `cd packages/desktop && bun run build` | 0 | production build + `check-render-purity` (142 files scanned, no forbidden host/node markers) clean |
| `bun run check:architecture` (repo root) | 0 | route ratchet 10 == baseline 10; ProseMirror ban, D4 import direction, future-package rules all PASS |
| `bun run knip` (repo root) | 0 | zero unused files/dependencies/unlisted/binaries flagged |

Two defects were found and fixed before hand-off, by actually running the
gate rather than by inspection:

1. `src/lib/server/settings.ts` went orphaned once `remote/sync` (its only
   real caller) was deleted — `bun run knip` caught it; see "What was
   deleted" above.
2. `electron/api/publish.ts` reusing `$lib/preflight.ts` pulled
   `$lib/problems.ts`'s aliased `$lib/platform/dtos` import into
   `tsc -p electron/tsconfig.json`'s program for the first time — `bun run
   typecheck` caught it; see the "landmine" paragraph above.

Two test-suite failures surfaced by an initial `bun run test` pass and were
fixed before hand-off: `remote-capability.test.ts`'s generic
delegation-table test wrongly expected `setAutoSync`'s bridge result back
(that function's own pre-existing signature is `Promise<void>` and
discards it — fixed the table entry, not the function);
`settings-connections.test.ts`'s "exactly one connect-a-git-server call
site" assertion counted the bare identifier `connectGenericHost`, which
now also appears once in the SFE-P5c3 capability import line — fixed to
count the call-site pattern `connectGenericHost(` instead.

### SFE-P5c4 — 2026-09-01 — migrate `updater`/`recovery`/`doctor`/`lint` to typed IPC (the LAST route group — route ratchet reaches zero)

Lane A (implementation). Base SHA `4616add1` (SFE-P5c1–P5c3's committed
head). Head SHA `0758cb9e` (`refactor(p5): P5c4 — the last ten routes to
typed IPC; route count ZERO`).

**What was deleted:**

- All 10 remaining `+server.ts` routes under `src/routes/api/**`, plus the 3
  `_lib` helpers with no consumer left to move to (`_lib/route.ts` —
  `defineRoute`/`jsonRoute`/`loadLib`/`loadApiLib`; `_lib/handler.ts` —
  `jsonRoute`/`requireAbsolute`; `_lib/fs-guard.ts` — the SvelteKit-status
  outer shim over `isWithinAnyRootCanonical`): `updater` (3 —
  `get-status`/`check`/`download`), `recovery` (3 —
  `write`/`clear`/`list`), `doctor` (1), `lint` (2 —
  `check-css`/`project`), `status` (1 — dead, see below). 13 files, all of
  `src/routes/api/**`, deleted in one shot — `src/routes/api/` no longer
  exists. Route count 10 → 0 (`tools/architecture-baseline.json`'s
  `desktopHttpRoutes` re-baselined in the same commit); the ratchet target
  P5c1 opened with (104) and every subrun since has driven toward is now
  met.
- **`status` was the one genuinely dead route in the whole P5c group.**
  `api.ts`'s own comment already recorded this ("ARCH review #8 — this
  wrapper had zero callers... the route itself is left in place... harmless
  to keep reachable even with no current client"). Re-verified before
  deletion: `grep -rn "api/status\|routes/api/status"` across
  `packages/desktop/{src,electron,tests}` returned exactly one hit —
  `api.ts`'s own comment, now gone with the file. No IPC replacement was
  built for it; it is simply gone, with the search proof above as the "dead
  route dies with proof" evidence the run brief required.
- `src/lib/api.ts` (177 lines) — deleted outright, not reduced to a
  tombstone. By the time this subrun started it was down to the `doctor`/
  `lint`/`recovery`/`updater` namespaces plus a type-re-export barrel (the
  `post`/`get` fetch helpers, `_post`/`_get`); once those four namespaces
  moved to typed IPC, nothing in the file did any work a capability module
  didn't already do better, and its type re-exports were the only reason
  anything still imported it. Searched every `import ... from "$lib/api"` /
  `"./api"` (type and value) across `src`/`tests` (18 files) and redirected
  each to the DTO's real home (`$lib/platform/dtos` for the ~10 plain
  request/response shapes it had been re-exporting from there, e.g.
  `ThemeInfo`/`ProjectPluginEntry`/`ProjectConfigFields`/`DoctorDiagnostics`;
  `$lib/platform/contract` for `SnapshotEntry`/`SyncOutcome`, which live in
  `shared-types.ts` and are re-exported from `contract.ts` by name already)
  — see "What was added" below for the one real straggler this search
  caught. `fetch("/api/…")` plumbing (`post`/`get`) is now fully absent from
  `packages/desktop/src` — the P5d search proof this run's own DETAILS
  section named ("api.ts typed fetch client → absent") is satisfied now,
  not deferred to P5d.
- `electron/server-bridge/updater-hooks.ts` and
  `electron/server-bridge/recovery-hooks.ts` were considered for the same
  fan-out-collapse treatment `updater-capability.ts` got on the renderer
  side, but were kept unchanged: both bags exist to reach state that lives
  either inside a sibling module's own closures (`electron/updater.ts`'s
  `phase`/`lastError`/`activeAutoUpdater`, populated once by `initUpdater()`)
  or inside `main.ts`'s own local scope (`recoveryDir()`), and
  `electron/api/*.ts` modules cannot import `main.ts` directly (main.ts
  imports them — the same circular-dependency reason `vcs-hooks.ts`/
  `remote-hooks.ts`/every other hooks bag in this codebase exists). Removing
  them would have meant either duplicating that state inside
  `electron/api/updater.ts`/`recovery.ts` (a second, un-synchronized copy)
  or restructuring `main.ts`'s initialization order — out of this run's
  "swap the transport, port the handler logic" scope. `DoctorHooks`/
  `getDoctorHooks` (`host-hooks.ts`) were kept for the same reason
  (`app.getVersion()` alone has no closure state, but the hooks bag already
  existed and the deleted route never gated on it being present — see
  `electron/api/doctor.ts`'s doc comment). `src/lib/server/host-hooks.ts`
  and `src/lib/server/updater.ts` (the two `$lib/server/*` thin re-export
  shims those hooks used to reach through) DID die: both existed solely for
  the now-deleted `doctor`/`updater` routes (`grep -rln '\$lib/server'`
  before deletion found no consumer outside those routes and the two shim
  files themselves) — `src/lib/server/` is now empty and deleted with them.

**What was added:**

- `electron/api/updater.ts`, `electron/api/recovery.ts`,
  `electron/api/doctor.ts`, `electron/api/lint.ts` — the main-process IPC
  handler logic, ported from the four deleted route groups verbatim (same
  hooks bag, same "hooks not registered" fail-closed check run BEFORE
  validation where the deleted routes' `defineRoute({hooks, validate,
  call})` order required it — recovery/updater; same graceful-degrade-to-
  "unknown" where the deleted route never gated on the hooks bag at all —
  doctor; same `requireProjectDir` project-scoping guard, reused not
  re-derived, for `lint:project`), reusing `electron/api/validation.ts`
  (P5c1) and `electron/api/lib-loader.ts` (P5c2) verbatim.
- 9 `secureHandle` registrations in `electron/main.ts` (111 → 120):
  `updater:getStatus`/`updater:check`/`updater:download` (joining the
  pre-existing `updater:applyNow`), `recovery:write`/`recovery:clear`/
  `recovery:list`, `doctor:getDiagnostics`, `lint:checkCss`/`lint:project`.
- `src/lib/doctor/doctor-capability.ts`,
  `src/lib/recovery/recovery-capability.ts`, `src/lib/lint/lint-capability.ts`
  — three new, small capability modules (the contexts P5b's capability map
  did not yet own a module for), each a handful of plain functions
  forwarding to `bridge()`, no ceremony for what are largely single- or
  two-consumer slices (D4/P5b's stated design constraint).
  `src/lib/update/updater-capability.ts` (SFE-P5b) is REWRITTEN in place,
  not replaced: its
  header now records the fan-out collapse — `getStatus`/`check`/`download`
  join `applyNow`/`onEvent` on the bridge, so all five members share one
  transport for the first time since ARCH review #8 split them onto HTTP.
- `ElectronBridge` (`contract.ts`) gained `recovery`/`doctor`/`lint`
  members and its `updater` member widened from `Pick<UpdaterApi, "applyNow"
  | "onEvent">` to the full `UpdaterApi` shape; `electron/preload.ts`/
  `types.d.ts`/`bridge-types.ts` gained the mirrored ambient/re-export
  shapes — the same three-way hand-maintained-mirror discipline P5c1–P5c3
  established. `DESKTOP_API` bumped 9 → 10.
- **The one real straggler the `$lib/api` import search caught, not
  anticipated at design time:** `ProjectSettingsView.svelte`'s
  `listMissingPrintTools` callback called `api.doctor()` with the method
  call split across a line break (`api\n  .doctor()`), which an earlier
  single-line grep for `api.doctor` inside this same review missed on a
  first pass — found on a second, multiline-aware sweep before hand-off, not
  after. Fixed the same way every other real call site was: swapped for
  `getDoctorDiagnostics()` from the new capability module. Recorded here
  because it is exactly the kind of caller-inventory miss the run's own
  "enumerate api.ts methods and callers with the permissive multi-line
  grep" instruction exists to catch, and because a lane that skipped it
  would have shipped a component whose print-tool note silently stopped
  updating (the `import { api }` binding would have gone dead, not
  errored — `svelte-check`/`tsc` cannot catch a call site that still
  resolves to something, only to nothing).
- 4 new IPC-handler test files (following the `*-ipc.test.ts` naming
  precedent P5c1–P5c3 established): `updater-ipc.test.ts` (replaces the
  "updater server routes" describe block from the deleted
  `migrated-ipc-routes.test.ts`, now exercising `electron/api/updater.ts`
  directly — hooks-not-registered/host-disconnected plus pass-through
  coverage for all three newly-IPC members), `recovery-ipc.test.ts` (new —
  host-disconnected, path-invalid, field-validation, and success-path
  coverage, plus a dedicated D7 test proving a real store-read failure
  propagates as a rejection rather than resolving to `[]`),
  `doctor-ipc.test.ts` (ports the deleted `doctor-route.test.ts` verbatim, including
  its L10 Chromium-filtering regression case), `lint-ipc.test.ts` (ports
  `lint:project`'s project-scoping-guard rows from the deleted
  `route-scoping.test.ts` — outside/sibling-prefix/no-project-open/
  repo-root/symlink-escape cases, `lint:project` having been the only route
  left in that file's table — plus new `lint:checkCss` validation/success
  coverage). `route-factory.test.ts`/`route-handler.test.ts` (unit tests of
  `_lib/route.ts`'s `defineRoute` and `_lib/handler.ts`'s `jsonRoute`, both
  now-deleted files with no IPC analog — `electron/api/*.ts` handlers call
  their hooks bag and validation helpers directly, no declarative
  route-factory layer), `route-scoping.test.ts` (its subject fully replaced
  by `lint-ipc.test.ts`), `doctor-route.test.ts`, and
  `migrated-ipc-routes.test.ts` are deleted. **Corrected 2026-09-01
  (round-2 repair):** the claim that every assertion those files carried
  "has a home in a still-green replacement file; none were dropped" was
  false and is struck. Two things actually happened to
  `migrated-ipc-routes.test.ts`'s assertions, and they are different, not
  interchangeable:
  - Its "preload.ts exposes the fs/dialog/shell/log/app IPC channels api.ts
    no longer carries" test (19 literal `secureHandle`-side channel names,
    from the SFE-P5c1 group only) had **no replacement** anywhere in the
    suite — dropped outright. Round-2 repair adds
    `tests/platform/preload-surface.test.ts`, which replaces it with a
    general assertion covering the full, current bridge surface: it
    extracts every `ipcRenderer.invoke("…")` channel literal from
    `electron/preload.ts` and every `secureHandle("…", …)` channel literal
    from `electron/main.ts`, and asserts each side is a mirror of the
    other (120 channels each way at HEAD, zero missing in either
    direction) — not just the 19 `migrated-ipc-routes.test.ts` happened to
    pin.
  - Its "preload.ts no longer registers the migrated (still-HTTP) IPC
    channels" test asserted `updater:getStatus`/`updater:check`/
    `updater:download`, `sync:setAutoSync`, and `remote:cloneRepository`
    were **absent** from preload/main (they were HTTP routes at the time
    that test was written). SFE-P5c3 (`sync:setAutoSync`/
    `remote:cloneRepository`) and this run, SFE-P5c4 (the three `updater:*`
    members), moved those same channels onto IPC — so the assertion's
    SUBJECT was inverted by this run's own migration, not silently
    dropped. The correct record is "reversed by design," not "still true
    somewhere else."
  `tests/updater/updater-capability.test.ts` is rewritten in place to match
  the collapsed transport (every member now delegates to a stubbed
  `window.electron`, none to a stubbed `fetch`; a new test pinned that the
  three request/reply members threw SYNCHRONOUSLY without a desktop host,
  matching `bridge()`'s documented "fail loudly, not partially" contract —
  the same pattern `bridge.test.ts`/`build-preview-capability.test.ts`
  already used for a direct, non-async `bridge()` caller). **Superseded
  2026-09-01 (round-2 repair):** see the correction below, after the
  verification table — round-1 repair made these three members `async`
  forwarders, so they now reject rather than throw synchronously, and the
  test was updated to match.
  `tests/editor/css-editor.test.ts` is rewritten to stub
  `window.electron.lint.checkCss` (calling the real lib `checkCss`) instead
  of intercepting `fetch("/api/lint/check-css")`.
- One residual test fix outside the four owned groups, caused by this run's
  own change: `tests/integration/editor-toggle-loads-module.pw.mjs`'s
  post-render responsiveness probe fetched `/api/status` as a liveness check
  for "the SPA, host route, toolbar, and preview bridge all still respond"
  — replaced with a fetch of `/` (the SPA's own index route), which proves
  the same thing (the local host server still answers) without depending on
  an `api/**` route surviving. Out of `bun run test`'s scope (a Playwright
  `.pw.mjs` script, not a `bun:test` file) but a real break this run
  introduced, so fixed rather than left for a future subrun to discover.

**Re-baseline:** `tools/architecture-baseline.json`'s `desktopHttpRoutes`
10 → 0 (matches `find packages/desktop/src/routes/api -name "+server.ts"`
returning nothing because the directory itself no longer exists) — the
ratchet this run's own DETAILS section named as its finish line.

**Net diffstat** (working tree at hand-off, `git diff --numstat` against
base `4616add1`, new untracked files included via a stage/unstage round
trip so the numbers cover the whole subrun):

```
production (packages/desktop/electron + packages/desktop/src): 44 files, +546 / −808  (net −262)
tests (packages/desktop/tests):                                19 files, +501 / −830  (net −329)
combined:                                                       64 files, +1,048 / −1,639  (net −591)
```

Same shape as every prior P5c subrun's own accounting, but net-NEGATIVE on
both sides this time (unlike P5c3's mildly-positive production delta) — the
group this run migrates is proportionally smaller (13 route/`_lib` files vs.
P5c3's 24, and P5c4 additionally deletes `api.ts` outright rather than
trimming two namespaces out of it), so the fixed cost of the new
`electron/api/*.ts` handlers, the three-way bridge type mirror, and the
`_lib/route.ts`/`_lib/handler.ts` handler-factory logic that has NO IPC
replacement (nothing needs a declarative route factory once every consumer
speaks IPC directly) do not offset the routes'/`api.ts`'s own deletion the
way they did for the larger remote/publish surface. This is also the FIRST
P5c subrun where every remaining consumer of the shared `_lib/*` helpers
migrated in the same subrun, so — per rule 7 — nothing was "moved to
electron/ with its last consumer"; the helpers simply had no consumer left
and died with the routes.

#### Search proofs (from repo root, against the working tree)

```
$ find packages/desktop/src/routes/api -name "+server.ts" | wc -l
0

$ ls packages/desktop/src/routes/api 2>&1
ls: cannot access 'packages/desktop/src/routes/api': No such file or directory

$ ls packages/desktop/src/lib/api.ts 2>&1
ls: cannot access 'packages/desktop/src/lib/api.ts': No such file or directory

$ grep -rn 'fetch("/api/\|fetch('"'"'/api/' packages/desktop/src
(no output — exit 1)
```

**Corrected 2026-09-01 (round-2 repair):** the proof above is scoped to
`packages/desktop/src` only, which is too narrow to be the deletion proof
for this run's own `tests/perf/rerender-latency-gate.mjs` fix (below) — a
`fetch("/api/…")` call site living under `packages/desktop/tests` would
not show up in it. Re-run across the whole package:

```
$ grep -rn 'fetch("/api/\|fetch('"'"'/api/' packages/desktop
packages/desktop/README.md:25:       • fetch("/api/…")   → src/routes/api/**/+server.ts host routes (the bulk)
packages/desktop/README.md:316:  `fetch("/api/…")` from it hit the adapter-node handler. In dev
packages/desktop/README.md:320:  `fetch("/api/…")` to `+server.ts` routes; the `window.electron` bridge
packages/desktop/vite.config.ts:7:// fetch("/api/...") against src/routes/api/**/+server.ts routes; a narrow
packages/desktop/electron/sveltekit-host.ts:9: * directly, while the renderer stays PWA-clean (fetch('/api/...') only).
```

Five hits, all prose in three tracked files — `README.md`'s architecture
overview, `vite.config.ts`'s dev-proxy comment, and
`electron/sveltekit-host.ts`'s doc comment — describing the still-live
local SvelteKit server itself (its removal is D10's post-route-zero step,
deferred to P5d), not a call site. (Untracked build output —
`packages/desktop/out/main/main.js`'s bundled copy of the
`sveltekit-host.ts` comment, and a `node_modules/.cache/jiti/` copy of
`vite.config.ts` — repeats the same two prose hits and is gitignored, not
part of the search-proof claim.) Zero real `fetch("/api/…")` call sites in
either scope. This is also the search that proves the fix to
`tests/perf/rerender-latency-gate.mjs` (see "Net diffstat" above and the
verification table below): that script's warm-rerender probe now drives a
fixture edit through `window.electron.fs.writeFile(...)` (the `fs:writeFile`
IPC channel), not a `fetch("/api/…")` call the deleted route surface would
no longer answer.

```
$ grep -rn 'from ["'"'"']\$lib/api["'"'"']' packages/desktop/src packages/desktop/tests
(no output — exit 1)   # zero real import statements

$ grep -rln '\$lib/api\b' packages/desktop/src packages/desktop/tests
packages/desktop/src/lib/platform/dtos.ts
packages/desktop/src/lib/errors.ts
packages/desktop/tests/platform/friendly-publish-error.test.ts
```

The three prose hits above are pre-existing history/documentation
sentences, not imports — `dtos.ts`'s "moved here from `$lib/api.ts`"
provenance notes (accurate: they describe where a type used to live, and
that move already happened in an earlier subrun) and `errors.ts`'s /
`friendly-publish-error.test.ts`'s shared comment about the (at the time,
still-live, P5c3-scoped) publish-error JSON-envelope unwrapping — unrelated
to this run's four groups and outside its write ownership, left as a named,
un-actioned residual rather than silently absorbed into this subrun's
claim of a clean sweep.

**Corrected 2026-09-01 (round-2 repair):** that residual did not survive
to be actioned by a later run — it was deleted in round-1 repair of THIS
run, once P5c4's own deletion of the last publish route (and `$lib/api.ts`
with it) removed the JSON-envelope producer the unwrap step existed for.
`friendlyPublishError` in `src/lib/errors.ts` no longer calls an unwrap
step at all; it classifies `raw.trim()` directly, and the function's doc
comment (`src/lib/errors.ts:244-251`) records the history: "Through
SFE-P5c3, this also unwrapped a `{"message": "…"}` JSON envelope
SvelteKit's `error(status, message)` produced … SFE-P5c4 deleted the last
publish route, `$lib/api.ts`, and the JSON-serializing route handler
together … so no producer of that envelope remains on any live path. The
unwrap step (`unwrapPublishErrorEnvelope`) was removed in the round-1
repair that caught it surviving past its own deletion phase (AP-32)." The
four envelope-specific tests in `friendly-publish-error.test.ts` were
replaced by a same-file history note recording the same thing. This
residual is CLOSED, not still-live.

```
$ grep -rn '\bapi\s*\.\s*\(doctor\|recovery\|lint\|updater\)' packages/desktop/src packages/desktop/tests
→ 3 hits, all doc/JSDoc comments naming what was migrated (doctor-capability.ts:2,
  lint-capability.ts:2, recovery-capability.ts:2) — zero real call sites
```

#### Verification run (this lane, from repo root / `packages/desktop`)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages (`gutterpress`, `@dimm-city/gutterpress-editor`, `@dimm-city/gutterpress-desktop`, `@dimm-city/gutterpress-vscode`) |
| `cd packages/desktop && bun run test` | 0 | 5888 pass, 1 skip, 0 fail, 15227 expect() calls across 162 files. **Corrected 2026-09-01 (round-2 repair):** re-run at HEAD after this round's fixes (adds `tests/platform/preload-surface.test.ts`) gives **5889 pass, 1 skip, 0 fail, 15236 expect() calls across 163 files** — the delta is exactly the two new tests / four new `expect()` calls that file adds; nothing else moved |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 688 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean (59 tokens, all consumed) |
| `cd packages/desktop && bun run build` | 0 | production build + `check-render-purity: OK` (143 files scanned in `build/client`, no forbidden host/node markers) |
| `bun run check:architecture` (repo root) | 0 | route ratchet 0 == baseline 0; ProseMirror ban, D4 import direction, future-package rules all PASS |
| `bun run knip` (repo root) | 0 | zero unused files/dependencies/unlisted/binaries flagged; one informational "Refine entry pattern" hint on repo-root `knip.jsonc`'s (not `packages/desktop/knip.jsonc` — there is no such file) now-stale `src/lib/api.ts` entry glob, fixed in this repair round: the entry was dropped and its comment bullet struck (see the finding this round addressed) |
| `cd packages/desktop && npm run electron:build` | 0 | main/preload bundles build and pass `node --check` (not in this run's required VERIFY list; run as an extra sanity check since `main.ts`/`preload.ts`/`types.d.ts` all changed) |

**Historical, dated 2026-09-01, SUPERSEDED by round-1 repair — do not follow
as current guidance.** One real defect was found and fixed before hand-off
of THIS run's original commit, by actually running the gate rather than by
inspection: the first `updater-ipc-capability` test pass used
`.rejects.toThrow` against `getUpdaterStatus()`/`checkForUpdate()`/
`downloadUpdate()`, which at that point threw SYNCHRONOUSLY (they were
plain, non-async forwarders to `bridge()`, which itself throws
synchronously by design) rather than returning a rejected promise —
`bun run test` caught the mismatch immediately; fixed to
`expect(() => fn()).toThrow(...)`, matching `bridge.test.ts`'s own
established pattern for a direct `bridge()` caller.

**Corrected 2026-09-01 (round-2 repair) — this is now the opposite of
current behavior.** Round-1 repair gave these same three members
(`getUpdaterStatus`/`checkForUpdate`/`downloadUpdate`) the same
`friendlyHostError` `call()` scrub every other capability module already
used (run rule 2), which turned them from plain synchronous forwarders
into `async function` wrappers. `bridge()`'s off-host throw is still
synchronous, but it now happens inside an `async` function body, so it
surfaces to the caller as a REJECTED PROMISE, not a synchronous throw.
`tests/updater/updater-capability.test.ts` was updated to match:
`await expect(getUpdaterStatus()).rejects.toThrow(/desktop host
required/)` (and the "hooks not registered" cases the same way) is the
CORRECT assertion form for these three members as of round-1 repair
onward. The paragraph above is preserved only as dated history of what
the code looked like before that repair; a future change must not revert
`.rejects.toThrow` back to `expect(() => fn()).toThrow(...)` for these
three members on the strength of the paragraph above — that would be
reverting the round-1 fix, not restoring a regression.

### SFE-P5d — 2026-09-01 — static desktop renderer and local server deletion (Checkpoint C)

Lane A (implementation), the single lane for this run — the plan's three
named lanes (A: static build, B: Electron server deletion, C: API
client/route-tree deletion) collapsed into one write-ownership grant because
Lane C's own deliverables (`src/routes/api/**`, `src/lib/api.ts`) were
already deleted whole by SFE-P5c4, ahead of this phase. Base SHA `d6092188`
(SFE-P5c's close-out commit, current HEAD at the start of this run). Head:
`3df0ea74` — this run's changes landed as that commit (round-1 repair,
below, was correctly a further diff on top rather than an amend, and is
left uncommitted in the working tree per repair-round instructions, for the
integrator to fold in on the next commit).

**What was deleted:**

- `electron/sveltekit-host.ts` (236 lines) outright: `startSvelteKitServer`
  (the `createServer(...).listen(0, "127.0.0.1")` loopback bind and
  `getSvelteKitHandlerPath`'s `app.asar/build/handler.js` resolution),
  `AUTH_HEADER`/`isAuthorizedRequest`/`withTokenAuth` (the bearer-token
  check), `buildProxyRequest` (the `fetch`-based proxy request builder),
  `buildHostErrorPage` (the server error page), and the old
  `registerAppProtocol` (the proxy-only `app://` handler that forwarded
  every request to the loopback server).
- `main.ts`'s `skAuthToken` constant (`randomBytes(32).toString("hex")`,
  minted once per process) and its two call sites
  (`startSvelteKitServer(slog, skAuthToken)`, `registerAppProtocol
  (skAuthToken)`), and the `node:crypto` `randomBytes` import that only
  existed for it.
- `@sveltejs/adapter-node` (`package.json` devDependency; `bun.lock`
  correspondingly drops its whole dependency subtree — `@rollup/plugin-*`,
  `rollup` — net −86 lines: `+2/−88`).
- Two test files that existed solely to pin the deleted mechanism:
  `tests/platform/sveltekit-host.test.ts` (88 lines — `buildHostErrorPage`
  unit tests) and `tests/platform/sveltekit-host-auth.test.ts` (210 lines —
  the bearer-token/host-validation regression suite, including the two
  named P1-review repro tests `#2a`/`#2b`).

**What was added:**

- `electron/app-protocol.ts` (198 lines, new) — the static-file `app://`
  handler. `registerAppProtocol(buildDir)` reads the requested file directly
  from `buildDir` (`fs/promises.readFile`) and returns its bytes with a
  correct `Content-Type` (`mimeTypeFor`, a small extension table); an
  extensionless path with no matching file falls back to `build/index.html`
  (`looksLikeAssetRequest` decides asset-vs-route) so the SvelteKit client
  router can handle a deep link. `resolveAssetPath` is the pure,
  independently-testable path-scoping function — see "Security equivalence"
  and "Traversal-refusal proof" below. `resolveBuildDir(isPackaged, hereDir)`
  and `staticBuildLooksValid(buildDir)` are pure helpers `main.ts` calls
  directly (mirroring `navigation-policy.ts`'s `resolveDevServerUrl`
  pattern), replacing `sveltekit-host.ts`'s internal
  `getSvelteKitHandlerPath`.
- `tests/platform/app-protocol.test.ts` (236 lines, new) — replaces the two
  deleted test files. 21 tests: pure-function coverage for
  `resolveAssetPath`/`looksLikeAssetRequest`/`mimeTypeFor`/`resolveBuildDir`/
  `staticBuildLooksValid`, plus full-pipeline tests against a real temp
  `buildDir` fixture and a captured `protocol.handle` callback (same
  convention the deleted `sveltekit-host-auth.test.ts` used).
- `svelte.config.js` switched to `@sveltejs/adapter-static` (`pages`/
  `assets`: `"build"`, `fallback: "index.html"`) — `src/routes/+layout.ts`
  already set `ssr = false` (unchanged; its comment was reworded to drop the
  stale `+server.ts`/adapter-node framing), which is what lets adapter-static
  build a pure client-only SPA with no dynamic-route error. `strict`
  defaults to `true` but adapter-static's own source
  (`node_modules/@sveltejs/adapter-static/index.js`) skips the
  all-routes-must-be-prerenderable check entirely whenever `fallback` is
  set, so no `prerender = true` was needed anywhere.
- `main.ts`'s `whenReady()` block now resolves `buildDir` via
  `resolveBuildDir(app.isPackaged, HERE)` and, gated behind the SAME
  `resolveDevServerUrl(...)` check that used to gate `startSvelteKitServer`
  (so a fresh checkout's `electron:hmr` dev session — no `build/` yet — does
  not see a false "couldn't start" dialog), calls `staticBuildLooksValid
  (buildDir)`; a missing/corrupt build directory shows the same
  `dialog.showErrorBox("Gutterpress couldn't start", …)` ARCH review #28
  UX, now for the new failure mode. `registerAppProtocol(buildDir)` is
  called unconditionally afterward, matching the old always-register
  behavior.

**Security equivalence statement (the plan's required Checkpoint C
deliverable):** the deleted bearer token existed to authenticate callers of
the loopback HTTP server — `sveltekit-host.ts`'s own header explained the
threat it closed (P1 review, PR #98, finding #2): a loopback bind
(127.0.0.1) is not caller authentication, so any other local process that
discovered the OS-assigned port could otherwise reach the same privileged
`+server.ts` routes the renderer used. **There is no longer a server to
protect** — `app-protocol.ts` never opens a socket; it only ever reads
files out of the packaged, read-only `buildDir` and returns their bytes.
The surviving boundary is **path-scoping**: `resolveAssetPath` refuses to
resolve any request outside `buildDir` via a segment-level `..`/drive-letter
pre-filter before any path is joined, plus a final lexical containment
check after — **complementary, not independent layers** (round-1 repair:
the original wording here overstated this). The pre-filter splits only on
`/`, so it misses an entire class — a traversal expressed with `\` instead
of `/` (directly, or `%5c`-encoded), which only `path.win32.resolve` treats
as a separator; the final containment check is the one layer that actually
catches it, proven by the `WIN32 CONTAINMENT` tests below (added in the same
repair, exercising `path.win32` via `resolveAssetPath`'s injectable third
parameter so the property is provable on a non-Windows CI runner). The old
`registerAppProtocol`'s "reject any host but `local`" check is NOT carried
forward as "the same validation moved" — a fresh, differently-reasoned host
check was written for the new handler (kept for origin-identity consistency
with `navigation-policy.ts`'s `APP_ORIGIN = "app://local"`, not because it
protects a proxy that no longer exists).

**Traversal-refusal proof (`tests/platform/app-protocol.test.ts`,
verbatim tests, all passing — 23 tests total, 21 originally plus the 2
`WIN32 CONTAINMENT` tests added in round-1 repair):**

```
TRAVERSAL REFUSAL: a literal '..' segment is rejected
TRAVERSAL REFUSAL: a slash-encoded '..' segment is rejected (bypasses URL-level dot-segment normalization, decoded by us)
TRAVERSAL REFUSAL: a Windows drive-letter segment is rejected (would otherwise replace buildDir under path.win32.resolve)
TRAVERSAL REFUSAL: an embedded NUL byte is rejected
TRAVERSAL REFUSAL through the full app:// pipeline: a slash-encoded '..' request never escapes buildDir
TRAVERSAL REFUSAL through the full app:// pipeline: a literal '../' request resolves within buildDir, never the real filesystem root
WIN32 CONTAINMENT: a backslash-traversal pathname with no unsafe '/'-segment still resolves outside buildDir and is rejected
WIN32 CONTAINMENT: a %5c-encoded backslash-traversal pathname still resolves outside buildDir and is rejected
```

The two `WIN32 CONTAINMENT` tests are the ones that isolate the final
containment check specifically: both payloads pass `hasUnsafeSegment`
unrejected (neither contains a literal `/`-delimited `..` or colon segment
— the traversal is entirely backslash-shaped), so only the containment
check stands between them and a path outside `buildDir`. Verified by
temporarily deleting that check and re-running the suite: both tests fail
(`toBeNull()` receives the escaped absolute path instead), while the other
21 tests stay green — confirming these two, and only these two, pin that
specific layer.

The slash-encoded case (`app://local/foo%2f..%2f..%2f..%2f..%2fetc%2fpasswd`)
is the meaningful one: `new URL(...)` leaves an encoded slash (`%2f`)
alone rather than treating it as a path separator, so the WHATWG URL
parser's OWN dot-segment collapsing never sees the `..` segments this
decodes to — proven empirically (`node -e 'new URL("app://local/foo%2f..%2f..%2fetc%2fpasswd").pathname'`
→ `/foo%2f..%2f..%2fetc%2fpasswd`, unchanged) before writing the test.
`resolveAssetPath`'s own `decodeURIComponent` + post-decode segment split is
what catches it. The literal-`..` case demonstrates the complementary
finding: the URL parser DOES collapse an unencoded `app://local/../../../../etc/passwd`
to pathname `/etc/passwd` on its own — but because `resolveAssetPath` always
treats the pathname as relative to `buildDir` (never as an OS-absolute
path), the resulting lookup is for `buildDir/etc/passwd`, not the real
`/etc/passwd` (present on the host running the test, never read) — the test
asserts the real request lands on the ordinary SPA-fallback path (200,
`index.html`) with a body that does not match `/root:.*:0:0:/`, proving no
real-filesystem content leaked.

**Search proofs (the plan's own required list, re-derived in this run):**

```
$ grep -rn "@sveltejs/adapter-node" packages/desktop --include="*.ts" --include="*.js" \
    --include="*.json" --include="*.svelte" --include="*.md" --include="*.yml" \
    | grep -vE "/\.svelte-kit/|/build/|/out/|/node_modules/"
→ 1 hit: README.md's "No more `@sveltejs/adapter-node`..." removal note (historical/negation, not a live import or dependency)

$ grep -rln "startSvelteKitServer\|sveltekit-host" packages/desktop --include="*.ts" --include="*.js" --include="*.svelte" --include="*.md" \
    | grep -vE "/\.svelte-kit/|/build/|/out/|/node_modules/"
→ 2 hits, both this run's own test files: main-boot-and-splash.test.ts (an
  assertion that PROVES the string "startSvelteKitServer() runs it" is
  ABSENT from main.ts) and app-protocol.test.ts (doc comments naming what
  it replaces: "Replaces tests/platform/sveltekit-host.test.ts and
  sveltekit-host-auth.test.ts")

$ grep -rn 'fetch("/api\|fetch(.\/api' packages/desktop/src packages/desktop/electron
→ 0 hits (already held since SFE-P5c4; re-verified)

$ test -d packages/desktop/src/routes/api
→ absent (already held since SFE-P5c4; re-verified — src/routes/ now
  contains only +layout.svelte, +layout.ts, +page.svelte)

$ find packages/desktop/src -iname api.ts
→ 0 hits (already held since SFE-P5c4; re-verified)

$ grep -rn "x-gutterpress-token\|skAuthToken\|buildProxyRequest\|withTokenAuth\|isAuthorizedRequest\|AUTH_HEADER" \
    packages/desktop/electron packages/desktop/src
→ 0 hits
```

**Unpackaged smoke (both scripts, run as-is against this run's own build —
`out/main/main.js` from `electron:build`, `build/` from `bun run build`;
the existing driver's xvfb fallback launches Electron headlessly in this
sandbox, exactly as it did in P3d-sweep — round-1 repair correction: this
was mislabeled "Packaged smoke" originally. Both scripts launch Electron
directly against `out/main/main.js`
(`tests/integration/editor-toggle-loads-module.pw.mjs`'s `target = exeArg ?
resolve(exeArg) : join(desktopDir, "out", "main", "main.js")`, invoked here
with no `exeArg`), so `app.isPackaged === false` and `main.ts` takes
`resolveBuildDir(false, HERE)` → the plain-filesystem `packages/desktop/build`
branch. The branch this run actually adds for real users —
`resolveBuildDir(true, …)` → `process.resourcesPath/app.asar/build`, read
through `readFile` against a real asar — is exercised by neither script; it
is covered only by the unit test in
`tests/platform/app-protocol.test.ts` that stubs `process.resourcesPath` and
asserts string equality on the resolved path, not by a running packaged app.
The repo's own `tests/integration/electron-driver.pw.mjs` accepts a packaged
executable via `exePath` and was not run here. This does NOT invalidate what
follows below — it is real evidence that the app still starts, opens a
project, and edits — it just proves less than "packaged smoke" claimed; see
AC-16 in `acceptance.md`, corrected in the same repair round to record the
packaged half as still pending):**

```
$ node tests/integration/editor-toggle-loads-module.pw.mjs
[editor-toggle] SPA ready
[editor-toggle] project opened — editor module NOT yet loaded (no file clicked)
[editor-toggle] Edit mode segment clicked
[editor-toggle] PASS — Save enabled, Ctrl+S wrote source, preview updated in 111ms, and the app remained responsive (pre-shell 58ms, shell 53ms)
Exit: 0

$ node tests/integration/editor-opens-with-content.pw.mjs
[editor-opens] SPA ready
[editor-opens] project opened
[editor-opens] CONTROL ok: Edit mode active, editor pane rendered
[editor-opens] ok   — DEFECT 1: opening a book in Edit mode must mount CodeMirror
[editor-opens] ok   — DEFECT 1: the editor must open showing the book's first chapter
[editor-opens] ok   — DEFECT 2: a single click on content from 02-beta.md must load that file into the editor
[editor-opens] ok   — DEFECT 3: clicking the TOC row "Gamma Chapter 2" in Edit mode must navigate the EDITOR
[editor-opens] ok   — DEFECT 3: the same TOC click must also move the VIEWER
[editor-opens] ok   — DEFECT 4: "Collapse Alpha Chapter" must work while that branch holds the active heading
[editor-opens] ok   — re-expanding "Alpha Chapter" after a manual collapse must still work
[editor-opens] PASS — all checks green
Exit: 0
```

What these prove, exactly, at the level the plan's "still starts, edits"
bar asks for: the app launches headless via CDP against the app://
origin the new static handler serves (proving `registerAppProtocol` +
adapter-static's `build/` output work end to end in a real Electron
process, not just a mocked test); a project opens (folder scan + preview
start over the CLI's own, unrelated preview server); the rich/source
editor mounts and loads chapter content on demand; TOC navigation drives
both the editor and the (still separately-served) preview iframe;
Ctrl+S writes source through IPC and the preview re-renders it. Neither
script drives a full PDF export or a git-remote publish, so "build" here
means the desktop's own production `vite build` step (exercised directly
by the `bun run build` verification row below, not by these two scripts)
and "publish" is not exercised by either smoke script — no lane rule
required a new publish-specific smoke, and `remote`/`publish` IPC (`electron/
api/remote.ts`/`publish.ts`) is unchanged by this run (P5c3 already moved
it off HTTP; this run touches only the protocol handler and the SvelteKit
adapter). **Preview verification:** `PreviewFrame.svelte`'s iframe loads
from `lib.startPreviewServer` (`electron/preview/controller.ts:185-188`),
a second, separate `node:http` server on its own ephemeral
`127.0.0.1:<port>` — grepped and confirmed to have zero dependency on
`app://`/`sveltekit-host`/`app-protocol`; both smoke scripts' preview
assertions (content rendering, TOC-driven scroll) passing is direct
evidence nothing about preview relied on the deleted app server. **Dev
workflow verification:** `bun run dev` (`vite dev --port 5555 --strictPort`)
was started standalone and served the SPA shell (`curl` → HTTP 200, correct
`<title>Gutterpress desktop</title>` markup) — confirming adapter-static
doesn't break the plain Vite dev server adapter-node never touched either;
`electron:hmr`'s `VITE_DEV_SERVER_URL` gate (`resolveDevServerUrl`) is
unchanged code, protected by the existing `main-boot-and-splash.test.ts`
ARCH #1 tests (all passing, see below), and by construction never reaches
`app-protocol.ts` at all (the window loads the dev server URL directly).

**Checkpoint C numbers:**

- **Deleted modules:** `electron/sveltekit-host.ts` (236 lines),
  `tests/platform/sveltekit-host.test.ts` (88 lines),
  `tests/platform/sveltekit-host-auth.test.ts` (210 lines) — 534 lines
  across 3 files, deleted outright.
- **Added modules:** `electron/app-protocol.ts` (198 lines),
  `tests/platform/app-protocol.test.ts` (236 lines) — 434 lines across 2
  new files.
- **Route count:** 104 → 0 — already recorded by SFE-P5c (baseline-table
  row above); unchanged by this run, re-verified absent.
- **IPC handler count:** 12 → 120 — already recorded by SFE-P5c
  (baseline-table row above); unchanged by this run (`grep -c
  'secureHandle(' packages/desktop/electron/main.ts` → 120, re-verified;
  note the exact grep must NOT anchor on a trailing `"` — 4 of the 120
  registrations wrap their arguments onto a new line and would be
  undercounted at 116 by a `secureHandle("` anchor).
- **Security equivalence:** stated above — server-authentication token
  replaced by path-scoping, since there is no longer a server to
  authenticate callers to.
- **Unpackaged smoke:** both required scripts PASS (verbatim output above)
  — against `out/main/main.js` run directly (`app.isPackaged === false`),
  not a packaged build; see the correction above and AC-16 in
  `acceptance.md`. The packaged (asar) code path this run adds is still
  proven only by a unit test stubbing `process.resourcesPath`, not by a
  running packaged app — AC-16's packaged half remains Pending.
- **Net production LOC, this run (P5d only):** production files (`electron/
  **`, `src/**`, `svelte.config.js`, `vite.config.ts`,
  `electron.vite.config.ts`, `package.json` — excludes `tests/**` and
  `README.md`): 11 files, +301/−322, **net −21**. Test files: 7 files,
  +264/−320, **net −56**. `README.md` (doc): +75/−56, net +19.
  `bun.lock` (generated, not counted as production): +2/−88.
- **Net production LOC, all of P5 (`5db8c581..HEAD`, git history — HEAD is
  now the committed `3df0ea74`, so this is a plain `git diff --numstat`, not
  a working-tree diff; re-derived in round-1 repair, see the correction
  below):** production paths (every changed file NOT under `docs/`, NOT a
  `.md` file, NOT matching `tests/`/`.test.`/`.pw.mjs`, NOT a lockfile):
  **228 files, +6,628/−8,329, net −1,701.** (Round-1 repair correction: the
  figure originally recorded here — +6,619/−8,322, net −1,703 — was measured
  before `ci.yml`'s renderer-purity argument fix existed in the diff; that
  9-line hunk, +9/−7, is exactly the delta between the two measurements.)
  Test paths: 73 files, +4,354/−3,805, net +549 (P5c's IPC migration added
  substantial new IPC-boundary test coverage — validation/traversal/
  error-path cases the deleted HTTP routes never had, per the P5c1/P5c2
  review logs — which is expected and by design, not a regression). Doc
  paths: 11 files, +2,658/−292, net +2,366 (the run-specification and ledger
  entries this whole phase produced).
  **Caveat on the range:** `5db8c581` is P5a's OWN first production commit
  (`refactor(p5): delete the dormant PWA host`), so `5db8c581..HEAD`
  excludes that commit's own diff — P5a's stand-alone numbers were already
  measured separately, against the true pre-P5 base `c33868f8`, in this
  ledger's own SFE-P5a section above (see its "Verification run" table).
  This aggregate is therefore "P5a's review-repair rounds onward" (P5b,
  P5c1–P5c4 and their repairs, P5d), not literally byte-for-byte "all of
  P5 including P5a's initial commit" — reported this way because the
  orchestrating instruction named `5db8c581` explicitly as the base SHA,
  and it matches the ledger's own established measurement boundary for
  P5a. Both figures (this run alone; the `5db8c581..HEAD`-plus-P5d
  aggregate) are given so the reader can reconstruct either total.

**`.github/workflows/ci.yml`'s renderer-purity argument — WAS updated in
this commit, not a residual (round-1 repair correction):** an earlier draft
of this section reported `ci.yml`'s "Check renderer purity" step as still
hardcoding `packages/desktop/build/client --strict` — a path that no longer
exists — and flagged it as a residual outside this lane's write-ownership
grant, left for the integrator. That was wrong: `git diff d6092188..HEAD --
.github/workflows/ci.yml` shows the step's argument WAS changed, in this
same commit, to `packages/desktop/build --strict` (plus a rewritten comment
explaining why the `client`/`server` split no longer exists), matching the
`package.json` `build` script exactly. Re-verified directly:
`node tools/check-render-purity.mjs` (no argument, so it exercises the
tool's own default rather than either caller's explicit one) →
`check-render-purity: OK — scanned 144 file(s) in
/home/user/gutterpress/packages/desktop/build, no forbidden host/node
markers`, exit 0. Two lower-priority items in the same file WERE genuine
residuals and are fixed in this repair round: `tools/check-render-purity.mjs`'s
own default-argument fallback (previously `packages/desktop/build/client`,
now `packages/desktop/build`, matching both callers) and its header's
scoping paragraph (rewritten for the adapter-static shape); and
`tools/check-render-purity.test.mjs`'s Case 5, previously an adapter-node-
shaped client/server-split fixture that no longer matches either invocation,
now a generic "host code nested in a subdirectory" fixture proving the walk
recurses into the whole tree adapter-static actually emits.

#### Verification run

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages |
| `cd packages/desktop && bun run test` | 0 | 5894 pass, 1 skip, 0 fail, 15238 expect() calls across 162 files (includes the new 21-test `app-protocol.test.ts`; the two deleted `sveltekit-host*.test.ts` files' assertions are gone with them). Round-1 repair added 2 more tests to this file (now 23) — see the repair appendix below for the re-run. |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 688 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean (59 tokens, all consumed) |
| `rm -rf packages/desktop/build packages/desktop/.svelte-kit && cd packages/desktop && bun run build` | 0 | production build via adapter-static; `Wrote site to "build"`; `check-render-purity: OK — scanned 144 file(s) in build, no forbidden host/node markers`; `build/index.html` present, `build/server/`/`build/handler.js` absent |
| `cd packages/desktop && bun run electron:build` | 0 | `electron-vite build` + `node --check out/main/main.js` + `node --check out/preload/preload.cjs` all clean |
| `node packages/desktop/tests/integration/editor-toggle-loads-module.pw.mjs` | 0 | PASS (verbatim output above) — against this run's own `out/main/main.js` + `build/` |
| `node packages/desktop/tests/integration/editor-opens-with-content.pw.mjs` | 0 | PASS, all 7 checks green (verbatim output above) |
| `bun run check:architecture` (repo root) | 0 | route ratchet 0 == baseline 0; ProseMirror ban, D4 import direction, future-package rules all PASS — unaffected by this run |
| `bun run check:generated-files` (repo root) | 0 | 1,252 tracked files scanned, no generated/output paths tracked |
| `bun run knip` (repo root) | 0 | zero unused files/dependencies/unlisted/binaries flagged |

Targeted re-verification of the exact files touched by this lane, run
individually before reporting: `cd packages/desktop && tsc -p
electron/tsconfig.json` (0, clean — same command `bun run typecheck`
invokes for this package); `bun test tests/platform/app-protocol.test.ts`
(0, 21 pass / 0 fail / 34 expect() calls — re-run after round-1 repair:
0, 23 pass / 0 fail / 36 expect() calls); `bun test
tests/platform/main-boot-and-splash.test.ts` (0, 9 pass / 0 fail / 27
expect() calls, after one round of self-correction — see "one repair"
below).

**One repair, before hand-off:** the first pass of
`main-boot-and-splash.test.ts`'s reworded "prod-mode window-load comment"
test failed on its own `bun test` run — the new, accurate comment this run
wrote (documenting the ABSENCE of `build/handler.js`) legitimately contains
the substring `"build/handler.js"`, which an earlier, too-broad `not.toContain`
assertion rejected. Fixed by narrowing that assertion to the actual claim
worth pinning (no positive `"startSvelteKitServer() runs it"` reference
survives), re-run confirmed 9/9 green — recorded here per this run's
"actually run the gate, not just describe it" discipline, matching the
convention every prior SFE-P5* section in this ledger already uses for its
own repair rounds.

**Round-1 repair (post-review, on top of `3df0ea74`):** five CONFIRMED
findings from the review pass, addressed together:

1. **CLAUDE.md and docs/ARCHITECTURE.md still described the deleted
   adapter-node server**, contradicting the very `ci.yml`/`package.json`
   change this run made. Rewrote CLAUDE.md's Monorepo-layout paragraph, all
   of §8's Transport/seams/Verification prose, and `docs/ARCHITECTURE.md`'s
   §4 entry, for adapter-static + `app-protocol.ts` + typed IPC only — zero
   remaining `@sveltejs/adapter-node`/`+server.ts`/`fetch("/api`/
   `build/client`/`getPlatform()` hits in either file outside negation
   sentences (re-grepped after editing).
2. **This section's own Checkpoint C was self-contradicting**: it reported
   `ci.yml`'s renderer-purity argument as unfixed ("will fail... until
   someone with `.github/workflows/**` access changes that one argument")
   when `git diff d6092188..HEAD -- .github/workflows/ci.yml` shows this
   commit already changed it. Corrected above (the former "residual"
   paragraph now states what actually happened); "Head: uncommitted"
   corrected to `3df0ea74`; the all-of-P5 LOC row re-derived at HEAD (228
   files, +6,628/−8,329, net −1,701 — exactly `+9/−7` more than the
   original figure, matching the `ci.yml` hunk that measurement predated).
3. **`packages/desktop/README.md` documented `getPlatform()`/
   `electron-adapter.ts`** — both deleted in SFE-P5b, a run before this
   one — as the live seam, in prose this run itself wrote or rewrote (the
   architecture diagram, the "What's NOT here anymore" bullet, the
   Auto-update section, the Architecture-notes IPC bullet). Replaced every
   instance with `src/lib/platform/bridge.ts` + the feature-owned
   capability modules (`$lib/update/updater-capability.ts`, etc.), and
   fixed the same stale phrasing this run had introduced into
   `vite.config.ts`'s header and `src/routes/+layout.ts`'s comment.
4. **`tools/check-render-purity.mjs`'s default `buildDir`, header, and
   failure hint still encoded the deleted client/server split** even
   though both real callers (`ci.yml`, `package.json`) now pass `build`
   explicitly — a guardrail whose own defaults assert the inverse of what
   CI does is exactly the kind of fossil that gets a correct CI change
   reverted. Default changed to `packages/desktop/build`; header rewritten
   for the adapter-static shape (no subtree to carve out); failure hint
   repointed at typed IPC + capability modules.
   `tools/check-render-purity.test.mjs`'s Case 5 (an adapter-node-shaped
   client/server fixture) replaced with a generic nested-subdirectory
   fixture proving the walk recurses — re-run: `node
   tools/check-render-purity.test.mjs` → all tests pass; `node
   tools/check-render-purity.mjs` (bare, exercising the new default) →
   `check-render-purity: OK — scanned 144 file(s) in
   .../packages/desktop/build`, matching CI's own scanned-file count.
5. **No test pinned `resolveAssetPath`'s lexical containment check** — the
   sole defense against a Windows backslash-traversal class the segment
   pre-filter (`hasUnsafeSegment`, split on `/` only) cannot see — and the
   "two independent defenses" language in both `app-protocol.ts`'s header
   and this section's own security-equivalence statement overstated the
   relationship. Added an injectable third `pathApi` parameter to
   `resolveAssetPath` (defaults to the host's own `path`, so production
   behavior is unchanged) and two `WIN32 CONTAINMENT` tests that pass
   `path.win32` explicitly; verified both fail if the containment check is
   deleted (temporarily removed it, re-ran, both failed with the escaped
   absolute path instead of `null`, restored, re-ran green — 23/23).
   Reworded both "independent defenses" claims to state the true
   relationship: a fast pre-filter plus the containment check as the
   authoritative, non-redundant catch-all. `docs/plans/source-first-editor/
   acceptance.md`'s AC-16 row updated in the same pass for finding 5's
   sibling issue: the "packaged smoke" claim below was re-labeled
   "unpackaged smoke" (both scripts run `out/main/main.js` directly,
   `app.isPackaged === false` — the asar-reading branch this run adds is
   proven only by a stubbed unit test) and AC-16's packaged half recorded
   as still Pending rather than claimed complete.

Verification re-run after this repair round (targeted, per repair-round
instructions — not a full `bun run test`):

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages |
| `cd packages/desktop && tsc -p electron/tsconfig.json` | 0 | clean |
| `bun test tests/platform/app-protocol.test.ts` (packages/desktop) | 0 | 23 pass, 0 fail, 36 expect() calls |
| `node tools/check-render-purity.test.mjs` (repo root) | 0 | all cases pass, including the reframed Case 5 |
| `node tools/check-render-purity.mjs` (repo root, no argument — exercises the fixed default) | 0 | `check-render-purity: OK — scanned 144 file(s) in .../packages/desktop/build` |

### SFE-P6a — 2026-09-01 — `+page.svelte` composition-root reduction (Lane A)

Objective (run `SFE-P6.md`): move the REMAINING owned workflow logic in
`+page.svelte` to its obvious feature owner, under the P3e ruling's
discipline — extract only where responsibility and owner are clear, no
event bus, no generic controllers, no one-class-per-file. Zero behavior
change; every extraction is a mechanical move with host coupling injected,
matching the file's own established `*-controller.svelte.ts` pattern (18
such modules already existed under `src/lib/routes/` and `src/lib/editor/`
before this run).

#### Ownership map (method step 1) — OWNS vs COMPOSES, by the plan's nine feature boundaries

The file already delegates most of its nine feature boundaries to
controller/capability modules instantiated at the top of the script
(`ExportController`, `PublishSectionController`, `PageNavController`,
`ZoomViewController`, `EditorPreviewSyncController`, `SyncController`,
`ProjectSessionController`, `ProjectLifecycleController`,
`CrashRecoveryController`, `StartupController`, `ContextMenuController`,
`PreviewEventController`, `UpdateController`, `EditorFileSession`,
`EditorBuffer`, `RichModeController`) plus ~20 capability modules under
`$lib/*/*-capability.ts`. Reading the file end to end (script: lines 1–3553
of the pre-run 4,739-line file; template+style: 3555–4739) found the
residue fell into three shapes:

1. **A self-contained state machine with a clear single owner, buried
   inline** — the rich-mode document-host lifecycle (construction, the
   epoch-guarded async projection publish, the `whenSettled()` seam
   `selectEditorFile` needs): `richDocHost`/`richProjection`/
   `richPluginCss`/`richDocHostEpoch`/`richDocHostPending` state plus
   `rebuildRichDocHost`/`disposeRichDocHost` (~290 lines including their
   own extensive review-history doc comments, SFE-P3ab Lane A / SFE-P3e
   review rounds 1–2). Owner: document/editor. No existing controller
   module fit (`rich-mode.svelte.ts`'s own header explicitly disclaims
   owning "an `EditorDocumentHost`, a projection, or any document
   content" — extending it would have violated that documented
   boundary), so this created the missing module.
2. **A bounded fetch-state slice with a clear owner, mixed into
   cross-feature coordination** — the Problems panel's lint findings
   (`problems`/`buildProblemEntries`/`problemsLoading`/`problemsError`,
   `refreshProblems`). Owner: diagnostics/problems. What did NOT move:
   `openProblem` (navigates the editor pane to a finding) and
   `showPreviewFiles` (opens the left panel) stay in the root — cross-
   feature coordination D4 keeps explicit; `displayedProblems`/
   `problemBadge` also stay, since they merge the controller's findings
   with `lifecycle.previewError` (preview's own state) — root-owned
   composition, not diagnostics logic.
3. **Cross-feature coordination that is root-owned by design, not
   residue** — global keyboard routing (`onGlobalKey`/`onPreviewNavKey`,
   dispatches into 6+ different controllers), the rich/source command
   router (`handleRichToolbarAction`/`handleImagePropertiesAtCaret`/
   `handleImageUnwrapAtCaret`/`handleLinkEditAtCaret`, which reads BOTH
   surfaces — `richDocHostCtrl` and `sourceEditorHostEl` via
   `findMountedSourceView` — plus shared dialog helpers `promptText`/
   `promptImageProperties`), and the markdown-file-launch handler
   (coordinates project-open + editor-file-selection + pane layout).
   These were identified and deliberately LEFT — see "What was left, and
   why" below.

#### Extractions (method step 2)

| Extraction | Owner feature | Target module (new) | What moved |
|---|---|---|---|
| Rich-mode document-host lifecycle | document/editor | `src/lib/editor/rich-doc-host-controller.svelte.ts` (`RichDocHostController`, 156 lines) | `host`/`projection`/`pluginCss` `$state`, the epoch-guarded `rebuild(path, content)`/`dispose()`, and `whenSettled()` (renamed from the page's own `richDocHostPending` await). `buildRichProjection` (the host-vs-local build DECISION, which reads `lifecycle.currentDir`/`isDesktop()` and reports D14 diagnostics via `toast`) and `onEditorChange` (the shared-session convergence sink) stay in the root and are injected as `deps.buildProjection`/`deps.onSnapshotChange` — this is the SAME host-coupling-injected pattern every other controller in the file already uses, not a new one. |
| Problems panel findings | diagnostics/problems | `src/lib/routes/problems-controller.svelte.ts` (`ProblemsController`, 105 lines) | `entries`/`buildEntries`/`loading`/`error` `$state` and the `currentDir`-guarded, staleness-safe `refresh()` (M5: a stale in-flight lint from a project the author navigated away from must not clobber the new project's state) plus `recordBuildEntries()`/`reset()`. |

Both new modules follow the file's own established pattern exactly:
constructor-injected `Deps` interface (no ambient lookup, no service
locator — D4), `$state` fields read directly by the template/root
`$derived`s, zero Svelte/Electron/`node:*` imports (PWA-clean, §8).

#### What was left, and why (method step 3 — stop where ownership is unclear)

- **Rich/source command routing** (`handleRichToolbarAction`,
  `handleImagePropertiesAtCaret`/`handleImageUnwrapAtCaret`/
  `handleLinkEditAtCaret`, `openRichImageProperties`,
  `insertImageIntoChapter`, `captureRichSelection`/
  `isRichSelectionCaptureFresh`, the block-move keyboard handler) reads
  BOTH editing surfaces (rich via the new controller, source via
  `findMountedSourceView(sourceEditorHostEl)` — another lane's file,
  `source-editor-access.ts`) plus root-owned dialog state (`promptText`/
  `promptImageProperties`) and `toast`. There is no single feature that
  owns "decide which of two surfaces is active and route to it" other
  than the composition root itself — D4's "cross-feature coordination
  stays explicit in the root — no event bus" names this shape directly.
  Moving it would also have crossed into `rich-commands.ts`/
  `toolbar-actions.ts` (SFE-P3ab/P3d-parity Lanes B/D's files, outside
  this lane's write ownership) to keep the split coherent.
- **Global keyboard shortcut routing** (`onGlobalKey`/`onPreviewNavKey`)
  dispatches into `pageNav`, `zoomView`, `contextMenu`, `exportController`,
  `richDocHostCtrl`, and page-local UI state depending on which shortcut
  fired — genuinely cross-feature, and already reads every controller
  through its own accessor rather than owning any feature's state.
- **Markdown-file-launch handling** (`handleMarkdownFileLaunch`) sequences
  a project open (`openProjectPath`), an editor file selection
  (`selectEditorFile`), and pane-layout decisions (`isNarrow`/`paneMode`/
  `openEditorPane`) in response to one OS event — no single one of
  project/document/preview owns that sequence; it is the composition
  root's own startup-adjacent orchestration, parallel to why `startup`
  (`StartupController`) itself stays root-driven.
- **`onSaveVersion`'s inline handler** (StatusBar's save-a-version button:
  `vcsSaveSnapshot` + toast + `activityViewRef?.refreshHistory()`, 8
  lines) was considered for a VCS/version-history controller; left as a
  named inline handler — at 8 lines with two dependencies already
  root-owned (`toast`, `activityViewRef`), a new module would be ceremony
  around a small function, not a responsibility with an obvious separate
  owner (P3e ruling: "prefer deleting cleverness to guarding it" cuts
  both ways — it also argues against a controller with one caller and no
  state).

#### Tests (method step 4)

- **Moved, not weakened**: `tests/editor/rich-doc-host-rebuild-race.test.ts`
  (a hand-modeled harness proving the epoch-guard algorithm, plus a
  source-text "structural pin" against `+page.svelte`'s own
  `rebuildRichDocHost`/`richDocHostEpoch`) is DELETED and replaced by
  `tests/editor/rich-doc-host-controller.test.ts`, which proves the SAME
  race scenarios (single build, two-in-flight both resolution orders,
  three-in-flight, `dispose()` mid-flight, `whenSettled()`) directly
  against the REAL `RichDocHostController` class instead of a model of
  it (bun:test can import a `.svelte.ts` module with the same `$state`
  shim `rich-mode.test.ts` already uses — it could not import the old
  4,739-line `.svelte` file), plus a new edit-forwarding suite the old
  file's model couldn't exercise (no real `DesktopDocumentHost` in a
  hand-rolled harness). SFE-P6 round-1 repair added one more case the
  first pass of the port had missed: "a superseded build's .finally does
  not clear `pending` while a NEWER build is still in flight — whenSettled()
  called after B resolves still waits for C", which pins `rebuild()`'s
  `.finally(() => { if (epoch === this.epoch) this.pending = null; })`
  guard specifically — mutating that line to an unconditional
  `this.pending = null;` makes the new test (and only that test) fail.
  Its own structural pin now checks that `+page.svelte` DELEGATES to the
  controller (imports it, instantiates it, calls
  `.rebuild()`/`.dispose()`/`.whenSettled()`) rather than having
  reintroduced the algorithm inline — the same protective intent,
  retargeted at the code's new location. One deliberate reduction: the
  old file's explicit "guardEnabled: false" sabotage variant (AP-21/G-12,
  proving the hand-rolled MODEL's assertions were not vacuous) has no
  counterpart here, because there is no model to distrust any more — the
  suite calls the real implementation directly, and G-12's concern
  (discriminating power) is satisfied by the tests' own tight final-state
  assertions rather than by a second guard-disabled run.
- **Unchanged, updated only where they pinned the moved text**:
  `tests/platform/history-seam-retirement.test.ts`'s
  `onSnapshotRestored` structural-pin assertion (`toContain("refreshProblems()")`
  → `toContain("problemsController.refresh()")`) and
  `tests/editor/file-tree-open-file-rename-delete.test.ts`'s comment
  referencing `richDocHostPending` (updated to name
  `RichDocHostController.whenSettled()`; its own assertion —
  `toContain("await editorFiles.select(path)")` — was already unaffected,
  since only the SECOND line of `selectEditorFile`'s body changed).
- **New, for logic that had no isolated test before** (buried in the
  root, only reachable indirectly): `tests/platform/problems-controller.test.ts`
  — starting state, every `refresh()` guard (off-desktop, no project, url
  mode), success/failure publication, the M5 stale-in-flight-lint
  non-clobber case (had no isolated test at all pre-extraction — only
  reachable by driving the whole page), `recordBuildEntries`, `reset`.

#### Line counts

| | Before (run start) | After | Delta |
|---|---:|---:|---:|
| `packages/desktop/src/routes/+page.svelte` | 4,739 | 4,543 | −196 |
| `packages/desktop/src/lib/editor/rich-doc-host-controller.svelte.ts` (new) | 0 | 156 | +156 |
| `packages/desktop/src/lib/routes/problems-controller.svelte.ts` (new) | 0 | 105 | +105 |
| `packages/desktop/tests/editor/rich-doc-host-rebuild-race.test.ts` (deleted) | 276 | 0 | −276 |
| `packages/desktop/tests/editor/rich-doc-host-controller.test.ts` (new) | 0 | 333 | +333 |
| `packages/desktop/tests/platform/problems-controller.test.ts` (new) | 0 | 169 | +169 |

`+page.svelte`'s net −196 lines is a real reduction, not merely
displacement: `git diff --stat -- packages/desktop/src/routes/+page.svelte`
shows 97 insertions / 293 deletions inside the file itself (the surviving
insertions are call-site delegation lines and shortened, pointer-style
comments — the full review-history doc comments that used to live inline
moved to the new controllers' own headers, not duplicated in both places).

#### Verification run (this lane, from repo root / `packages/desktop`)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages (desktop's `typecheck` script is `tsc -p electron/tsconfig.json` — Lane B's file, untouched by this lane) |
| `cd packages/desktop && bun run test` | 0 | 5,911 pass, 1 skip, 0 fail, 15,274+ expect() calls across 163 files (re-run after Lane B's concurrent `electron/main.ts` work settled — see note below) |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 693 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint + app-token check clean (59 tokens, all consumed) |
| `cd packages/desktop && bun run build` | 0 | production build via adapter-static; `check-render-purity: OK — scanned 144 file(s) in build, no forbidden host/node markers` |
| `bun test tests/editor/rich-doc-host-controller.test.ts tests/platform/problems-controller.test.ts tests/platform/history-seam-retirement.test.ts tests/editor/file-tree-open-file-rename-delete.test.ts tests/editor/rich-mode.test.ts tests/editor/rich-commands.test.ts tests/editor/desktop-document-host.test.ts` (packages/desktop, targeted) | 0 | 206 pass, 0 fail, 488 expect() calls |

**Note on transient failures during this lane's own verification runs:**
`packages/desktop/electron/main.ts` and its `tests/platform/*.test.ts`
structural pins are Lane B's concurrent SFE-P6b work (same run, disjoint
write ownership — this lane never wrote to `electron/**`). Two intermediate
`bun run test` runs during this lane's own work-in-progress observed 5–7
failures, all in `tests/platform/{unsynced-status,watch-folder-scoping,
preload-surface,github-storage-notice}.test.ts` (none of them files this
lane touched) — a live race against Lane B's own commits landing in the
same working tree mid-run, not a regression this lane introduced. The final
re-run above, after Lane B's work settled, is clean.

### SFE-P6b — 2026-09-01 — `electron/main.ts` composition-root reduction (Lane B)

Objective (run `SFE-P6.md`): `main.ts` keeps lifecycle, windows, OS
integration, security policy, and service composition; the ~120
`secureHandle` registration blocks move into explicit per-context
registration modules. Zero behavior change. Started from the clean
committed tree at `b7242a71` (a prior attempt at this lane was killed by a
container restart mid-flight and its partial work was discarded — nothing
of it survived into this run).

#### STAYS vs MOVES map (method step 1)

**STAYS in `main.ts`** — genuinely lifecycle/window/security/OS-integration,
or service composition (constructing an instance / hook object from live
main-process resources and handing it to a registrar or to
`registerHostServices`):

- App lifecycle: single-instance lock, `open-file`/`second-instance`,
  `before-quit` closing-log write, `app.whenReady()` boot sequence,
  `window-all-closed`, `activate`, the online-poller and `powerMonitor`
  resume handler, the renderer-backgrounding command-line switches.
- Window management: `createWindow()` in full (webPreferences/security
  settings, `will-navigate`/`setWindowOpenHandler` policy, the editable-field
  context menu, `did-fail-load`/`render-process-gone`/`console-message`
  surfacing, the close gate, `safeSend`), `mainWindow`/`appShellReady`
  module state.
- Security policy: `originPolicyConfig()`, `registerUrlPreviewHeaderWatch`/
  `cspFrameAncestorsBlocksEmbedding`/`extractHeader`, the `app://` protocol
  scheme registration and `registerAppProtocol(buildDir)` call, the
  static-build-validity dialog.
- OS integration: the folder watcher (`FolderWatcher` instance,
  `startFolderWatch`/`stopFolderWatch`), `appIconPath`, `slog` startup
  timing, the AppImage integration instance, prefs/settings stores.
- Service composition (stayed — these build the live objects a registrar or
  `registerHostServices` consumes, they are not registration plumbing
  themselves): `autoSnapshot`/`autoSync` construction and their
  `onCredentialChange`/`onSnapshotFailed` wiring, every `*HooksImpl` object
  (`writeHooksImpl`, `watchHooksImpl`, `appHooksImpl`, `desktopHooksImpl`,
  `mediaHooksImpl`, `recoveryHooksImpl`, `prefsHooksImpl`, `doctorHooksImpl`,
  `appImageHooksImpl`, `vcsHooksImpl`, `remoteHooksImpl`,
  `syncSettingsHooksImpl`, `updaterHooksImpl`), `fsGuardImpl`,
  `pickedFilesImpl`/`savePathsImpl`, the single `registerHostServices({...})`
  call, `previewOpen`/`exportController`/`githubDeviceFlow` construction,
  `initPdfExport`/`initUpdater` wiring, `sanitizeBookSubPath` (a validation
  helper `remoteHooksImpl.cloneRepository`'s closure needs).
- Two `secureHandle(...)` registrations that are intrinsic window/lifecycle
  machinery, not per-context API plumbing, and so stayed inline: `app:flushDone`
  (resolves the live `RendererFlushSession` the close gate owns) and
  `app:openMarkdownFileReady` (the file-launch consumer-ready handshake, tied
  to `markdownFileLaunchQueue`, itself app-lifecycle state).
- The `secureHandle` machinery's origin-policy composition: `const
  secureHandle = createSecureHandle(originPolicyConfig);` — main.ts still
  builds the one shared function every registrar receives; only the
  generic wrapper body moved (see registrar list below).

**MOVES out of `main.ts`** — every other `secureHandle(...)` registration
call, per the run spec's explicit guidance ("dependencies the handlers need
— `activeWorkspaceRoot`, `mainWindow`, hooks bags — flow as explicit
registrar arguments"). Every hook OBJECT construction that already existed
stayed put (above); only the channel-registration call itself moved, into a
`register*Handlers(secureHandle, ...)` function colocated with the
handler logic it registers.

#### Registrar list (method step 1 cont'd)

| Registrar | Location | Channels | Extra deps beyond `secureHandle` |
|---|---|---:|---|
| `createSecureHandle` (the shared machinery itself, not a registrar) | `electron/server-bridge/secure-handle.ts` (new) | — | `getOriginPolicyConfig` getter |
| `registerFsHandlers` | `electron/api/fs.ts` | 9 (`fs:readFile`…`fs:delete`) | none |
| `registerFsWatchHandlers` | `electron/api/fs-watch.ts` (new) | 2 (`fs:watchFolder`, `fs:unwatchFolder`) | `getActiveWorkspaceRoot`, `startFolderWatch`, `stopFolderWatch`, `getWatchedDir`, `armSyncInterval` |
| `registerDialogHandlers` | `electron/api/dialog.ts` | 5 | none |
| `registerShellHandlers` | `electron/api/shell.ts` | 2 | none |
| `registerLogHandlers` | `electron/api/log.ts` | 2 | none |
| `registerAppHandlers` | `electron/api/app.ts` | 21 | none |
| `registerProjectHandlers` | `electron/api/project.ts` | 1 | none |
| `registerManifestHandlers` | `electron/api/manifest.ts` | 2 | none |
| `registerTplHandlers` | `electron/api/tpl.ts` | 4 | none |
| `registerSnipHandlers` | `electron/api/snip.ts` | 4 | none |
| `registerMediaHandlers` | `electron/api/media.ts` | 4 | none |
| `registerPluginHandlers` | `electron/api/plugin.ts` | 6 | none |
| `registerThemeHandlers` | `electron/api/theme.ts` | 11 | none |
| `registerVcsHandlers` | `electron/api/vcs.ts` | 4 | none |
| `registerStyleHandlers` | `electron/api/style.ts` | 1 | none |
| `registerUpdaterHandlers` | `electron/api/updater.ts` | 4 (`getStatus`/`check`/`download`/`applyNow` — `applyNow` joins the other three here, was previously registered separately much later in `main.ts`) | none (`applyNow` imports `installNow` from `../updater` directly) |
| `registerRecoveryHandlers` | `electron/api/recovery.ts` | 3 | none |
| `registerDoctorHandlers` | `electron/api/doctor.ts` | 1 | none |
| `registerLintHandlers` | `electron/api/lint.ts` | 2 | none |
| `registerRemoteHandlers` | `electron/api/remote.ts` | 15 (13 `remote:*` + 2 `sync:*`) | none |
| `registerPublishHandlers` | `electron/api/publish.ts` | 7 | none |
| `registerGitHubDeviceFlowHandlers` | `electron/github-device-flow-registrar.ts` (new) | 3 (`remote:connectGitHubStart/Wait/Cancel`) | `githubDeviceFlow` instance, `showLinuxCredentialStorageNoticeOnce` |
| `registerPdfExportHandlers` | `electron/pdf-export.ts` | 1 (`api:cancelExport`) | none (operates on that module's own active-session state) |
| `registerExportHandlers` | `electron/export/controller.ts` | 1 (`api:build`) | `exportController` instance |
| `registerPreviewHandlers` | `electron/preview/controller.ts` | 2 (`api:preview`, `api:stopPreview`) | `previewOpen` instance |
| `registerEditorProjectionHandlers` | `electron/editor-projection.ts` | 1 (`api:editorProjection`) | `getActiveWorkspaceRoot` getter |

Total channels registered by these calls: 9+2+5+2+2+21+1+2+4+4+4+6+11+4+1+4+3+1+2+15+7+3+1+1+2+1 = 118, plus the 2 that stayed inline in `main.ts` (`app:flushDone`, `app:openMarkdownFileReady`) = 120 — matching the ledger's pre-run baseline count exactly (`grep -c 'secureHandle(' packages/desktop/electron/main.ts` was 120 before this run); this move changes WHERE each registration lives, not how many channels exist or what any of them do.

#### Boot-order preservation evidence (method step 2)

The app-lifecycle sequence in `main.ts` is untouched byte-for-byte apart
from the registrar-call substitutions documented above:
`protocol.registerSchemesAsPrivileged` → `registerHostServices(...)` (hook
objects built as before) → `previewOpen`/`exportController`/`githubDeviceFlow`
construction → `initUpdater(...)` → the renderer-backgrounding switches →
the single-instance-lock branch (`open-file`/`second-instance`/`before-quit`
listeners) → `app.whenReady().then(...)` (static-build check →
`registerAppProtocol` → `registerUrlPreviewHeaderWatch` → `createWindow()` →
background update check → lib pre-warm → `activate`/online-poller/
`powerMonitor` listeners) → `window-all-closed`. Every one of these blocks
is either completely unchanged or has only had its interior
`secureHandle(...)` calls replaced by a `register*Handlers(...)` call at
the exact same point in the sequence — no block was reordered relative to
another. Registration ORDER among the ~118 moved channels themselves is not
behavior (each is registered against a distinct string key with
`ipcMain.handle`; nothing reads or invokes a channel until the renderer is
loaded, which happens only after every registrar call above has already
run synchronously at module-evaluation time), so the registrar calls were
grouped by bounded context in the new file rather than preserving their
old scattered interleaving with hook-object construction — this is the one
place "boot order" and "file layout" diverge, and per the run's own
instruction ("the boot ORDER is the behavior; the file layout is not") the
file layout was the part free to change.

Two tests source-grepped the exact former text of the moved handlers and
were updated to grep their new location honestly, not weakened
(`tests/platform/watch-folder-scoping.test.ts` test (c),
`tests/platform/unsynced-status.test.ts`'s "fs:watchFolder arms the
periodic interval" test, `tests/platform/github-storage-notice.test.ts` —
now reading `electron/api/fs-watch.ts` /
`electron/github-device-flow-registrar.ts` instead of `main.ts` for the
handler bodies that moved there; `tests/platform/preload-surface.test.ts`
was generalized to scan every `.ts` file under `electron/` instead of
`main.ts` alone, so it keeps proving the same "every preload invoke has a
registration, every registration has a preload invoke" contract regardless
of which registrar module a channel lives in). `main-boot-and-splash.test.ts`
needed no changes — every string it pins (`staticBuildLooksValid`,
`dialog.showErrorBox`, `resolveDevServerUrl`, `originPolicyConfig`,
`mainWindow.loadURL`) lives in code that stayed in `main.ts` verbatim.

#### Line counts

| | Before (run start, `b7242a71`) | After | Delta |
|---|---:|---:|---:|
| `packages/desktop/electron/main.ts` | 2,188 | 1,957 | −231 |
| `packages/desktop/electron/server-bridge/secure-handle.ts` (new) | 0 | 57 | +57 |
| `packages/desktop/electron/api/fs-watch.ts` (new) | 0 | 78 | +78 |
| `packages/desktop/electron/github-device-flow-registrar.ts` (new) | 0 | 42 | +42 |
| `packages/desktop/electron/api/{fs,dialog,shell,log,app,project,manifest,tpl,snip,media,plugin,theme,vcs,style,updater,recovery,doctor,lint,remote,publish}.ts` (20 files, registrar functions appended) | — | — | +310 combined (312 insertions / 2 deletions — the 2 deletions are `remote.ts`'s header comment reword, see below; every other file is pure addition) |
| `packages/desktop/electron/{pdf-export,export/controller,preview/controller,editor-projection}.ts` (registrar functions + honesty comment updates) | — | — | +56 combined (68 insertions / 12 deletions — the deletions are comment rewording in `editor-projection.ts`, documented in that file's own header, not code removal) |

`git diff --numstat -- packages/desktop/electron/main.ts`: 129 insertions,
360 deletions (net −231, matching the line-count table). Across every file
this lane touched (`electron/**`, including the 3 new files — `git diff`
alone omits untracked new files' content, so their full line counts are
added in by hand — plus the four `tests/platform/*.test.ts` files updated
above): 765 insertions, 408 deletions — a net +357 across the whole lane,
NOT a reduction, because moving a registration call out of `main.ts` into
its own module costs a function signature, a JSDoc header, and (for the
seven bespoke registrars) an explicit deps interface — the same cost every
extraction in this codebase's established `*-controller`/`*-capability`
pattern pays (see Lane A's own `RichDocHostController`/`ProblemsController`
line counts above, which show the identical shape: the composition root
shrinks, the total system grows slightly). This run's mandate was
`main.ts`'s own size specifically ("slim the 2,188-line main.ts") —
achieved, −231 lines, −10.6% — not a whole-lane net reduction; the plan's
whole-phase non-positive-production-LOC requirement (D15 / success
criterion 22) applies across the combined P4–P6 simplification phases, not
to this one sub-run in isolation.

`secureHandle(...)` call-site count is unchanged at 120 (`grep -rn
'secureHandle(' packages/desktop/electron --include='*.ts' | grep -vE
'^\S+:[0-9]+:\s*(//|\*|/\*)'` — excluding both `//` and JSDoc `*`-prefixed
comment lines, since several registrar headers now describe their own
`secureHandle("channel", ...)` call in prose — finds 120 real registration
call sites across the whole `electron/` tree, matching the pre-run baseline
exactly: none were duplicated, none were dropped, and the shared
`secureHandle` wrapper's own declaration inside
`server-bridge/secure-handle.ts` does not itself match the call-site
pattern, same discipline the original baseline note used for `main.ts`
alone).

#### Verification run (this lane)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | clean across all 4 workspace packages (`gutterpress`, `@dimm-city/gutterpress-editor`, `@dimm-city/gutterpress-desktop`, `@dimm-city/gutterpress-vscode`) |
| `cd packages/desktop && bun run test` | 0 | 5,911 pass, 1 skip, 0 fail, 15,277 expect() calls across 163 files |
| `cd packages/desktop && bun run check` | 0 | `svelte-check`: 693 files, 0 errors, 0 warnings |
| `cd packages/desktop && bun run lint` | 0 | eslint (`src/**/*.svelte`, `src/**/*.svelte.ts`) + app-token check clean — this lane's changes are entirely under `electron/`, outside this script's glob; `electron/`'s own gate is `bun run typecheck` (`tsc -p electron/tsconfig.json`), run above |
| `cd packages/desktop && bun run build` | 0 | production build via adapter-static; `check-render-purity: OK — scanned 144 file(s) in build, no forbidden host/node markers` |
| `cd packages/desktop && bun run electron:build` | 0 | `electron-vite build` + `node --check out/main/main.js` + `node --check out/preload/preload.cjs` — both bundles parse cleanly |
| `node packages/desktop/tests/integration/editor-toggle-loads-module.pw.mjs` | 0 | packaged-Electron smoke: SPA boots, project opens, Edit mode toggles, `Ctrl+S` writes source through the real IPC bridge, preview updates (108ms) — proves the registrar restructuring didn't break the real boot path, not just its unit tests |
| `bun test tests/platform/preload-surface.test.ts tests/platform/watch-folder-scoping.test.ts tests/platform/unsynced-status.test.ts tests/platform/github-storage-notice.test.ts tests/platform/main-boot-and-splash.test.ts` (packages/desktop, targeted) | 0 | 26 pass, 0 fail |

A repair round during this lane's own work: the first draft of the
`SFE-P6b` import-block comment in `main.ts` literally spelled
`secureHandle("channel", (_e, args) => xApi.fn(args))` as a code example
inside a `//` comment — `preload-surface.test.ts`'s regex-based channel
scan (which reads raw file text, not parsed AST, so it cannot distinguish
a comment from real code) picked up `"channel"` as a phantom 121st
registration with no matching `preload.ts` invoke call, failing "every
secureHandle registration under electron/ has a preload.ts invoke call
site". Fixed by rewording the comment to describe the pattern in prose
instead of a quoted code sample; re-run above is clean. Recorded here per
G-12 (a gate that can fail is worth more than one that can't) — this is
exactly the kind of false positive a source-text regex gate is supposed to
catch, and it did.

### SFE-P6c — 2026-09-01 — public exports, export tests, ADRs, and boundary docs (Lane C)

Objective (run `SFE-P6.md`'s P6c section): the justified `gutterpress`
subpath exports, package export tests, `docs/ARCHITECTURE.md`, the six
plan-named ADRs, and documented boundary ownership. This lane is almost
entirely additive (docs + one test file) rather than a deletion run in its
own right; it is recorded here because the plan's P6c deliverables include
resolving the "Stale ADR references/comments" and "duplicate local-file
plugin loader" rows above.

#### `gutterpress/plugins` — found already done, not redone

The run specification's item 1 ("add the export, swap the desktop's
duplicate for the real loader, delete the duplicate") was already
completely discharged in **SFE-P3e** (commit `7a5e9f8e`,
`feat(p3): gutterpress/plugins subpath; the desktop host uses the one real
loader`), well before this P6c run started. Re-verified against the
current tree rather than trusting the commit message alone:

```
$ grep -n "gutterpress/plugins" packages/desktop/electron/editor-projection.ts
95:import { loadPluginsWithCss } from "gutterpress/plugins";
(plus doc-comment mentions in the file's own header, explaining the D11
loader-boundary decision)

$ grep -n "function loadLocalPlugin\|function loadPlugin\b" packages/desktop/electron/editor-projection.ts
(no output — no local duplicate loader function exists in this file)
```

`packages/cli/src/plugins.ts` re-exports `loadPlugins`/`loadPluginsWithCss`
(and the `LoadedPluginsWithCss` type) from
`./lib/markdown/plugins` — the SAME loader the CLI's own build/preview path
uses. `package.json`'s `exports` map already carries `"./plugins"` pointing
at `dist/plugins.js`/`dist/plugins.d.ts`, and `build:library`'s entrypoint
list already includes `src/plugins.ts` alongside `src/index.ts` and
`src/api/index.ts` (the NODE-side entrypoints, correctly not part of the
separate `render.ts` non-split graph). No code change was needed; this
lane's job here was verification, not implementation. `packages/vscode-
extension/src/project/projection.ts` is a second real consumer of this
same export (confirmed by this run — not present when SFE-P3e landed).

#### D11 subpath decisions (the run specification's item 2)

| Subpath | Decision | Evidence |
|---|---|---|
| `gutterpress/plugins` | **Already added (SFE-P3e)** | See above |
| `gutterpress/project` | **Declined** | Zero consumers repo-wide for the specifier `"gutterpress/project"`; every current caller (desktop `electron/api/*.ts` via `electron/api/lib-loader.ts`'s shared `loadLib()`, `packages/vscode-extension`) reaches project-config functions through the bare `gutterpress` import |
| `gutterpress/build` | **Declined** | Same — zero consumers; `runBuild` is imported from bare `gutterpress` in `packages/vscode-extension/src/project/register.ts` (injected into `commands/build.ts`'s own `BuildCommandDeps`, which only takes a type-only `BuildRunnerFn`) |
| `gutterpress/preview` | **Declined** | Same — zero consumers; `startPreviewServer` is imported from bare `gutterpress` in the same `packages/vscode-extension/src/project/register.ts` |
| `gutterpress/publish` | **Declined** | Same — zero consumers anywhere |
| `gutterpress/vcs` | **Declined** | Same — zero consumers anywhere |

Search proof (repo-wide, excluding `node_modules`):

```
$ for sp in project build preview publish vcs; do
    grep -rn "\"gutterpress/$sp\"\|'gutterpress/$sp'" . 2>/dev/null | grep -v node_modules
  done
(no output for any of the five — exit 1 on every grep)
```

The desktop's own design (`electron/api/lib-loader.ts`, SFE-P5c2) is a
**deliberate** single shared `loadLib()` cache for the WHOLE library,
documented in that file's own header as porting `_lib/route.ts`'s
cache-once-per-process shape "so every `electron/api/*.ts` handler... [gets]
ONE shared cache instead of many private copies" — not an oversight this
run should correct by fragmenting it into five narrower imports. Per D11's
own rule ("add narrower subpath exports only where current consumers
justify them") and the run specification's explicit instruction ("add a
subpath ONLY where a real consumer would import it TODAY; decline the rest
with one line each in the report"), none of the five is added.

#### Export tests (the run specification's item 3)

New: `packages/cli/tests/integration/package-exports.test.ts`.
Reads `package.json#exports` directly (no hardcoded subpath list, so a
future ADDITION is covered automatically) and proves, per declared subpath:

1. **Resolves under Node** — spawns `node --input-type=module -e
   "import('<specifier>')"` with `cwd` set to `packages/cli` itself, relying
   on Node's package self-reference resolution (a package may import its
   own name if the nearest ancestor `package.json`'s `name` matches) rather
   than a fixture symlink — this is the same resolution mechanism a real
   external consumer uses through its own `node_modules` symlink (verified
   manually against `packages/desktop/node_modules/gutterpress ->
   ../../cli`, which already exists from the workspace install, before
   settling on the self-reference approach as the more portable, dependency-
   free option for THIS test).
2. **Resolves under Bun** — same shape, `bun -e "await import(...)"`.
3. **`gutterpress/render` stays node-free** — invokes
   `scripts/check-render-pure.mjs` directly as a subprocess and asserts a
   clean exit, rather than re-implementing that gate's Node-builtin/
   `createRequire`/relative-chunk checks a second time (the run
   specification: "reference, don't duplicate").
4. **Package-content**: spawns `npm pack --dry-run --json` and asserts every
   subpath's declared `types` and `default` file (from the exports map) is
   present in the packed file list — a subpath resolving locally in this
   checkout does not by itself prove `package.json#files` actually ships it.

Liveness assertions (G-12/AP-21) guard every describe block: a
zero-subpath exports map, a missing `dist/index.js`, or a zero-file
`npm pack` result each throw a specific, actionable error rather than
letting the rest of the suite pass vacuously.

**Round-1 repair (this run) — the derived loops above are blind to
REMOVAL**: every one of the four items above derives its target set FROM
`package.json#exports` (`SUBPATHS = Object.keys(PKG.exports)`), so deleting
a subpath — `./plugins`, the very one this run added because
`electron/editor-projection.ts` and `vscode-extension/src/project/
projection.ts` are real consumers — or dropping a `types`/`default`
condition under one, just shrinks the derived set: the suite stays green
with one fewer generated test, contradicting the file's own header and this
section's original "addition or removal is covered automatically" claim.
Added a fifth, explicitly pinned assertion (`test("the public subpath
surface is exactly the D11-approved set", ...)`) that checks `SUBPATHS`
against the literal set `[".", "./api", "./render", "./plugins"]` and each
subpath's condition keys against `["default", "types"]`, independent of
whatever `package.json#exports` currently says — this is the one assertion
in the file that a removal actually fails.

**Sabotage-verified this gate can fail** (G-12), not merely asserted to:
`mv dist/plugins.js dist/plugins.js.bak` before the built dist was restored
turned 3 of the derived tests red (`node can import "gutterpress/plugins"`,
`bun can import "gutterpress/plugins"`, `"./plugins" (default) —
./dist/plugins.js is packed`) with an actionable failure message naming the
missing file; restoring the file returned the suite to fully green. Full log
kept in this lane's own working notes, not committed (the sabotage was never
itself part of the committed test file). The round-1 repair separately
verified the NEW pinned-surface assertion specifically: deleting
`exports["./plugins"]` from a scratch copy of `package.json` failed only
that one assertion (`SUBPATHS` no longer contained `./plugins`), which the
four pre-existing derived items could not have caught on their own.

Final run: `cd packages/cli && bun test tests/integration/package-exports.test.ts`
→ **18 pass, 0 fail** (17 from the four original items + the round-1
pinned-surface assertion).

#### ADRs (the run specification's item 4)

Six new records, `docs/adr/0011`–`0016` (continuing the existing
0008/0009/0010 numbering), each following the established ADR
0008/0009/0010 format (Date, Status, Context, Decision, Consequences,
Alternatives rejected) and each citing the run(s) that implemented the
decision it records, per the run specification's "STATUS Accepted, citing
the run(s) that implemented it":

| ADR | Title | Implemented by |
|---|---|---|
| 0011 | Source-first editor and sparse projection | SFE-P1a, P1c, P2a, P2b, P2c |
| 0012 | Preview is read-only | SFE-P4 |
| 0013 | Shared desktop/VS Code editor package (+ the fork decision) | SFE-P1a, P1b, P1b2, P3a, P3c |
| 0014 | Future web product is a separate package | SFE-P5a |
| 0015 | Electron single-IPC transport | SFE-P5c (P5c1–P5c4), P5d |
| 0016 | Narrow feature-owned capabilities | SFE-P5b (+ SFE-P6b's parallel Electron-main-side split) |

Line counts: 103 / 99 / 122 / 90 / 100 / 125 respectively (6 files,
639 lines total) — each intentionally kept to roughly a page per the run
specification's "tight (a page, not an essay)" instruction, given the
underlying material (`pr158-lessons.md`, `capability-map.md`, the
SFE-P1b/P1b2 decision record, and the SFE-P4/P5a/P5c/P5d ledger sections
above) each ADR draws from and cites rather than restates.

**Stale ADR reference resolved**: ADR 0009's own "Note on predecessors"
(which already documented that `CLAUDE.md`/`docs/ux-design-contract.md`
cite ADRs 0002/0004/0005/0006/0007, none present in this repository) is
updated to record that ADR 0014 and ADR 0016 now carry the current record
for the platform/host-portability topic the missing "ADR 0004" used to
cover, and to correct its own file-count claim ("`docs/adr/` holds 0008,
0009 and 0010" → "0008 through 0016").

**Stale ADR references NOT resolved, and why**: the P6c-original pass of
this section proved its decline only against `packages/desktop/src/**` and
presented that as the whole picture. Round-1 repair re-ran the search
repo-wide, across all five historically-missing ADR numbers
(0002/0004/0005/0006/0007), not just 0004/0006:

```
$ grep -rln "ADR 0002\|ADR 0004\|ADR 0005\|ADR 0006\|ADR 0007" packages \
    --include=*.ts --include=*.svelte --include=*.js --include=*.md | grep -v node_modules | wc -l
106
$ grep -rn  "ADR 0002\|ADR 0004\|ADR 0005\|ADR 0006\|ADR 0007" packages \
    --include=*.ts --include=*.svelte --include=*.js --include=*.md | grep -v node_modules | wc -l
193
```

193 occurrences repo-wide, not 63: `packages/cli` carries 103, and
`packages/desktop` carries the remaining 90 — of which 67 are under
`packages/desktop/src/**` (the original 41-file / 63-occurrence count below
used a narrower `ADR 0004\|ADR 0006`-only, `.ts`/`.svelte`-only search, which
is why the two numbers differ) and **9 are under `packages/desktop/electron/**`
— NOT frozen for this run** (`export/controller.ts:239`, `api/remote.ts:65,164,278`,
`api/vcs.ts:121`, `credential-store.ts:2`, `main.ts:1299,1353`), a scope this
section previously omitted entirely.

**`packages/desktop/src/**` (67 occurrences, 41 files / 63 for the narrower
ADR-0004/0006-only count — `SnippetPicker.svelte`, `StatusBar.svelte`,
`chapter-path.ts`, `source-range.ts`, `image-classes.ts`, and dozens more)
is frozen** (out of this lane's write ownership — "MUST NOT WRITE" per the
run's lane assignment, "frozen post-P6a"), so this decline's freeze
rationale applies ONLY to that subtree. This is not a new defect this run
introduces or fails to catch: SFE-P5a's own Lane C found and recorded the
identical situation for ADR 0004 specifically ("restoring or authoring an
ADR is outside this lane's write ownership" — deletion ledger's SFE-P5a
"ADR statusing" section) and left it unresolved for the same boundary
reason.

**`packages/desktop/electron/**` (9 occurrences, 6 files) is NOT frozen —
P6b rewrote this tree — so the freeze rationale above does not cover it.**
Disposed separately: one of the six files, `github-device-flow-registrar.ts`,
was CREATED by this run (P6b) and its "ADR 0006" citation is a new dangling
reference this run introduced, not an inherited one — fixed directly (its
header now names the feature by issue number only, with a note pointing at
ADR 0009's "Note on predecessors" and this entry, matching the ADR
0014/0016 footnote pattern rather than repeating a citation to a record
that was never authored). The other five files' citations (`main.ts`,
`credential-store.ts`, `api/remote.ts`, `api/vcs.ts`,
`export/controller.ts`) predate this run and are declined for the same
reason as the frozen subtree below them: "ADR 0006" (a GitHub device-flow /
Advanced Setup / remote-sync record) is a topic none of this run's six new
ADRs cover, so there is no new ADR to redirect those citations to —
restoring or authoring ADR 0006 itself is out of this run's scope (the plan
names six specific ADRs, not an open-ended backfill of every
historically-deleted record). Being outside a WRITE FREEZE does not by
itself obligate rewriting 5 more pre-existing citations to a record this
run has no mandate to author.

**`packages/cli` (103 occurrences) is declined for the same reason,
repo-wide**: the large majority (93 of 103, sampled) are "ADR 0002" (PDF
validation) and "ADR 0006"/"ADR 0006 D2-D7" (git/remote-auth/sync
architecture: `src/lib/remote-auth/**`, `src/lib/publish/types.ts`,
`src/api/index.ts`, and others) citations that predate this run by a wide
margin — none of this run's six new ADRs cover the PDF-validation or
git/remote-auth/sync topics either, so the same "no ADR to redirect to,
authoring one is out of scope" reasoning applies without modification.
`packages/cli` is not write-frozen for this run the way `desktop/src` is,
but "not frozen" is not the same claim as "in scope" — none of this run's
six ADRs, `docs/ARCHITECTURE.md` pass, or CODEOWNERS item names
`packages/cli`'s git/remote-auth/PDF-validation comments as something this
run corrects.

Recorded here in full — not silently left unmentioned, and not understated
by scoping the search narrower than the claim — per this ledger's own
standard of honesty about what was and was not fixed.

#### `docs/ARCHITECTURE.md` (the run specification's item 5)

Rewritten in the areas that had drifted furthest from the post-P6 tree,
not wholesale: `git diff --numstat` shows 150 insertions / 9 deletions
across the file's existing structure (959 lines total after this edit).
Changes:

- **"Monorepo structure" → "Monorepo packages"**: was "two packages"
  (cli, desktop); now lists all six workspace packages
  (`packages/*`) with a one-line description and doc/ADR pointers each,
  including the two Experimental packages (`packages/editor`,
  `packages/vscode-extension`) and the internal fork
  (`packages/vscode-markdown-editor`) that did not exist when this section
  was last written.
- **New "Desktop Application Architecture" section**: the static-renderer/
  typed-IPC transport (ADR 0015), the narrow capability-module seam (ADR
  0016), and both composition roots (`electron/main.ts`'s registrar list,
  `+page.svelte`'s ~16 feature controllers) as they exist after SFE-P6a/
  P6b — this section did not exist before this run; the desktop app had no
  architecture-document coverage of its post-P5/P6 shape at all.
- **New "Public Package Exports" section**: the exports-map table and the
  five-subpath decline rationale from above, plus a pointer to the new
  export test.
- **"Extension System" retitled** to "Extension System (markdown-it
  plugins)" with a one-line disambiguation note, since "extension" now
  also names the real VS Code extension package (`docs/vscode-extension.md`)
  and the pre-existing heading was genuinely ambiguous once that package
  existed.
- Footer "Last Updated"/"Version" corrected to the real, checked package
  versions (`packages/cli`/`packages/desktop` still 0.10.2 pending the
  0.11.0 release; `packages/editor` 0.11.0-experimental.0) rather than
  restating the stale 0.10.2-alpha.3 line, which predates every package
  this run added to the monorepo-packages list.

#### OWNERSHIP (the run specification's item 6)

Confirmed no `CODEOWNERS` file and no GitHub teams exist against this
repository before writing anything:

```
$ find . -iname "CODEOWNERS" -not -path "*/node_modules/*"
(no output)
$ ls .github/
actions  workflows
```

New: `docs/OWNERSHIP.md` (108 lines), naming the four boundaries the run
specification names (editor package, extension, renderer, Electron), each
with its owned paths and a review-expectation paragraph grounded in a real
risk for that boundary (cross-consumer reasoning for the editor package;
workspace-trust regressions for the extension; the render-purity boundary
for the renderer; CSP/navigation-policy/IPC-registration for Electron) —
no fabricated GitHub team handles, per the run specification's explicit
instruction.

#### `docs/vscode-extension.md` (the run specification's item 7)

New (140 lines): a real, checked doc, not a stub — Experimental status and
what that concretely means (optional custom editor, not the Markdown
default; no stability promise), what the extension does (custom editor,
three commands, project detection), the host/webview ownership split (D9),
the workspace-trust model (verified against the actual three call sites in
`src/provider.ts`/`src/project/projection.ts`/`src/protocol/messages.ts`,
not assumed from the plan text alone), the fork dependency and its named
removal trigger (an upstream `renderCustomBlock`-equivalent hook shipping
natively), and real build/test commands read from `package.json`'s own
`scripts` block rather than invented.

#### Verification run (this lane)

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (repo root) | 0 | Clean across all 4 workspace packages (`gutterpress`, `@dimm-city/gutterpress-editor`, `@dimm-city/gutterpress-desktop`, `@dimm-city/gutterpress-vscode`) |
| `cd packages/cli && bun run build` | 0 | `dist/plugins.js`/`dist/plugins.d.ts` present alongside `dist/index.js`, `dist/api/index.js`, `dist/render.js`; `check-render-pure.mjs` passes as part of the build |
| `cd packages/cli && bun run test` | 0 | 1930 pass, 60 skip (no Chromium in this environment — pre-existing, unrelated to this lane), 0 fail, 45,683 expect() calls across 156 files, including the new `tests/integration/package-exports.test.ts` (17/17 as this lane shipped it; the review's round-1 repair added a pinned-surface case — 18/18 thereafter) |
| `cd packages/cli && bun run typecheck` | 0 | `tsc --noEmit`, targeted re-run for this lane's own package |
| `cd packages/cli && bun test tests/integration/package-exports.test.ts` | 0 | 17 pass, 0 fail, 9 expect() calls — targeted re-run of the one file this lane added, as of this lane's HEAD. (Historical: the review's round-1 repair later added the pinned-surface case, making the file 18 pass / 14 expect() calls — the counts in the P6 review log are the current ones.) |
| `cd packages/desktop && bun run test` | 0 | 5,911 pass, 1 skip, 0 fail, 15,277 expect() calls across 163 files — identical counts to SFE-P6b's own verification, confirming this lane's doc-only desktop-adjacent changes (none touch `packages/desktop/src` or `electron/main.ts`, both frozen) introduced no regression |
| `cd packages/editor && bun run test` | 0 | 3,038 pass, 0 fail, 11,816 expect() calls across 26 files |
| `bun run check:architecture` (repo root) | 0 | All 4 rules PASS (prosemirror-ban, desktop-route-ratchet at baseline 0, D4 import direction, future-package rules for `packages/editor`/`packages/vscode-extension`) |
| `bun run check:generated-files` (repo root) | 0 | 1,258 tracked files scanned, no generated/output paths tracked |
| `bun run knip` (repo root) | 0 | `--include files,dependencies,unlisted,binaries` — no violations reported |

**Not run by this lane** (outside the run specification's VERIFY list for
this lane; the full SFE-P6 gate — `check:vendored`, `packages/editor`'s
`test:browser`, `packages/vscode-extension`'s `test`, and
`packages/desktop`'s `check`/`lint`/`build`/`electron:build` — is the
integrator's/gate agent's responsibility once every P6 lane has landed):
none of this lane's changes touch any file those commands would exercise
differently than the commands above already do (this lane wrote docs, one
new ADR set, and one new CLI-package test file; it did not touch
`packages/vscode-markdown-editor`, `packages/editor/src`,
`packages/vscode-extension/src`, or any `packages/desktop` production
file).

#### Line counts (this lane, new + modified files)

| File | Lines | Kind |
|---|---:|---|
| `packages/cli/tests/integration/package-exports.test.ts` | 163 | new |
| `docs/adr/0011-source-first-editor-sparse-projection.md` | 103 | new |
| `docs/adr/0012-preview-read-only.md` | 99 | new |
| `docs/adr/0013-shared-editor-package-and-fork.md` | 122 | new |
| `docs/adr/0014-future-web-product-is-a-separate-package.md` | 90 | new |
| `docs/adr/0015-electron-single-ipc-transport.md` | 100 | new |
| `docs/adr/0016-narrow-feature-owned-capabilities.md` | 125 | new |
| `docs/OWNERSHIP.md` | 108 | new |
| `docs/vscode-extension.md` | 140 | new |
| `docs/ARCHITECTURE.md` | +156 / −11 | modified |
| `docs/adr/0009-inline-editing-source-ranges.md` | +4 / −1 | modified |
| `docs/plans/source-first-editor/deletion-ledger.md` | this section + the two "Planned deletions" row edits | modified |

This lane adds documentation and one test file; it does not delete
production code (the one deletion this run's report might otherwise
imply — the desktop's duplicate plugin loader — was already deleted by
SFE-P3e, not by this run). No production LOC change in `packages/cli/src`
or `packages/desktop` is claimed or made by this lane.

---

## Checkpoint D — 2026-09-02 — SFE-P6: composition and package consolidation

Assembled by the integrator after the SFE-P6 review's round-2 approve
(`de4445d2`). Every number below is derived from git at the named SHAs, not
carried from lane reports.

**Completed run and commit SHAs.** SFE-P6 is three commits on
`claude/sonnet-opus-agent-workflow-4s81ps`, base `b7242a71`:
`fa8ea498` (P6a+P6b — both composition roots slimmed, zero behavior
change), `52d099b3` (P6c — export tests, six ADRs, architecture and
ownership records), `de4445d2` (review round-1 repairs, all seven confirmed
findings). Run diffstat `b7242a71..de4445d2`: 56 files, +3,887 / −1,008.

**Composition-root reductions** (`git show <sha>:<file> | wc -l`):

| Root | `b7242a71` | `de4445d2` | Δ |
|---|---:|---:|---:|
| `packages/desktop/src/routes/+page.svelte` | 4,739 | 4,543 | −196 |
| `packages/desktop/electron/main.ts` | 2,188 | 1,965 | −223 |

(The interim post-P6b figure was 1,957; the round-1 repair added the
`applyNow` hook wiring — `installNow` import + `updaterHooksImpl` line —
which is the correct cost of removing `electron/api/updater.ts`'s hard
Electron import.) Extractions landed in their feature owners:
`src/lib/editor/rich-doc-host-controller.svelte.ts` (156 lines, with a
378-line race-scenario test whose epoch-guard case is mutation-proven) and
`src/lib/routes/problems-controller.svelte.ts` (105 lines, 169-line test)
on the renderer side; on the host side the registration blocks joined the
`electron/api/*` handler modules they belonged to.

**Module graph / IPC surface.** 24 modules under
`packages/desktop/electron/api/`; 26 exported `register*Handlers`
functions under `electron/` in total, every one asserted called from
`main.ts` by `tests/platform/preload-surface.test.ts` (mutation-proven:
commenting out one registration fails exactly that test), with two
registrations deliberately left inline in `main.ts` (recorded as an
advisory against ADR 0015/0016's "all moved" phrasing). The review's
central identity check: the full 120-channel `secureHandle` surface is
**byte-identical** between `b7242a71` and post-P6 HEAD (independent
full-tree channel extraction at both SHAs, diff clean).

**Public exports.** `packages/cli/package.json#exports` is the pinned set
`{'.', './api', './render', './plugins'}` × `['default', 'types']`,
asserted literally by `tests/integration/package-exports.test.ts`
(18 pass; sabotage-proven — removing `./plugins` fails exactly one
assertion). `gutterpress/plugins` gained its real consumer: the desktop's
`electron/api/editor-projection.ts` uses the real loader (duplicate deleted
in SFE-P3e). Other D11 subpaths declined with per-subpath justification in
the P6c lane section above. `gutterpress/render` stays node-free
(`scripts/check-render-pure.mjs` in the cli build).

**Architecture checks at approve.** `check:architecture` 4/4 rules PASS
(route ratchet holds at baseline 0), `knip` clean, root typecheck clean
across all four workspaces, desktop 5,915 pass / 1 skip / 0 fail,
`tests/platform` clean under `bun test --isolate`, CI's `test` job now
builds `packages/cli` dist before the cli filter (the round-1 live-break
fix).

**Confirmed findings fixed during review**: 7 (round 1) — the CI dist
break, the updater registrar's Electron hard-import, the untested
`.finally` epoch guard, the registrar-liveness gap, the self-referential
export oracle, ADR 0013's fork-story contradiction, and the
subset-presented-as-repo-wide stale-ADR decline plus a dangling ADR 0006
citation. Round 2: approve, 0 confirmed.

**Final pre-acceptance advisories carried to P7:**

1. `bun run check:package-exports` — the plan's P7 gate names this script;
   it does not exist. The coverage lives in `packages/cli`'s test suite;
   P7 either adds the script alias or records the substitution.
2. AC-24 stands **Measured — NOT met** (D13 250 KiB p95 budget; three
   ordered follow-ups recorded in the P3f close-out).
3. AC-16's packaged-asar smoke half remains open for P7's
   packaged-product sweep.
4. Record debt (non-blocking, from the review's advisories): stale
   capability-module counts in three records, `ARCHITECTURE.md`'s registrar
   enumeration omissions, rename fossils in eight files, ADR 0015/0016's
   "all moved" over-statement, and the deferred-publish keystroke-drop
   window (already canonized by test as intended, tracked under the D13
   follow-ups).
5. A11y gaps from the P3d sweep (no ARIA landmark on the rich surface; no
   `<main>`/skip-link) remain open items for the wrap-up.

Gate: see the SFE-P6 run spec's Gate section (report-only, run after this
checkpoint was assembled; results recorded there).
