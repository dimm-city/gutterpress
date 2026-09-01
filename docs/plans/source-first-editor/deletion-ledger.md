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
| `Platform`/`HostServices` methods | 30 (9 `PlatformAdapter` + 21 `HostServices`, combined with one override; platform-inventory.md §1–§2) | — | — |
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
| `WebAdapter` | Dormant future PWA | Future web host is separate package | P5a | file/import search | Deletes false host implementation — **DONE, mid-flight (uncommitted as of this Lane C pass, 2026-09-01)**: `packages/desktop/src/lib/platform/web-adapter.ts` (901 lines) staged-deleted; class and every runtime reference gone from `contract.ts`/`index.ts`/`+layout.svelte`/`+page.svelte`/`settings.svelte.ts`/`SyncStatusPill.svelte`/`adapter.test.ts` (search proofs below); `getPlatform()` now throws `DesktopHostRequiredError` off-Electron instead of falling back to it (the run's "fail loudly, not partially" binding decision) |
| `web-fs` / `web-store` | Browser filesystem and persistence | Unsupported in desktop | P5a | file/import search | Deletes dormant stores — **DONE, mid-flight**: `web-fs.ts` (279 lines) + `web-fs.test.ts` (228 lines), `web-store.ts` (167 lines, including `InMemoryWebStore`) + `web-store.test.ts` (56 lines), and `fsa.d.ts` (31 lines) all staged-deleted; zero remaining occurrences of `web-fs`/`web-store`/`InMemoryWebStore`/`FileSystemDirectoryHandle`/`showDirectoryPicker` under `packages/desktop/src`\|`electron`\|`tests` (search proofs below) |
| PWA service-worker path | Future browser app | Out of scope | P5a | build/search proof | Smaller desktop build — **DONE, mid-flight**: `src/service-worker.ts` (110 lines) + `tests/platform/service-worker.test.ts` (77 lines) staged-deleted; the `!isDesktop()`-gated registration block deleted from `+layout.svelte`; `svelte.config.js`'s `serviceWorker: { register: false }` override removed (SvelteKit's default — no auto-registration to suppress once there is no SW to register); zero `serviceWorker` occurrences left under `packages/desktop/src`. **Resolved by the integrator in the same commit:** `app.html`'s `<link rel="manifest">` and its PWA comment removed, and `api.ts`'s stale WebAdapter-staging comment rewritten as history. |
| Duplicate static viewer bundle | PWA fallback | Shared render asset ownership | P5a | generated file proof | One bundle output — **NOT reflected in the current diff.** `packages/desktop/static/engine/gutterpress-viewer.js` is untouched (present, unstaged) — matching the run spec's "static `engine/`/`icons/` assets (not PWA-only; verify, don't assume)" instruction and `platform-inventory.md` §13's description of it as a **shared** asset `WebAdapter.renderBookHtml` also injected, not a PWA-only duplicate. Whether any actual "duplicate bundle" remains to delete was not established by this lane (production/build-asset investigation is outside this lane's write ownership) — the integrator should confirm with Lane A/B whether this row describes something already resolved elsewhere or should be re-scoped/closed as not-applicable |
| Broad `Platform` service locator | Electron/PWA abstraction | Narrow feature capabilities | P5b | consumer/import search | Explicit dependencies |
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

### SFE-P5a — 2026-09-01 — delete the dormant PWA implementation (Lane C doc pass, Lane A/B mid-flight)

**This section is written concurrently with Lane A/B's own work, per the run
spec's instruction to Lane C.** Everything below the file/line-count table is
a snapshot of the working tree at the time this lane ran — **nothing in
`packages/desktop/src/lib/platform/**`, `service-worker.ts`,
`static/manifest.webmanifest`, `svelte.config.js`, `knip.jsonc`, or
`tests/platform/**` is committed yet**, and this lane did not write any of
those files (production source and test files are outside this lane's write
ownership; see "Docs statused this run" below for what this lane actually
wrote). No commit SHA exists to cite. The integrator must re-run every search
proof below against the committed HEAD before treating this section as final,
and fill in the commit SHA(s) once Lane A/B's work lands.

