# print-md — End-to-End Code Quality Review

_Date: 2026-07-03 · Scope: `packages/cli` and `packages/viewer` (~110k LOC)_

## Executive summary

print-md is, at the **leaf level**, better-engineered than most codebases its size: the
CLI's inspection modules (`pdf-inspect`, `image-inspect`, `printsafe`), the `checks/`
registry, the git `classify`/`policy`/`failsafe` separation, the Electron support modules
(`credential-store`, `project-state`, `updater`, `recovery-bridge`), and the renderer's
`EditorBuffer` and platform-adapter seam are all clean, focused, dependency-injected, and
unusually well-commented on the *why*. The §8 "PWA-clean" renderer rule is respected
everywhere. The team demonstrably knows what good looks like.

The problem is that **the load-bearing code doesn't look like the good code**. Four god
files — `routes/+page.svelte` (4,177 lines), `electron/main.ts` (3,014),
`lib/remote-auth/sync.ts` (1,275), and `ProjectConfigPanel.svelte` (1,130) — concentrate
most of the app's risk, and each contains the most bug-prone logic in the system (an export
state machine, an auto-sync orchestrator, a conflict-resolution engine) in a form that
**cannot be unit-tested**. Surrounding them is pervasive copy-paste: the same manifest/YAML
helpers in 3 files, 85 API routes with identical boilerplate, 10 near-identical
service-locators, 3 near-identical git-recovery handlers, and multiple divergent copies of
merge/sync-routing logic. This directly violates the repo's own stated prime directive
("all changes must REDUCE complexity").

The encouraging part: **almost every fix is "make the rest look like the parts that are
already good"** — continue an extraction discipline the codebase already models, not invent
new architecture.

**Overall grade: C+ / B‑.** Strong fundamentals, dangerous concentration of untested
complexity, and accreted duplication that scope growth has outrun.

---

## Top architectural problems (cross-cutting, ranked)

### 1. God modules & god functions — *Critical, systemic*

| File / function | Size | Concerns crammed together |
|---|---|---|
| `routes/+page.svelte` | 4,177 lines, ~80 `$state` fields | preview events, PDF/HTML export FSM, nav/zoom, outline sync, recovery UI, sync orchestration, updater, mobile tabs, 3 keyboard handlers |
| `electron/main.ts` | 3,014 lines, ~18 module `let`s | PDF renderer, preview lifecycle, prefs/settings, windows, auto-snapshot, auto-sync FSM, folder watch, SvelteKit host, all IPC, updater |
| `lib/remote-auth/sync.ts` | 1,275 lines | result types, transport, snapshot, sync/pull/push, **and** a 307-line `resolveConflicts` diff3 engine |
| `ProjectConfigPanel.svelte` | 1,130 lines | 5 former managers (Details/Appearance/Styles/Design/Plugins) merged into one |
| `lib/build-runner.ts` `runBuild` | ~350-line function | manifest, config, gates, preflight, lint, render, assets, **two** divergent HTML/PDF emit branches |

These defeat SRP wholesale, guarantee merge conflicts, and force the whole file into a
reader's head to change any one concern.

### 2. Untestable business logic trapped in views and module globals — *Critical*

The highest-risk logic runs where tests can't reach it: the auto-sync state machine
(`runAutoSync` + globals `autoSyncStates`/`watchedDir`) and the PDF-export FSM live as free
functions/`$state` with side-effecting timers. The test suite reflects this — **only 1 file
in the entire repo uses mocking; 23 test files shell out to real git/Chromium/network and 37
use real tmp dirs.** Nearly everything is integration-tested end-to-end because the units
aren't isolatable.

### 3. Pervasive copy-paste duplication — *High, systemic*

- `manifestPathFor` + `loadDoc` **byte-identical in 3 files** (`manifest-config.ts`,
  `plugin-manager.ts`, `theme-manager.ts`); plus `ensure*Seq`/ref-extractor idioms.
