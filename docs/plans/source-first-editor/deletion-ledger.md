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
| Desktop HTTP routes (`+server.ts`) | 104 | — | — |
| IPC handlers (`ipcMain.handle`) | 12 (`secureHandle` registrations — the sole `ipcMain.handle` call site is 1; see baseline.md §4.2) | — | — |
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
| Desktop typed HTTP `api.ts` | Route client | Typed IPC | P5d | file absent | One transport |
| `src/routes/api/**` | Electron request/reply host | Typed IPC | P5c/P5d | route count zero | One transport |
| Adapter-node desktop server | Execute SvelteKit routes | Static renderer + IPC | P5d | dependency/server search | Deletes loopback service |
| Loopback bearer token/proxy | Secure local server | Server absent | P5d | symbol search | Removes attack/failure mode |
| Route-only DTO duplication | HTTP transport shapes | Capability/IPC contracts | P5c/P5d | type search | Fewer models |
| Tracked generated directories | Build output in source | CI-generated only | P0b | git ls-files proof | Cleaner repository |
| Stale ADR references/comments | Historical architecture drift | Current ADRs | P6c/P7 | doc link check | Discoverable rationale |
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