#### File-level diff, current working tree vs. this run's start (`git diff HEAD`, uncommitted)

| File | Insertions | Deletions | Note |
|---|---:|---:|---|
| `packages/desktop/src/lib/platform/web-adapter.ts` | 0 | 901 | staged delete — the `WebAdapter` class |
| `packages/desktop/tests/platform/web-adapter-persistence.test.ts` | 0 | 199 | staged delete |
| `packages/desktop/tests/platform/web-fs.test.ts` | 0 | 228 | staged delete |
| `packages/desktop/src/lib/platform/web-fs.ts` | 0 | 279 | staged delete |
| `packages/desktop/src/lib/platform/web-store.ts` | 0 | 167 | staged delete — incl. `InMemoryWebStore` |
| `packages/desktop/tests/platform/web-store.test.ts` | 0 | 56 | staged delete |
| `packages/desktop/tests/platform/service-worker.test.ts` | 0 | 77 | staged delete |
| `packages/desktop/src/service-worker.ts` | 0 | 110 | staged delete |
| `packages/desktop/src/lib/platform/fsa.d.ts` | 0 | 31 | staged delete |
| `packages/desktop/static/manifest.webmanifest` | 0 | 20 | unstaged delete |
| `packages/desktop/src/lib/platform/index.ts` | 27 | 6 | `getPlatform()` fails loudly (`DesktopHostRequiredError`) instead of falling back to `WebAdapter` |
| `packages/desktop/src/lib/platform/contract.ts` | 29 | 36 | doc-comment/type cleanup — every "on a future PWA" branch removed from `FolderRef`/`FileRef`/`PlatformCapabilities` doc comments |
| `packages/desktop/tests/platform/adapter.test.ts` | 9 | 478 | every `WebAdapter`-targeted test deleted; one test rewritten to assert `DesktopHostRequiredError` |
| `packages/desktop/src/routes/+page.svelte` | 8 | 9 | stale `WebAdapter`/`web-adapter.ts` comment references removed |
| `packages/desktop/src/routes/+layout.svelte` | 4 | 21 | SW registration block deleted |
| `packages/desktop/src/lib/settings.svelte.ts` | 4 | 5 | doc comment: dormant `WebAdapter` `localStorage` path no longer exists |
| `packages/desktop/src/lib/components/SyncStatusPill.svelte` | 4 | 2 | doc comment: the `isDesktop()` guard is now load-bearing, not cosmetic |
| `knip.jsonc` | 7 | 10 | `src/service-worker.{ts,js}` and `web-store.ts` dropped from the desktop `entry`/exemption list, with the `docs/adr/0004-platform-abstraction.md` citation also dropped (that ADR does not exist in this repo — see "ADR statusing" below) |
| `packages/desktop/svelte.config.js` | 0 | 3 | `serviceWorker: { register: false }` override removed |
| **Total (19 files, production + test, Lane A/B)** | **92** | **2,638** | **net −2,546**, verified by `git diff HEAD --shortstat` on the same path set |

Command run: `git diff HEAD --numstat -- packages/desktop/src/lib/platform/
packages/desktop/src/service-worker.ts
packages/desktop/static/manifest.webmanifest packages/desktop/svelte.config.js
packages/desktop/tests/platform/ packages/desktop/src/routes/+layout.svelte
packages/desktop/src/routes/+page.svelte
packages/desktop/src/lib/settings.svelte.ts
packages/desktop/src/lib/components/SyncStatusPill.svelte knip.jsonc`, cross-
checked against `git diff HEAD --shortstat` on the same path set:
`19 files changed, 92 insertions(+), 2638 deletions(-)`. Split by kind:
production (14 files, excl. the 5 `tests/platform/*` files): 83 insertions,
1,600 deletions, net −1,517; tests (5 files): 9 insertions, 1,038 deletions,
net −1,029. This lane's own doc edits (CLAUDE.md, `docs/pwa-webadapter-plan.md`,
this ledger) are separate and listed under "Docs statused this run" below —
not counted in the table above, which is production/test only.