- **85 SvelteKit API routes**, every one hand-rolling the same
  `try { … } catch (e) { error(500, e instanceof Error ? e.message : String(e)) }`; **40**
  re-implement absolute-path validation.
- **10 `server-bridge/*.ts`** files: identical `globalThis` register/get service-locator,
  ~90% duplicated.
- **3 `recover-interrupted-*` handlers** ~90% identical; the 16-handler recovery tree ships
  16 matching 500–1000-line test files.
- `SyncOutcome→RecoveryResult` mapping copied across **5** handlers — **and the copies
  disagree** (latent bug surface).
- Type mirrors duplicated 3-deep (lib → `contract.ts` → `api.ts` → `main.ts`), with the
  header comment justifying it being *wrong* (`import type` is erased, costs zero bundle
  weight).
- `mergeSettings` duplicated in `web-adapter.ts` vs `settings.svelte.ts` — **divergent on
  array handling** (settings-corruption risk); `basenameOf` reimplemented 3×; sync-outcome
  routing duplicated in `+page.svelte` (2×, already drifted).

### 4. Weak abstractions hiding mutable global state — *High*

The `globalThis` service-locator returns `null` on wrong registration order (there's a
load-bearing "must be AFTER…" ordering comment the type system can't enforce). Conflict OIDs
are smuggled through `RecoveryResult` via `as Record<string,string>` because the type
doesn't admit the fields. Build helpers take ad-hoc structural shapes
(`{ pdfx: { stripAnnotations } }`) instead of `ResolvedConfig`, so renames won't flag call
sites.

### 5. Documentation ↔ code drift on the core architecture — *High*

`CLAUDE.md` §8 and `packages/viewer/README.md` state the viewer is a **static SvelteKit SPA
(`adapter-static`) served via `app://` with 3 `ipcMain.handle()` endpoints, "No more
SvelteKit HTTP server inside Electron."** The actual code uses **`@sveltejs/adapter-node`,
boots a local HTTP server from `build/handler.js`, and exposes 85 `+server.ts` HTTP
routes.** The single most important architecture doc in the repo describes a design the code
no longer uses. Relatedly, the §8 verification `grep` doesn't guard the one sanctioned
renderer lib-import (`@dimm-city/print-md/render`) against transitively pulling `node:*`.

### 6. Over-partitioning (the opposite failure) — *Medium*

The git-recovery layer is *over*-built: 16 error kinds each get a dedicated handler **and**
a 500–1000-line test file. Consolidating the near-identical handlers removes **1,000+ lines
with zero capability loss**.

---

## File-by-file findings (highest-impact)

### CLI core (`packages/cli/src/`)

- **`build-runner.ts` `runBuild` (582–936) — High.** 350-line god function; extract
  `prepareBuild()→BuildContext`, `emitHtml(ctx)`, `emitPdf(ctx)`.
- **`build-runner.ts` 728–752 vs 798–820 — High.** HTML and PDF branches duplicate the
  entire stage-dir/copy-assets/vendor/patch sequence; extract `stagePaginationInput(...)`.
- **`theme-manager.ts` / `plugin-manager.ts` / `manifest-config.ts` — High.**
  `manifestPathFor`+`loadDoc` copy-pasted 3×; consolidate into one `manifest-doc.ts`.
- **`theme-manager.ts:146` vs `project-scaffold.ts:145` — Medium.** Two near-identical
  slugifiers; one `slug.ts`.
- **`project-scaffold.ts` 302–317 vs 429–446 — Medium.** Duplicated `local-git`
  version-history init; extract `maybeInitVersionHistory()`.
- **`commands/build.ts` vs `preview.ts` — Medium.** `parseFormat`/`parsePdfxFlavor`
  copy-pasted **and call `process.exit(2)` from inside a parse function** — untestable.
- **`source-provider.ts:132,447 — Medium.** `listHistory(projectDir)` takes a `projectDir`
  the impl discards (`_projectDir`); drop the dead param.
- **`build-runner.ts` 468–498 — Medium.** Brittle regex surgery on serialized HTML; do it in
  `page.evaluate` against the live DOM.
- **`api/index.ts` — Medium.** 350-line barrel exporting ~50 symbols; split/prune.
- **`build-runner.ts:306` — Low.** `RENDER_TIMEOUT_MS = 1 hour` is effectively no timeout.
- **Positive:** `checks/`, `pdf-inspect`/`image-inspect`/`printsafe`, lazy subcommand
  loading — clean, keep.

### CLI git/recovery (`lib/remote-auth/`)

- **`sync.ts` (whole file) — High.** 1,275-line god module; split into `sync-types.ts`,
  `transport.ts`, `conflict-resolution.ts`.
- **`sync.ts:968–1275` `resolveConflicts` — High.** 307-line function doing ~8 jobs incl. an
  inlined re-implementation of its own race-recovery. Extract pure `buildResolutionPlan()`,
  `applyResolvedMerge()`, `pushWithRaceRecovery()`.
- **`recover-interrupted-{merge,cherry-pick,rebase}.ts` — High.** ~90% identical; collapse
  to one `abortInterruptedOperation(ctx, config)` (removes ~1,300 lines of impl+test).
- **`recover-binary-conflict.ts` / `recover-unrelated-histories.ts` — High.**
  `localId`/`remoteId` smuggled via `as Record<string,string>`; add fields to the
  `needs_user` arm in `types.ts`.
- **5 recovery handlers — Medium/High.** `SyncOutcome→RecoveryResult` mapping duplicated and
  inconsistent; centralize `mapOutcomeToResult()`.
- **`manual-guidance.ts:64–315 — Medium.** 250-line switch with duplicated copy; make it a
  `Record<SyncErrorKind, GuidanceCopy>` data table.
- **`clone.ts` / `recover-missing-git-dir.ts` — Medium.** Re-inline the `onAuth` block
  despite an exported `onAuthFor`; import it.
- **`classify.ts:105–220 — Medium.** Classification regex-matches isomorphic-git error
  message strings — a silent-misroute hazard; prefer `err.code`.
- **`types.ts:131–152 — Medium.** Six-status `RecoveryResult` taxonomy overlaps; collapse.
- **Positive:** `classify`/`policy`/`failsafe`/`backup` and `dispatch.ts`'s exhaustive
  switch are the right patterns — keep.

### Viewer renderer (`packages/viewer/src/`)

- **`+page.svelte` — Critical.** 4,177-line god component; decompose into
  `ExportController`/`PreviewController`/`SyncController`/`UpdateController` `.svelte.ts`
  classes (mirror `EditorBuffer`) + a `WorkspaceLayout` component.
- **`+page.svelte` 1503–1955 — High.** PDF export FSM + `friendly*Error` mappers trapped in
  the view; extract to `ExportController.svelte.ts` + `lib/errors.ts`.
- **`+page.svelte` 737/766/2086 — High.** Three hand-rolled rAF/timeout retry loops (source
  of intermittent focus/reveal bugs); one `waitFor()` util or a real `onReady` signal.
- **`+page.svelte` 382–417 vs 2539–2573 — Medium.** Sync-outcome routing duplicated and
  already divergent; one `applySyncOutcome()`.
- **`ProjectConfigPanel.svelte` — Critical.** 5 domains in one file; split into per-section
  components.
- **`ProjectConfigPanel.svelte:477–488 — High (correctness).** Per-token read-modify-write
  clobbers concurrent edits; serialize through one read-once/apply-all/write-once queue;
  extract `lib/style-tokens.ts`.
- **`LeftPanel.svelte:99–251 — High.** ~150 lines of History logic (+ dead `notifyOpened`)
  with no History tab rendered; delete or extract `HistoryPanel.svelte`.
- **`GitHubDialog.svelte` — High.** 6-step wizard FSM with manual 15-field reset; extract
  `githubImportController.ts`.
- **`EditorToolbar.svelte:134–184 — High.** Image path-resolution with two normalization
  schemes inline; extract tested `resolveImageInsertPath()`.
- **`api.ts:34–257 — Medium.** Contract types mirrored a second time on a mistaken rationale;
  `import type` and delete; type `classification: any`.
- **`web-adapter.ts:170` vs `settings.svelte.ts:32 — Medium.** `mergeSettings` duplicated and
  divergent on arrays; one `lib/settings-merge.ts`.
- **Low sweep:** `ConflictChoicesDialog.svelte:88` no-op `.replace(m=>m)`; `EditorToolbar`
  reimplements shared `trapFocus` and hardcodes the toolbar twice; `ProjectsListBody`
  `catch {}` swallows load failures and does live-DOM keyboard-index nav.
- **Positive:** §8 purity fully honored; `EditorBuffer` and `lib/editor/*` are the model.

### Viewer host (`packages/viewer/electron/`)

- **`main.ts` — Critical.** 3,014-line god module; split into `pdf-export`, `preview`,
  `*-store`, `windows/`, `auto-snapshot`, `auto-sync/`, `sveltekit-host`, `ipc/`.
- **`main.ts` auto-sync — Critical.** State machine trapped in module globals, untestable;
  extract `AutoSyncOrchestrator` class with injected deps.
- **`main.ts:2279–2583 `api:preview` — High.** ~300-line handler with two nested async
  IIFEs; reduce to `validate → preview.start → recents.record → orchestrator.onProjectOpen`.
- **`server-bridge/*.ts` (10 files) — High.** Identical service-locator boilerplate; one
  generic `createHostBridge<T>(key)`.
- **`main.ts:2638 `api:build` — High.** Re-implements the conflict-latch the orchestrator
  owns; expose `orchestrator.syncBeforeExport()`.
- **`main.ts` 18 `let`s + copied guard (8×) — Medium.** Encapsulate state; guard becomes one
  `isCurrent(dir)`.
- **`main.ts:422–524 — Medium.** `AppSettings`/`DeepPartialSettings` re-declared despite
  `bridge-types.ts` re-exporting them.
- **`handleVcsErrors`/`handleRemoteErrors` — Medium.** Same boundary twice; one
  `makeErrorBoundary()` factory.
- **Low:** ad-hoc `webContents.send` wrappers → one typed `RendererChannel`; coded-error
  cast 6× → `CodedError`; migration-tombstone comments bloat `main.ts`/`preload.ts`.
- **Positive:** `recovery-bridge`, `credential-store`, `project-state`, `recent-folders`,
  `discover-projects`, `updater` are exemplary — the template for the rest.

---

## Recommended refactoring plan (phased)

**Phase 0 — Docs & guardrails.** Reconcile `CLAUDE.md` §8 + `viewer/README.md` with the
adapter-node reality; add a CI assertion that `@dimm-city/print-md/render` pulls no `node:*`.

**Phase 1 — Critical correctness (TDD).** Fix the token read-modify-write race (extract
`lib/style-tokens.ts` + serialized queue); unify the divergent `mergeSettings` array
handling into `lib/settings-merge.ts`.

**Phase 2 — Mechanical de-duplication (TDD).** `withRoute()` wrapper (85 routes);
`createHostBridge<T>()` (10 bridges); shared `manifest-doc.ts`, `slug.ts`, `errors.ts`,
`format.ts`; consolidate `basenameOf`.

**Phase 3 — Git recovery consolidation (TDD).** `abortInterruptedOperation()`;
`mapOutcomeToResult()`; `manual-guidance` data table; add `localId/remoteId` to
`RecoveryResult` and delete the `as Record<string,string>` casts.

**Phase 4 — Extract the untestable state machines (TDD).** `AutoSyncOrchestrator` (host,
injected deps); `ExportController.svelte.ts` (renderer); pure `buildResolutionPlan()` out of
`resolveConflicts`; `prepareBuild/emitHtml/emitPdf` out of `runBuild`.

**Phase 5 — Break up the god files** (mechanical once Phase 4 lands): `main.ts`,
`+page.svelte`, `sync.ts`, `ProjectConfigPanel.svelte` become composition roots.

---

## Suggested design patterns (only where justified)

- **Extract Class + Dependency Injection** (`AutoSyncOrchestrator`, `ExportController`) —
  highest value; converts the most bug-prone code into unit-testable units.
- **Higher-order wrapper / decorator** (`withRoute`, `makeErrorBoundary`,
  `createHostBridge`) — collapses 85 + 10 + 2 duplications.
- **Value object** (`BuildContext`) — untangles `runBuild`'s two emit paths.
- **Table-driven dispatch** (`Record<Kind, Copy>`, `Record<status, State>`) — replaces long
  switches with data.
- **NOT recommended:** don't replace `dispatch.ts`'s exhaustive switch with a registry;
  don't add a print-md-specific plugin API (§5 rule holds); no DI containers / event buses.

---

## Testing improvements

The suite's real weakness is **isolation, not coverage** (72 CLI + 37 viewer test files, but
1 uses mocking). The Phase-4 extractions are the enabler — once the orchestrator and export
FSM take injected `{now, emit, loadLib, tokenStore}`, their invariants become fast unit tests
with a fake clock, replacing the current need for Electron + a real repo + network. Split the
monolithic test files (`sync.test.ts` 1,371; `checks.test.ts` 1,168; each `recover-*.test.ts`
500–1,000). Make the pure mappers testable by extracting them. Add the `render`-subpath
purity CI check.

---

## Technical debt to delete or simplify

- **Delete:** `LeftPanel.svelte` History logic + dead `notifyOpened`/unused deriveds;
  `ConflictChoicesDialog` no-op `.replace(m=>m)`; migration-tombstone comments in
  `main.ts`/`preload.ts`; `source-provider` dead `projectDir` params; duplicate Ctrl+Shift+E
  keydown branch.
- **Simplify by consolidation (~3,000+ lines removable):** 85-route boilerplate, 10
  service-locators, 3 interrupted-* handlers + tests, 3× manifest helpers, 2× merge/slug/
  basename copies, 5× outcome mapping, 3-deep type mirrors.
- **Prune:** the ~50-symbol `api/index.ts` barrel to a curated public surface.

---

## Prioritized roadmap

| Priority | Item | Why now | Effort |
|---|---|---|---|
| **Critical** | Token read-modify-write race; divergent `mergeSettings` arrays | Silent data loss / settings corruption today | S |
| **Critical** | Extract `AutoSyncOrchestrator` + renderer controllers (DI) | Most bug-prone code, currently untestable | L |
| **High** | `withRoute` / `createHostBridge` / shared util modules | ~3k lines of duplication | M |
| **High** | Consolidate `recover-interrupted-*` + outcome mapping + guidance table | ~1k+ lines, inconsistent copies = latent bugs | M |
| **High** | Reconcile CLAUDE.md/README architecture docs | Actively misleads contributors | S |
| **High** | Decompose `runBuild` / `resolveConflicts` into pure units | Untestable core pipelines | M |
| **Medium** | Split the god files into composition roots | Follows from the extractions | L |
| **Medium** | Type-safety: `RecoveryResult` fields, `ResolvedConfig` params, dedupe type mirrors | Removes footguns | M |
| **Low** | Naming, `CodedError`, `RendererChannel`, comment cleanup, `api/index` prune | Readability polish | S |

**The single most valuable move:** Phase 4 (extract the state machines with DI). It
simultaneously kills the two Critical problems — the god files *and* the testability crisis —
because you can't break up `main.ts`/`+page.svelte` safely until their logic lives in tested,
injectable units.