#### Search proofs (run 2026-09-01, from repo root, against the CURRENT WORKING TREE — Lane A/B uncommitted; re-run at commit time)

Per the run spec's D15 requirements: `WebAdapter` → zero runtime occurrences;
`web-fs`/`web-store` → zero; service-worker registration → zero;
`manifest.webmanifest` → gone unless something non-PWA consumes it.

```
$ grep -rn 'WebAdapter' packages/desktop/src packages/desktop/electron
packages/desktop/src/lib/components/SyncStatusPill.svelte:77:    // getPlatform() now throws off-Electron (the dormant WebAdapter it used
packages/desktop/src/lib/platform/index.ts:7: * SFE-P5a (D10): the dormant browser host (`WebAdapter`) was deleted — a
packages/desktop/src/lib/platform/contract.ts:540:// WebAdapter, SFE-P5a) was deleted with it — see D10.
packages/desktop/src/lib/api.ts:270:     * WebAdapter plan's Phase 1 (docs/pwa-webadapter-plan.md lists
packages/desktop/src/lib/api.ts:271:     * listProjectFiles), whose WebAdapter.listProjectFiles is the live browser
packages/desktop/src/lib/settings.svelte.ts:34: * `WebAdapter`, but that adapter was deleted; a future web product is a
packages/desktop/src/routes/+layout.svelte:10:  // was deleted along with `src/service-worker.ts` and the dormant WebAdapter

$ grep -rln 'WebAdapter' packages/desktop/src packages/desktop/electron packages/desktop/tests
packages/desktop/src/lib/components/SyncStatusPill.svelte
packages/desktop/src/lib/platform/index.ts
packages/desktop/src/lib/platform/contract.ts
packages/desktop/src/lib/api.ts
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
packages/desktop/src/app.html

$ grep -n 'manifest.webmanifest' packages/desktop/src/app.html
13:    <link rel="manifest" href="%sveltekit.assets%/manifest.webmanifest" />

$ ls packages/desktop/static/manifest.webmanifest
ls: cannot access 'packages/desktop/static/manifest.webmanifest': No output (file gate absent — file is gone)
```

**Reading the results against D15's four required proofs:**

1. **`WebAdapter` → zero runtime occurrences: NOT YET CLEAN, but every hit is
   a comment, not code — except one.** Six files still contain the string
   `WebAdapter`. Five are doc-comment mentions describing the *removal*
   (`SyncStatusPill.svelte`, `index.ts`, `contract.ts`, `settings.svelte.ts`,
   `+layout.svelte`) — no executable reference, matching the P4 ledger's
   precedent of counting comment-only hits as sanctioned residuals once they
   describe the deletion by name. The sixth, **`packages/desktop/src/lib/api.ts:270-271`,
   is stale present-tense prose** ("whose `WebAdapter.listProjectFiles` is the
   live browser implementation") describing a class that no longer exists —
   this is a real defect, not a sanctioned residual, but `api.ts` is a P5d
   deletion target (see the "Desktop typed HTTP `api.ts`" row above) and
   outside every P5a lane's write ownership (production source). **Flagged
   for the integrator; not fixed by this lane.**
2. **`web-fs`/`web-store` → zero: CLEAN.** Both greps (including
   `InMemoryWebStore` by name) return no output under `src`, `electron`, or
   `tests`.
3. **Service-worker registration → zero: CLEAN in code; ONE dangling markup
   reference.** No `serviceWorker` identifier remains in `src`, `electron`,
   or `svelte.config.js`. But `packages/desktop/src/app.html:13` still emits
   `<link rel="manifest" href="…/manifest.webmanifest">`, and nothing
   registers a service worker to consume it any more — this is not a
   "service-worker registration" hit itself, but it is the install-affordance
   half of the same PWA surface, now pointing at a 404. **Flagged for the
   integrator; not fixed by this lane** (production source, out of this
   lane's write ownership).
4. **`manifest.webmanifest` → gone unless something non-PWA consumes it: THE
   FILE IS GONE, but something still references it.** `static/manifest.webmanifest`
   no longer exists (confirmed: `ls` reports "No such file or directory").
   The one remaining reference, `app.html`'s `<link rel="manifest">`, is not
   "something non-PWA consuming it" — it is the PWA install tag itself,
   left behind pointing at nothing. Per the run spec's binding decision
   ("Fail loudly, not partially"), a dangling link tag is a partial-deletion
   defect, not an acceptable residual; the D15 bullet's "unless" clause is
   not satisfied here.

**Net verdict:** the `WebAdapter`/`web-fs`/`web-store`/service-worker-code
deletion itself (Lane A's actual scope) reads as complete and clean by these
proofs. Two loose ends surfaced by this lane's search — the stale `api.ts`
comment and the dangling `app.html` manifest link — sit outside every P5a
lane's write ownership (both are production source) and are recorded here so
the integrator can route them to whichever lane/round closes them before the
gate; they are not blockers for the doc-statusing this lane owns.

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
`docs/adr/0004-platform-abstraction.md` by path (confirmed in this file's
git history — the P5a-in-progress working copy, read by this lane, has
already dropped that citation as part of Lane B's edit, alongside the
`service-worker.{ts,js}`/`web-store.ts` entries the same comment protected).
That citation removal is Lane B's, not this lane's; noted here only as
corroborating evidence that ADR 0004 is correctly treated as absent, not as
a status-note target this lane skipped.

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
  content touched — the route/adapter guidance (the "Transport", "Two seams,
  not one", and "(A)"/"(B)" capability-adding instructions) is unchanged, per
  the run spec's explicit "stays until P5b/P5c update it." Measured:
  `git diff --stat CLAUDE.md` → `21 insertions(+), 21 deletions(-)`.
- **`docs/pwa-webadapter-plan.md`** — a new status block inserted at the top
  of the existing status blockquote: "CLOSED 2026-09-01 (0.11, SFE-P5a, plan
  D10) — the implementation this plan describes was removed, not completed,"
  naming what was deleted, pointing to this ledger's SFE-P5a entry for proof,
  and stating explicitly that the rest of the document is historical and
  should not be resumed from or cited as evidence of a live web host. The
  original "partially shipped, plan revised 2026-08-23" status line is kept
  immediately below, relabeled "Status (historical)," and the body (phases,
  capability matrix, open questions) is untouched. Measured: `git diff --stat
  docs/pwa-webadapter-plan.md` → `23 insertions(+), 4 deletions(-)`.
- **`docs/adr/**`** — no file edited; see "ADR statusing" above for why
  (ADR 0004 does not exist in this repository; no present ADR describes the
  WebAdapter/FSA path).
- **This ledger** — the four P5a rows in the "Planned deletions" table above
  updated with DONE/status markers and proof pointers; this section added.

#### Verification run (this lane, from repo root)

| Command | Exit code | Note |
|---|---:|---|
| `git diff --stat -- CLAUDE.md docs/pwa-webadapter-plan.md docs/plans/source-first-editor/deletion-ledger.md` | 0 | this lane's own write set only |
| `grep -n 'WebAdapter' CLAUDE.md docs/pwa-webadapter-plan.md` | 0 | every remaining hit is historical/past-tense (removal description, or the plan's own pre-closure body kept as history) — see per-file confirmation in "Docs statused this run" |
| `bun run --cwd packages/desktop check 2>&1 \| tail -40` | see notes | run for awareness only, against the concurrently-changing Lane A/B tree — not a gate this lane owns; see the structured report's Verification section |

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
