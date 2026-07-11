# UX Critical Review — print-md viewer, CLI, and author documentation

**Date:** 2026-07-10
**Panel:** 6 expert reviewers (onboarding, editing, preview/export, config/theming, sync/recovery, CLI/docs), findings adversarially verified where marked.
**Scope:** `packages/viewer/` renderer + electron host, `packages/cli/` command surface, `README.md`, `docs/`, `examples/print-md-user-guide/`.

**Verification legend:** findings tagged **Confirmed** were adversarially re-verified against the code (severities reflect the verifier's adjustments, not the original reviewer's). Findings tagged **Not verified** are medium/low findings taken at reviewer's word with cited evidence; spot-check before acting. Three claims were investigated and refuted — see the appendix.

---

## 1. Executive summary

Across all six areas the same picture recurs: the individual pieces are unusually well crafted — the `EditorBuffer` state machine, the conflict-resolution copy, the friendly-error mappers, the recommended-plugins flow — but the *seams between the pieces* are where the product fails its stated audience of non-technical writers. Eight themes dominate:

**1. Safety promises the UI cannot keep.** This is the most serious theme, because the product's core pitch to writers is "your work is never lost." The external-edit auto-reload path updates the buffer but never the visible editor, so the writer's next keystroke silently overwrites the external version on disk under a toast claiming the file was reloaded. Version-history restore is a complete, tested host pipeline with **zero call sites** — the UI promises "snapshots, history, restore" in three places and delivers none of it. Re-applying a built-in theme silently `cp -r`'s over hours of Design-panel customization; theme Remove is a one-click unconfirmed `rm -rf`; auto-snapshot failures are swallowed to `console.error` while the pill asserts "Version history on."

**2. The documentation is an active trap.** The flagship user guide — billed as canonical — teaches a `ttrpg` plugin that does not exist anywhere in the product (following it verbatim produces a failed build whose error tells the writer to `bun add` an arbitrary npm package named `ttrpg`), documents environment variables the code never reads, CSS classes core never emits, a wrong preview port, and manifest keys that are silently ignored. The guide's own source contains `@callout` markers core cannot render, so the guide's own PDF prints literal marker text. The CLI README documents flags that don't exist and omits four commands including `print-md new`, the intended onboarding path.

**3. False-green states.** `print-md validate --phase post` — the invocation the README documents — matches zero checks and exits 0: a CI pipeline believes an unvalidated PDF passed. A lint-infrastructure failure in the viewer renders as "No problems found — your project looks good!" Failed recents/templates/discover loads render as authoritative empty states ("No recent projects yet"). For a preflight tool, a false pass is worse than no tool.

**4. `+page.svelte` is a 3,829-line god file.** Three reviewers flagged it independently. The startup/open/adopt lifecycle, export orchestration, crash recovery, problems state, and global shortcuts remain inline despite nine extracted controllers proving the team knows the cure. Workspace-reset logic is hand-duplicated across four sites with divergent field subsets — which is precisely how the Cancel-closes-project defect shipped.

**5. Dialog scaffolding is duplicated ten ways and has already diverged.** A shared `dialogBehavior` action exists and documents itself as the single owner of the modal a11y contract, but only 4 of 10 dialogs use it. The other six hand-roll trapFocus/Escape/backdrop with divergent guards, ~100–150 lines of byte-similar shell CSS apiece, and observable behavioral drift: identical-looking dialogs respond differently to Escape vs backdrop-click mid-operation, and `CrashRecoveryDialog` — the scariest dialog in the app — has no focus trap, no Escape handling, and `role="dialog"` on the wrong element.

**6. Destructive actions without confirmation.** Theme removal, snippet deletion, Git-server disconnect (deleting a painfully-acquired token), crash-recovery Discard, and — worst — the render overlay's "Cancel" button, which appears during every routine auto-save rebuild and silently tears down the entire project session when clicked.

**7. Error-message quality is a lottery.** The codebase has good friendly-error machinery (`friendlyHostError`, `friendlyPdfError`, host-side `handleRemoteErrors`), but call sites bypass it inconsistently: the sync-conflict export failure — where the host wrote a perfect plain-language message — is overwritten with "check System tools"; publish, force-save, recovery-restore, and HTML-export paths toast raw `e.message`; `friendlyHostError`'s "single source of truth" docblock is contradicted by an inline byte-identical copy of its regex.

**8. Notification channels are misassigned.** "Your book is ready — N pages" success-toasts fire on *every* debounced auto-save rebuild, training writers to ignore all toasts; meanwhile the "#1 cause of wrong fonts/styles" (missing shared asset folders) is delivered as a 5-second auto-dismissing toast instead of a persistent Problems entry, and the Problems panel itself vanishes entirely below 820px with no badge.

The good news: a large majority of the fixes are `effort: small`. The structural work (god-file decomposition, dialog migration, FileTree CRUD) is well-scoped and follows patterns the codebase already established.

---

## 2. Findings

### High severity

---

#### H1. External-edit auto-reload updates the buffer but never the visible editor — stale screen, then silent overwrite of the external version

`severity: high` · `effort: small` · `category: correctness / data-loss` · **Confirmed**

Files: `packages/viewer/src/routes/+page.svelte:902`, `+page.svelte:1010-1013`, `packages/viewer/src/lib/editor/buffer-state.svelte.ts:341-347`, `packages/viewer/src/lib/components/MarkdownEditor.svelte:259-263`

When the open file changes on disk and the buffer is clean, `EditorBuffer.reconcileExternalChange()` adopts the disk content (`buffer-state.svelte.ts:340-347`) and fires `onAutoReloaded` — whose handler is only `() => toast?.info?.("Reloaded from disk")` (`+page.svelte:902`). `MarkdownEditor` reads its `content` prop exactly once, in `onMount`'s `buildState` (line 269); the component contains no `$effect` at all, so the derived prop update is inert. A repo-wide grep shows `updateContent()` is called in exactly one place — `+page.svelte:1012` inside `reloadExternal()`, the conflict-banner path. Result: after an auto-reload the CodeMirror document shows the **old** text while `buffer.content`/`diskContent` hold the **new** text, under a toast claiming the file was reloaded. The writer's next keystroke sends the stale doc through `onChange → buffer.edit →` the debounced auto-save, silently overwriting the external version — and the mtime self-echo guard suppresses re-detection. Silent data loss plus a misleading UI message, in the feature built specifically for this flow. No mitigation exists.

**Fix:** in `onAutoReloaded`, call `editorRef?.updateContent(buffer.content)` before the toast — same as `reloadExternal` does. Longer term, give `EditorBuffer` a single `contentReplaced` callback consumed by one code path so buffer/editor desync is structurally impossible.

---

#### H2. Version-history restore is unreachable from the UI while copy promises it everywhere

`severity: high` · `effort: medium` · `category: dead-code / broken-promise` · **Confirmed**

Files: `packages/viewer/src/routes/api/vcs/restore-snapshot/+server.ts:17`, `packages/viewer/src/lib/api.ts:425`, `packages/viewer/src/lib/components/ProjectActivityView.svelte:82`, `packages/viewer/src/lib/components/LeftPanel.svelte:94`, `packages/viewer/src/lib/components/AdvancedSetupDialog.svelte:238`, `packages/viewer/src/lib/components/ConflictChoicesDialog.svelte:276`

The restore pipeline is complete end-to-end on the host — `restore-snapshot` route with SHA validation and `restoreVersionWithBackup`, the `api.vcs.restoreSnapshot` wrapper — but a grep across the viewer finds **zero call sites** (only the wrapper, two comments, the route, and a friendly-errors test). The History tab was removed (`LeftPanel.svelte:93-100`: "there is currently no version-history UI in this panel"; `notifyHistoryRefresh`/`resetHistoryState` are documented no-ops) and `ProjectActivityView` renders snapshots as plain read-only `<li>` elements. Meanwhile the writer-facing copy promises restorability three times: `AdvancedSetupDialog.svelte:238` and `:481` ("preview, snapshots, history, restore"), `ConflictChoicesDialog.svelte:276-278` ("A snapshot of your work was saved automatically before combining"), `RecoveryConfirmDialog` ("nothing is lost"). Snapshots are real git commits, so nothing is destroyed — but for this product's explicitly non-technical audience, git-only access is effectively no access, and the UI actively advertises restore. The core safety loop is open.

**Fix:** add a Restore action per entry in `ProjectActivityView` (the route already snapshots-before-restore per ADR 0006 D5, so it is safe) with plain-language confirm copy ("We'll save what you have now first"). If restore is intentionally deferred, delete the dead route + wrapper and soften every "restore" promise in the copy.

---

#### H3. The user guide teaches a `ttrpg` plugin that does not exist anywhere in the product

`severity: high` · `effort: medium` · `category: docs-drift` · **Confirmed**

Files: `examples/print-md-user-guide/05-ttrpg-extensions.md:9`, `examples/print-md-user-guide/01-getting-started.md:89`, `README.md:43`, `packages/cli/src/lib/markdown/renderer.ts:109`

Chapter 5 (203 lines) and Chapter 1's example manifest both instruct authors to add `plugins: - ttrpg` for stat blocks, dice notation, `@[...]` cross-references, `::trait[...]` callouts, and CR ratings. No such plugin exists: `BUILTIN_OPTIONAL_PLUGINS` contains only markdown-it-mark/sub/sup/abbr (`renderer.ts:109-114`), the ttrpg starter template declares no plugins, and a repo-wide grep for "ttrpg" hits only a template id, a theme name, a package.json keyword, and the docs themselves. None of the documented syntax is implemented anywhere in `packages/cli/src`. The root README (line 43) links Chapter 5 as the way to "Create TTRPG/games content." Following the guide verbatim aborts the build (the loader is fail-fast) with: *"Plugin \"ttrpg\" not found. Install it in your project: `bun add ttrpg`"* — a broken flagship workflow whose remediation message tells a non-technical author to install an arbitrary, unrelated npm package (a supply-chain hazard on top of the broken onboarding).

**Fix:** delete/replace Chapter 5 and the `plugins: - ttrpg` lines in Chapter 1 and the README today; either document what actually ships or build a real bundled ttrpg plugin. This is the single most damaging doc in the repo.

---

#### H4. `validate --phase` accepts the documented values but silently runs ZERO checks and exits green

`severity: high` · `effort: small` · `category: error-handling / false-green` · **Confirmed** (statically and by execution)

Files: `packages/cli/src/lib/validation-exec.ts:127`, `packages/cli/src/checks/registry.ts:25`, `packages/cli/README.md:148`, `packages/cli/src/commands/validate.ts:41`

The README documents `--phase pre | post | all (default: all)`. The code accepts only `pre-build`/`post-build`: `validation-exec.ts:127-129` casts `args.phase as CheckPhase` with no validation and `registry.ts:25-27` filters with strict equality — so every value the README documents matches no checks. Empirically verified in `examples/with-validation`: `--phase pre-build` emits 9 warnings, while `--phase post` and `--phase all` print "VALIDATION PASSED", exit 0, and `--format json` shows `total: 0`. The codebase explicitly guards against this exact silent-green failure for `--only`/`--skip` selectors (`registry.ts:45-54` surfaces unmatched selectors as errors) — `--phase` got no such guard. A CI pipeline using the documented flag gets a guaranteed false pass on an unvalidated PDF, and the docs actively steer users into the broken values.

**Fix:** validate `--phase` in `validation-exec.ts` (throw `UsageError`, or accept the friendlier `pre`/`post`/`all` aliases and map them), fix the README table, and mirror the unmatched-selector treatment: a phase yielding zero checks must be an error, not a pass.

---

#### H5. `+page.svelte` is a 3,829-line god file owning startup, open/close lifecycle, export, problems, recovery, and shortcuts — despite nine extracted controllers proving the pattern

`severity: high` · `effort: large` · `category: god-file` · **Confirmed** (flagged independently by three reviewers)

Files: `packages/viewer/src/routes/+page.svelte:352`, `:1191`, `:1507`, `:1827`, `:1019-1075`, `:2269`

The main route component (exactly 3,829 lines) mixes at least eight concerns. The evidence is precise and verified:

- **Startup/landing:** 7 `$state` + 7 `$derived` landing variables at lines 352-426; a ~90-line startup `onMount` (1191-1278) with three exit paths each responsible for calling `revealWindow()` — duplicated at exactly lines 1224, 1237, 1264, 1273 — or the window never appears. `startup-landing.ts` exists to hold this policy but contains only ~95 lines of pure predicates while the stateful machine stayed in the page.
- **Open lifecycle:** `startFolderPreview` spans 1507-1696 with a hand-rolled `folderOpenEpoch`/`superseded()` guard repeated after every await (1548, 1576, 1585, 1600, 1626, 1635, 1670). `setUpAsBook` (255-290) separately manages the same epoch/busy/busyLabel state.
- **Divergent hand-rolled workspace resets:** `stopPreview` (1802-1822), `openUrl` (1744-1768), and the `startFolderPreview` catch (1671-1686) each hand-list a *different* subset of the same 30+ `$state` fields — `openUrl` misses `recoveryScanDir`/`recoveryItems`; the catch misses `problems`/pageNav. This divergence is exactly how the Cancel-closes-project defect (M2 below) slipped in.
- **Un-extracted features:** `savePdf` (1827), `exportHtml` (1905), `cancelExport` (1938), and the whole crash-recovery block (`scanForRecovery`/`restoreRecovery`/`discardRecovery`, 1019-1075) remain inline even though `ExportController` and `recovery-ui-controller.svelte.ts` already exist and their headers say "used to live inline in +page.svelte." Two separate global keydown handlers (onMounts at 1399 and 1465) both route to `savePdf`.

The repo's ALERT-level mandate says all changes must reduce complexity; this file is where that mandate goes to die.

**Fix:** continue the established `.svelte.ts` controller extraction in slices: (1) `ProjectLifecycleController` owning open/close/supersede and ONE workspace-reset function; (2) move `savePdf`/`exportHtml`/`cancelExport` into the existing `ExportController`; (3) `StartupController` for the landing/reveal sequence (killing the four `revealWindow` call sites); (4) `CrashRecoveryController` mirroring `RecoveryUiController`. The page keeps only template bindings.

---

### Medium severity — confirmed

---

#### M1. Ten dialogs hand-roll the modal scaffolding a shared `dialogBehavior` action already owns; behavior has diverged and ~500+ lines of shell CSS are copy-pasted

`severity: medium` · `effort: medium` · `category: duplication / a11y` · **Confirmed** (flagged independently by three reviewers)

Files: `packages/viewer/src/lib/dialog.ts:4`, `packages/viewer/src/lib/components/NewProjectWizard.svelte:184`, `AdvancedSetupDialog.svelte:265,491`, `GitHubDialog.svelte:534`, `ConflictChoicesDialog.svelte:428`, `RecoveryConfirmDialog.svelte:146`, `RecoveryGuidanceDialog.svelte:198`

`$lib/dialog.ts` documents `dialogBehavior` as owning "the a11y contract every dialog shell in the app used to re-implement by hand" — ARIA wiring, Escape (with `stopPropagation`), trapFocus, initial focus, `triggerEl` restore. Only 4 of 10 dialogs use it (SettingsDialog, HelpDialog, SnippetPicker, OperationLogDialog). The other six — NewProjectWizard, AdvancedSetupDialog, GitHubDialog, ConflictChoicesDialog, RecoveryConfirmDialog, RecoveryGuidanceDialog — each hand-roll `role`/`aria-modal`/trapFocus plus a `<svelte:window onkeydown>` Escape handler *without* `stopPropagation` (so Escape leaks to page-level handlers, and stacked dialogs would both close), and each carries a near-verbatim copy of the same `.backdrop`/`.dialog`/`.dialog-header`/`.close`/`.sr-only`/`.actions`/`.primary`/`.ghost` CSS block (~100–150 lines apiece; compare `ConflictChoicesDialog.svelte:428-501` vs `RecoveryGuidanceDialog.svelte:198-278` vs `GitHubDialog.svelte:534-602`).

The drift is already observable: NewProjectWizard guards Escape with `!creating` (line 297-301) while its backdrop click (line 185) and X button (line 198) close unguarded mid-create; AdvancedSetupDialog closes on Escape with no guard even mid-connect (491-495); only GitHubDialog implements a `closeBlocked` guard; the WCAG 2.5.8 target-size comment exists only in GitHubDialog (:577); ConflictChoicesDialog's `.ghost` lacks the `:focus-visible` rule its siblings have. For a writer, identical-looking dialogs respond differently to the same gestures.

**Fix:** migrate the six legacy dialogs onto `dialogBehavior` (per-dialog close guards map to its `onClose`/`initialFocus` options — a migration, not mechanical deletion) and extract the shared shell CSS into one stylesheet or a `DialogShell` component. Note the 4 already-migrated dialogs also still carry their own shell CSS, so the CSS extraction has no established home yet.

---

#### M2. "Cancel" on the render overlay silently closes the entire project — and is offered during every routine auto-save rebuild

`severity: medium` · `effort: medium` · `category: destructive-action` · **Confirmed**

Files: `packages/viewer/src/routes/+page.svelte:2238`, `:1796`, `:2827`

`LoadingOverlay` gets `onCancel={rendering ? handleCancelRender : undefined}` (2827-2831), and `rendering` is set true on *every* watcher-triggered rebuild — i.e., every debounced auto-save while the writer types. `handleCancelRender` (2238-2246) does not cancel anything (its own comment admits the render "simply continues invisibly and finishes harmlessly"); it calls `stopPreview()` (1796-1825), which nulls `currentDir`/`previewUrl`, closes the editor, resets the buffer, clears problems, and returns the author to the start screen. A writer who clicks Cancel to dismiss the scrim loses their whole workspace with no confirmation. Mitigations that keep this at medium rather than high: `stopPreview` flushes the editor buffer before teardown (line 1799), so no authored content is lost; recovery is one click; and the overlay is translucent/pane-scoped, so writing is never actually blocked. Still: a misleading destructive affordance with constant exposure.

**Fix:** make Cancel merely hide the overlay (or reload the iframe to abort layout) while keeping `currentDir`/editor/buffer intact; only offer real Cancel on the initial open, before a project session exists. Never route a scrim-dismiss through full project teardown.

---

#### M3. "Your book is ready — N pages" success toast fires on every rebuild — toast spam during the entire writing session

`severity: medium` · `effort: small` · `category: toast-noise` · **Confirmed**

Files: `packages/viewer/src/lib/routes/preview-event-controller.ts:187`, `packages/viewer/src/routes/+page.svelte:1109`, `:1322`

`onRenderingComplete` unconditionally calls `d.toastSuccess(...)` with no first-render or user-triggered gate; the code's own comments (`+page.svelte:1109-1111`) state `renderingComplete` fires "for the initial render AND every watcher-triggered re-render." The auto-save chain is real and verified: 500ms default debounce (`buffer-state.svelte.ts:33`) → disk write → file-watcher re-render → toast. `Toast.svelte` has no dedup (show() appends per call, lines 61-66; 3s success duration, line 48), so back-to-back rebuilds keep a stack of "Your book is ready — 287 pages" toasts nearly permanently on screen. Continuous success notifications train writers to ignore all toasts — including the error toasts that matter.

**Fix:** gate the toast to the first render of a project session (or explicitly user-triggered renders); communicate subsequent rebuilds via the toolbar page count / overlay fade / status bar — ambient state belongs in ambient chrome, not toasts.

---

#### M4. Sync-conflict PDF export failure discards the host's plain-language explanation and shows "check System tools" instead

`severity: medium` · `effort: small` · `category: error-handling` · **Confirmed**

Files: `packages/viewer/src/lib/errors.ts:42`, `packages/viewer/electron/export/controller.ts:143,183`, `packages/viewer/src/routes/+page.svelte:1892`

The export pipeline hard-blocks PDF export on an unresolved sync conflict and throws `code: 'SYNC_CONFLICT'` with a deliberately author-friendly message ("Changes happened in two places. Resolve the conflict first, then save the PDF."). The renderer routes every export rejection through `friendlyPdfError()` (`errors.ts:42-67`), which has branches only for EXPORT_CANCELED / BUILD_ERROR / TOOL_MISSING plus chrome/ENOENT/permission regexes — SYNC_CONFLICT matches nothing (and the `code` property doesn't even survive `ipcRenderer.invoke` serialization), so the writer gets the generic fallback: "PDF export failed. Open Help (?) → System tools to check for issues." A writer with a sync conflict is sent to a diagnostics page that has nothing to do with their problem. Mitigating: the conflict is simultaneously surfaced correctly via the sync pill/ConflictChoicesDialog, so the wrong toast sits next to a right signal.

**Fix:** add a SYNC_CONFLICT branch (match on the message text since the code doesn't survive IPC, or re-hydrate codes across the bridge) that passes the host message through — ideally with a "Resolve conflict" toast action opening the conflict dialog. Generally: `friendlyPdfError` should pass through errors already marked author-friendly rather than overwriting them.

---

#### M5. Lint-runner failure is displayed as "No problems found — your project looks good!"

`severity: medium` · `effort: small` · `category: error-handling / false-green` · **Confirmed**

Files: `packages/viewer/src/routes/+page.svelte:1127`, `packages/viewer/src/lib/components/ProblemsPanel.svelte:113`

`refreshProblems()` swallows any lint API failure — `.catch(() => { if (currentDir === dir) problems = []; })` with the comment "show a clean panel" — and `ProblemsPanel` renders an empty list as a green check plus "No problems found — your project looks good!" If the validation pipeline itself breaks (503 hooks-not-registered, `executeValidation` throw), the writer gets an affirmative all-clear. The `finally` at 1131-1133 also clears `problemsLoading` without the `currentDir === dir` guard the other branches use, so a stale in-flight lint can cancel the new project's loading indicator. Scope is bounded (per-check crashes are already surfaced as error rows by `runChecks`, and the build path runs its own fail-fast validation), but for a tool whose purpose is catching print problems before an expensive print run, a false green is worse than no state.

**Fix:** add a distinct `problemsError` state rendered as a neutral "We couldn't check your project this time" row; guard the `finally` with the same dir check.

---

#### M6. Re-applying a built-in theme silently overwrites the author's customized project theme

`severity: medium` · `effort: medium` · `category: data-loss` · **Confirmed**

Files: `packages/viewer/src/lib/components/config/AppearanceSection.svelte:39,54`, `packages/cli/src/lib/theme-manager.ts:300`

Applying a built-in theme copies it into `themes/<id>/` via `fs.cp(..., {recursive: true})` (`theme-manager.ts:302-307`), which silently overwrites `theme.css` — the exact file every Design-panel token edit writes into (verified: `setActiveThemeStyle` wires `themes/<id>/theme.css` as the active style and `DesignSectionController` writes token updates to it). The Appearance grid renders BOTH the built-in card and the project copy for the same theme with no dedupe (`AppearanceSection.svelte:54-59`), and `isActiveTheme` requires `kind === "project"` (line 43), so the built-in twin of the ACTIVE theme still shows a primary "Apply" button (line 104). Clicking it re-runs the `cp` and clobbers every customization with no warning. Partial mitigation: default-on auto-snapshots make customizations older than the ~10-minute quiet window recoverable via git — but not via any in-app UI (see H2), and not at all for no-git projects. Two visually identical "Clean Book" cards also confuse exactly the audience this panel targets.

**Fix:** dedupe the grid (hide the built-in card when a project copy exists, or badge it "original"), and make re-apply non-destructive: an explicit "This will discard your customizations" confirm, or copy to a fresh id via the existing `uniqueThemeId` helper (`theme-manager.ts:323`).

---

#### M7. Theme "Remove" is a single-click `rm -rf` with no confirmation and no in-app undo

`severity: medium` · `effort: small` · `category: data-loss` · **Confirmed**

Files: `packages/viewer/src/lib/components/ProjectConfigPanel.svelte:288`, `AppearanceSection.svelte:101,106-108`, `packages/cli/src/lib/theme-manager.ts:495`

The Remove control — a 13px icon-only trash button on inactive project themes, a labeled button on the active one — goes straight through `api.theme.remove` to `rm(dir, {recursive: true, force: true})` (`theme-manager.ts:498-501`) with no confirm step at any layer. Because Design customizations live in that folder's `theme.css`, one misclick deletes hours of fine-tuning. The theme-manager's "no-data-loss mandate" comment covers only path traversal, not the user's own click. Other destructive flows in the same app have dedicated confirm dialogs (`RecoveryConfirmDialog`), so this is also an internal inconsistency. Auto-snapshot git history softens this to medium on default projects — but the restore UI doesn't exist (H2), and plain local-folder projects get no recovery at all.

**Fix:** add a confirmation naming the theme and warning that customizations will be deleted (reuse the existing confirm-dialog pattern); ideally route deletion through the snapshot/VCS layer instead of a hard `rm`.

---

#### M8. Undo history and scroll position are destroyed on every file switch — and the component documents the opposite design

`severity: medium` · `effort: medium` · `category: docs-drift / ergonomics` · **Confirmed**

Files: `packages/viewer/src/routes/+page.svelte:2762`, `packages/viewer/src/lib/components/MarkdownEditor.svelte:2-10`, `:259-263`

The parent wraps `MarkdownEditor` in `{#key editorFilePath}` (2762), so switching chapters destroys the EditorView (`view?.destroy()` in the onMount cleanup, line 289), discarding CodeMirror undo history, selection, and scroll. A writer who hops to another chapter and comes back cannot Ctrl+Z their earlier edits. No per-file EditorState/history cache exists anywhere in the viewer (verified by grep). The component's header comment (lines 2-10) claims the opposite architecture — "Document switching is handled by reconfiguring the existing EditorView… keeps scroll/undo behaviour sane" — while lines 259-263 admit the remount. The file documents two contradictory designs and ships the worse one. No data is lost (auto-save + snapshots), only the undo convenience — hence medium.

**Fix:** implement the documented design (one EditorView, doc swaps via dispatch, per-file `EditorState` cache so history/selection survive round-trips), or at minimum fix the header comment and restore caret/scroll on return to a recently open file.

---

#### M9. FileTree is read-only and goes stale: no create/rename/delete/reorder, no watcher subscription, permanent folder cache

`severity: medium` · `effort: large` · `category: missing-capability` · **Confirmed**

Files: `packages/viewer/src/lib/components/FileTree.svelte:86-105`, `:62-84`, `packages/viewer/src/lib/components/MediaPanel.svelte:118-138`

A writer cannot create a new chapter, rename, delete, or reorder files from inside the app — adding "Chapter 2" requires the OS file manager, in a product whose stated goal is letting non-technical writers publish books. (The read-only scope is documented/intentional per issue #38 — this half is a feature gap against product goals, not a code defect.) The staleness half *is* a defect: `loadChildren()` early-returns when `childrenByPath[dir]` exists (line 87) so re-expanding never refetches, and unlike `MediaPanel` (which subscribes to `onFolderChanged`, `MediaPanel.svelte:124`) FileTree has no watcher subscription — files arriving via git pull or an external editor never appear until the project is reopened, even though the parent runs a live folder watcher the tree ignores.

**Fix:** add the four core file operations via context menu/row actions backed by small `api.fs` routes, and subscribe the tree to the existing folder-changed push to invalidate `childrenByPath` per affected directory.

---

#### M10. Two competing, duplicated image-import implementations with inconsistent destinations and a prefix-match path bug

`severity: medium` · `effort: medium` · `category: duplication / correctness` · **Confirmed**

Files: `packages/viewer/src/lib/components/EditorToolbar.svelte:143-162`, `packages/viewer/src/lib/components/MediaPanel.svelte:178-193`

Both the toolbar's Insert Image dialog and MediaPanel's "Add images…" hand-roll project-relative path math in the renderer (separator sniffing via `includes("\\")`, trailing-slash trimming) — and disagree: the toolbar always copies to `assets/` (`EditorToolbar.svelte:150`) while MediaPanel prefers an existing `images/` dir, its comment falsely claiming it's the "same destination the editor toolbar uses" (`MediaPanel.svelte:179-188`). Authors using both flows scatter images across two folders. Worse, the toolbar's inside-project check is a raw prefix match — `!imageSrc.startsWith(projectDir.replace(/[\\/]+$/, ""))` (line 147) — so for project `/home/u/proj`, a file in sibling `/home/u/proj2/img.png` passes as "inside," skips the copy, and the else-branch emits a bare basename pointing at a nonexistent file → silently broken image in the PDF. Renderer-side path/fs logic also cuts against CLAUDE.md §8.

**Fix:** one host-side route ("import an image into this project, return its project-relative src") called by both flows; separator-aware containment check; delete the renderer path math.

---

#### M11. "Insert table…" in the narrow-width More menu opens a popup inside a `display:none` group — a dead control

`severity: medium` · `effort: small` · `category: correctness` · **Confirmed**

Files: `packages/viewer/src/lib/components/EditorToolbar.svelte:456`, `:372-401`, `:756-775`

The More overflow menu is visible only at container widths ≤519px — exactly the widths where the `@container` rules set `.insert-group { display: none; }`. The "Insert table…" item (line 456) sets `tableOpen = true`, but the sole `{#if tableOpen}` popup (line 385) is nested inside `.insert-group`; `display:none` on the ancestor hides the absolutely-positioned popup. The control does nothing at every width where it exists. The image dialog avoids this by rendering outside the toolbar as a fixed modal (line 467+), confirming the fix pattern.

**Fix:** hoist the table popup outside the hideable groups (fixed-position mini-dialog like the image dialog), or make the More item insert a default 3-column table directly. Add a container-width test covering every More-menu item.

---

#### M12. CrashRecoveryDialog is a keyboard-inaccessible modal with a blind, unconfirmed destructive Discard

`severity: medium` · `effort: medium` · `category: a11y / destructive-action` · **Confirmed**

Files: `packages/viewer/src/lib/components/CrashRecoveryDialog.svelte:40`, `:66`, `packages/viewer/src/routes/+page.svelte:2269`

Unlike 11 sibling dialogs, CrashRecoveryDialog imports only `Icon` — no trapFocus, no `dialogBehavior`, no Escape handling, no initial focus, no focus restore — and puts `role="dialog" aria-modal="true"` on the *backdrop* div (lines 40-45) rather than the dialog, so the aria-modal contract is broken (background not inert). UX-wise, the writer must choose Restore vs Discard knowing only a filename and timestamp — no way to see what the recovered text contains (the conflict dialog has a "Compare versions" disclosure for exactly this) — and Discard (line 66) immediately fires `api.recovery.clear` (`+page.svelte:1066-1071`, with a `.catch(() => {})` that swallows failures), destroying the only copy of the unsaved edits. Mitigations: Discard is a secondary button, "Decide later" exists, and the data at risk is the delta since the last debounced autosave.

**Fix:** adopt `dialogBehavior` for the shell (Escape = "Decide later"), move `role=dialog` onto the dialog element, add a recovered-vs-on-disk preview pane, and make Discard two-step or defer snapshot deletion to the next clean exit.

---

#### M13. Conflict dialog can sit forever with a silently disabled confirm button while conflict IDs load or fail

`severity: medium` · `effort: medium` · `category: missing-state` · **Confirmed**

Files: `packages/viewer/src/lib/routes/sync-controller.svelte.ts:91`, `:121`, `packages/viewer/src/lib/components/ConflictChoicesDialog.svelte:412`

Tapping the pill's "Changes in two places — tap to review" opens `ConflictChoicesDialog` immediately with null `localId`/`remoteId`, then `onPillConflict` runs an entire second network sync just to fetch them (comment at `sync-controller.svelte.ts:98-100` confirms). Until they arrive, "Use these choices" is disabled (`ConflictChoicesDialog:412` guards on `!localId || !remoteId`) with no loading indicator — the dialog's only busy text is tied to `phase === "resolving"`. If that background sync fails, the catch (121-125) deliberately swallows the error: a writer on a flaky connection makes all their per-file choices, then stares at a permanently dead primary button with zero explanation. The catch comment's fallback ("the History panel's advanced Sync surface") references UI that no longer exists (`LeftPanel.svelte:94-99`). Recovery exists but is undiscoverable — re-tapping the pill re-runs the fetch and loses the choices made.

**Fix:** add an explicit "Getting things ready…" state while IDs are pending, surface fetch failure inside the dialog with a retry — or better, carry `localId`/`remoteId` in the conflict `SyncStatus` payload so the second sync is unnecessary.

---

#### M14. `ProjectConfigPanel` is a 903-line god component whose ~150-line `:global()` CSS block is an untyped styling contract over its six children

`severity: medium` · `effort: large` · `category: god-file` · **Confirmed**

Files: `packages/viewer/src/lib/components/ProjectConfigPanel.svelte:83`, `:727`, `:782`

The composition root owns all state, all API calls, and ALL styles for six config domains. Lines 752-897 are `.config-panel :global(...)` rules — all six children (Details/Appearance/Styles/Design/Plugins/Publish) have **zero** `<style>` blocks and depend entirely on the parent's global contract, so renaming a class in a child silently un-styles it; `.config-panel :global(button)` (line 782) restyles every button in the subtree. `DesignSection` receives 16 individually splatted props all sourced from one `design` controller object that could be passed whole (lines 671-688). Only the Design domain got the controller extraction (`design-section-controller.svelte.ts`, 203 lines); the other five domains' state/loaders remain inline (lines 84-612). The `:global` pattern is deliberate and documented in-file, and nothing leaks beyond `.config-panel` — this is maintainability debt with silent-breakage risk, not a live defect.

**Fix:** finish the controller-per-section extraction the Design section started (pass each controller as one prop), move each section's CSS into its own component so Svelte scoping applies, and keep only shared primitives in one small shared layer.

---

#### M15. User guide Chapter 8 documents environment variables and manifest keys the code never reads

`severity: medium` · `effort: small` · `category: docs-drift` · **Confirmed**

Files: `examples/print-md-user-guide/08-system-setup.md:104`, `:180`, `packages/cli/src/lib/chromium.ts:6`

Chapter 8 documents `CHROME_PATH`, `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` (with advice to "let puppeteer-core download its bundled Chromium" — impossible; puppeteer-core never downloads a browser), `GS_PATH`, and a manifest `tools: {chromePath, ghostscriptPath}` block. None exist: `chromium.ts:6-7` reads only `CHROMIUM_PATH` and `PUPPETEER_EXECUTABLE_PATH`; `ghostscript.ts` spawns bare `gs`/`qpdf` with no override; grep finds no `GS_PATH`/`CHROME_PATH`/`tools.chromePath` in `packages/cli/src`. A stuck author on the most failure-prone step sets `CHROME_PATH` per the official guide and nothing changes — while the actual runtime error (`chromium.ts:104`) correctly says `CHROMIUM_PATH`, directly contradicting the guide. Docs-only, and the error message at point of failure is right — hence medium.

**Fix:** rewrite Chapter 8's tables to match `chromium.ts` (CHROMIUM_PATH / PUPPETEER_EXECUTABLE_PATH, fixed-path probe, PATH probe); delete the puppeteer-download and GS_PATH/tools-block advice, or implement the overrides if wanted.

---

#### M16. The guide's own source uses markers core cannot render, and documents removed `[!NOTE]` alerts as built-in

`severity: medium` · `effort: small` · `category: docs-drift` · **Confirmed**

Files: `examples/print-md-user-guide/09-publishing.md:46`, `examples/print-md-user-guide/06-plugins.md:135`, `docs/README.md:108`, `packages/cli/src/lib/markdown/markdown-it-paged.js:82`

`09-publishing.md:46-49` contains `@callout(tip) … @end` — `markdown-it-paged.js:82` whitelists only chapter/spread/page/section/continue/page-break/column-break/end-section, and the guide's manifest declares no plugins, so the flagship "guide built with print-md itself" prints literal `@callout(tip)` and `@end` in its own PDF. Chapter 6's Built-in Plugins table lists "DC alerts — `> [!NOTE]`" as running automatically, contradicting `renderer.ts:132-134` (alerts deliberately moved out of core into the DC plugin; the real built-ins are attrs/footnote/deflist/source-map/paged — the table also omits deflist). `docs/README.md:106-114` has a whole "Common Callouts" section for `[!note]`/`[!tip]` with no plugin caveat. (One sub-claim refuted in verification: Chapter 5's `> [!warning]` is inside a code fence and is fine.)

**Fix:** fix 09-publishing.md to supported syntax (blockquote or `@section .callout-tip`), correct Chapter 6's table, delete docs/README.md's Common Callouts section or caveat it, and point Chapter 3 at a real shippable callout recipe.

---

#### M17. Guide Chapters 3–4 document CSS classes, emitted HTML, and themes that core does not provide

`severity: medium` · `effort: medium` · `category: docs-drift` · **Confirmed**

Files: `examples/print-md-user-guide/03-visual-elements.md:100`, `04-styling-theming.md:201,240`, `packages/cli/src/lib/markdown/markdown-it-paged.js:664`, `packages/cli/src/lib/theme-manager.ts:48`

Verified fiction, item by item: (1) `.center`/`.float-left`/`.float-right`/`.full-width`/`.full-bleed` image classes exist in no core CSS, no bundled theme, and not even in the guide's own stylesheet (which uses different names, `.img-float-left`); the claim that full-bleed "automatically applies the art page template, forces a page break, and removes headers/footers" has zero backing code — no `@page art` exists. (Because markdown-it-attrs IS bundled, the classes silently attach and style nothing — the worst failure mode for a copied snippet.) (2) The promoted `img-size` plugin shorthand (`=300x400`) is not bundled; its only repo occurrence is the guide line itself. (3) Chapter 4's marker table is wrong twice: `@section` emits class `section` (line 441), not `region`; `@page-break` emits `.md-page-break` (line 534), not `.md-break`. (4) The "Scoping with chapter IDs" section claims `@page #ch-x` produces `class="chapter"` — only `@chapter` does — so the chapter's own `.chapter#ch-bestiary` example selector matches nothing. (5) `themes/classic.css` does not exist; the bundled themes are clean-book/ttrpg-supplement/zine/technical-doc, wired as `themes/<id>/theme.css` copies (`theme-manager.ts:48-53`).

**Fix:** audit Chapters 3–4 line-by-line against `markdown-it-paged.js`'s emitted classes and the real themes. Better: several of the promised utility classes (`.full-bleed`, floats) genuinely serve the non-technical-author goal — per layering rule §0, consider adding them to core CSS and making the docs true.

---

#### M18. CLI README's command reference omits four commands and documents flags/positionals that don't exist

`severity: medium` · `effort: small` · `category: docs-drift` · **Confirmed**

Files: `packages/cli/README.md:96,136,146`, `packages/cli/src/commands/lint.ts:12`, `packages/cli/src/commands/validate.ts:9`

`cli.ts:10-22` registers 9 subcommands; the README documents 5 — `new` and `publish` (both "primary author commands"), `audit`, and `preflight` are absent. `print-md lint [input-dir] [--files <glob>]` is wrong: `files` is a positional and the flag is `--manifest`; no `--files` exists. `print-md validate [input-dir]` is wrong: validate declares no positional, so the documented invocation silently ignores the directory and validates cwd defaults. The repair section omits `--force`; the preview section omits its one-shot `--format pdf|pdfx` mode and most of its flags. Docs-only (`--help` is accurate), hence medium.

**Fix:** regenerate the reference from the citty definitions (or add a doc test diffing `print-md <cmd> --help` against the README) and add the missing sections — `new` especially, as the intended onboarding path.

---

### Medium severity — not verified

These carry concrete cited evidence but were not adversarially re-checked. Treat as probable; spot-check the citation before scheduling.

#### M19. Dismissing a dialog mid-operation lets the operation finish invisibly — including opening a project the user just cancelled

`effort: small` · `category: error-handling` — `NewProjectWizard.svelte:185,136`, `AdvancedSetupDialog.svelte:157`

Backdrop/X close NewProjectWizard while `creating` is true, but `create()` keeps running: on success it unconditionally calls `close(); onCreated?.(projectDir)` (lines 147-169) — scaffolding and opening a project the user visibly dismissed; on failure the error lands on closed-dialog state and the writer gets zero feedback that a half-created folder may exist. AdvancedSetupDialog similarly allows Escape/backdrop mid-connect; `connectNotice`/`connectError` land on closed state and are wiped on reopen. **Fix:** block dismissal while in flight (GitHubDialog's `closeBlocked` pattern) or make dismissal a real cancel — check `open` before applying results and surface late outcomes via toast.

#### M20. Swallowed load errors render as false empty states: "No recent projects yet" when the recents API failed; templates silently vanish from the wizard

`effort: small` · `category: error-handling` — `ProjectsListBody.svelte:102`, `NewProjectWizard.svelte:53`, `routes/api/app/discover-projects/+server.ts:23`

Three first-run loads fail silently into states that lie: `loadLists` catches all errors (`// non-fatal`) then shows "No recent projects yet. Open a folder to get started."; `loadTemplates` catches into `templates = []` and the whole "Start from a template" radiogroup is conditionally omitted — a writer whose template listing errored creates a bare default book without learning templates exist; discover-projects returns `[]` on any scan error, indistinguishable from "no projects found." **Fix:** track `lastLoadError` per surface and render "Couldn't load your books — Retry" / "Templates couldn't be loaded — Retry" instead of the empty hint.

#### M21. New-book wizard forces every writer through a native folder picker with no default save location

`effort: small` · `category: ux-friction` — `NewProjectWizard.svelte:95,261`

`canCreate` hard-requires `parentDir`, which is never prefilled (`$state<string | null>(null)`, reset to null); the very first decision a brand-new writer faces is OS filesystem navigation with the primary button dead. The host already computes sensible roots (`defaultProjectSearchRoots()`, used by discover-projects). **Fix:** default `parentDir` to the platform documents dir with "Change…" as escape hatch; persist last-used parent in viewer prefs. Create becomes one required field (the title).

#### M22. `friendlyHostError` is documented as "the single source of truth" but AdvancedSetupDialog ships an inline byte-identical copy of the regex

`effort: small` · `category: duplication` — `errors.ts:15`, `AdvancedSetupDialog.svelte:139`

`AdvancedSetupDialog` defines a private `friendly()` with the identical `/^Error invoking remote method '[^']+':\s*(Error:\s*)?/` scrub instead of importing it, so the docblock is false and future scrub changes will miss the surface where raw host errors are most likely. Related raw-`e.message` leaks bypassing the module entirely: `exportHtml` (`+page.svelte:1932` — which also silently no-ops when `build()` resolves without a `downloadUrl`), `handleForceSave` (`:2259`), `restoreRecovery` (`:1060`), `OperationLogDialog.svelte:49`. **Fix:** delete the local copy, import `friendlyHostError`, and route every caught-exception toast through it.

#### M23. Narrow-width More menu silently drops Save and Snippet — a hand-duplicated action list that has already drifted

`effort: small` · `category: duplication` — `EditorToolbar.svelte:438-461`, `:239-249`, `:414-423`

The More popover re-lists every toolbar action as a second hand-maintained set of buttons — with no Save item and no Snippet item. At ≤379px the Save button disappears entirely; at ≤519px the snippet picker is reachable only via undiscoverable Ctrl+Shift+S. **Fix:** derive both the toolbar and the More menu from one declarative action array so overflow can never drift.

#### M24. Toolbar popups carry ARIA roles (menu/listbox) whose keyboard behavior is not implemented — violating the repo's own recorded BookSwitcher review finding

`effort: small` · `category: a11y` — `EditorToolbar.svelte:335-346,439`, `BookSwitcher.svelte:40-43`

The heading popup is `role="listbox"` with hardcoded `aria-selected="false"`, the More popover is `role="menu"` — no arrow keys, no focus-into-popup, no Escape (the only `onkeydown` in the file is the image dialog's), no focus return. `BookSwitcher.svelte:40-43` explicitly documents avoiding these roles for exactly this reason (PR #92 review). **Fix:** implement APG patterns (the house pattern exists in `LeftPanel.svelte:170-196`) or drop the roles to plain disclosures; add Escape-close either way.

#### M25. Snippet delete is a one-click destructive action with no confirmation, undo, or feedback

`effort: small` · `category: destructive-action` — `SnippetPicker.svelte:151-159`, `:206-213`

`remove()` calls `api.snip.delete` immediately; the trash button sits beside the primary Insert row. One misclick permanently deletes a snippet the author may have carefully built with `{{variables}}`. **Fix:** inline confirm swap on the row, or an undo toast (the content is in memory at click time).

#### M26. The toolbar exposes none of print-md's own layout primitives beyond `@page-break`

`effort: medium` · `category: missing-capability` — `toolbar-actions.ts:237-250,276-279`, `EditorToolbar.svelte:353-424,535-541`

The `@marker` family (`@page`, `@section`, `@sidebar`, `@callout`, `@chapter`, columns) is the canonical author surface per CLAUDE.md, yet the only marker in the editor UI is `@page-break`; there is no markdown autocompletion for markers even though the CSS editor got a 38-entry curated Paged Media completion table (`css-editor.ts:146-184`) — CSS authors get more assistance than markdown authors in a markdown-first product. `toolbar-actions.ts:277` also documents `{.full-bleed}` while the image dialog's Position select omits it. **Fix:** a markdown completion source for the marker family plus an "Insert layout block" picker (Section/Sidebar/Callout/Columns).

#### M27. Keyboard shortcut can start a second concurrent PDF export; `start()` never clears `activeExportId`, cross-wiring the two exports' UIs

`effort: small` · `category: correctness` — `export-controller.svelte.ts:76`, `+page.svelte:1396,1430,1827`

Both keyboard paths call `savePdf()` with no `exporting` guard (only the toolbar button is disabled), and `start()` resets state but not `activeExportId` (only `reset()` does, line 117) — so export B's progress events are dropped by the id filter, Cancel targets export A, and A's `finally { reset() }` wipes the pill while B still runs. **Fix:** one guard in `savePdf()` covering all entry points; clear `activeExportId` in `start()`.

#### M28. Export Cancel is dead until the first progress event — and the pre-export network sync gate runs before that event, leaving an uncancelable "Preparing PDF…" stall

`effort: medium` · `category: missing-states` — `+page.svelte:2299`, `electron/export/controller.ts:128,212`

Cancel is `disabled={!exportController.activeExportId}`, but the host mints the exportId and sends `started` only AFTER a full network `syncProject()` safety gate (`controller.ts:128-201`) — on a flaky connection the author watches "Preparing PDF… 12s" with a permanently greyed Cancel and no hint a network sync is running. **Fix:** mint the session id and emit a `syncing` progress state before the gate; make the gate check `session.canceled`; label the pill "Syncing latest changes…".

#### M29. `ExportProgressEvent` is defined three times and has already drifted: the host emits a `conflict` state no renderer type admits

`effort: small` · `category: duplication` — `shared-types.ts:516`, `export-controller.svelte.ts:32`, `electron/export/controller.ts:178`

Two renderer copies of the 6-value state union (the local one justified by a PWA-cleanliness comment that doesn't apply — `shared-types.ts` is already renderer-local and type-only imports are §8-clean) plus the implicit electron shape; the host sends `state: 'conflict'`, a seventh value both unions lack, silently dropped by the handler. **Fix:** one type in `shared-types.ts`, imported by both sides, with `conflict` added so the compiler catches the next drift.

#### M30. Missing shared-asset folders — "the #1 cause of wrong fonts/styles" — reported via a 5-second auto-dismissing toast instead of the Problems panel

`effort: small` · `category: channel-misuse` — `+page.svelte:1652`, `Toast.svelte:47`

A persistent project problem (~180-char two-sentence message with a path list) is delivered through the app's most transient channel; glance away during open and the only explanation for wrong fonts is gone. The Problems panel — built for persistent findings — never hears about it. **Fix:** surface as `ProblemEntry` rows (source "Missing assets"), keep at most a short pointer toast.

#### M31. `PreviewClient` accepts postMessage from any origin and posts with targetOrigin `'*'` — while the app deliberately loads arbitrary web pages into that iframe

`effort: small` · `category: security / leaky-abstraction` — `preview-client.ts:58,102`, `+page.svelte:1735`

The message handler checks only data shape, never `e.origin`/`e.source`; `call()` posts with `'*'`. The same PreviewFrame+Client is attached in URL-preview mode, where a third-party page can spoof `pmd:event` messages to drive render state, page counts, and success toasts. **Fix:** capture the preview server's origin on attach, check `e.origin` and `e.source === this.win`, pass the concrete origin to postMessage; skip attaching the client entirely in URL mode.

#### M32. Problems panel messages lead with markdownlint rule-code jargon; unmapped check ids render raw

`effort: small` · `category: copy` — `packages/cli/src/checks/source/markdownlint.ts:102`, `problems.ts:21`, `ProblemsPanel.svelte:138`

Writers see "MD013/line-length Line length" as a problem row's headline (`message: \`${v.ruleNames.join('/')} ${v.ruleDescription}\``); `SOURCE_LABELS` covers six ids while `checks/source/` contains a seventh (`config-file.ts`), and stylelint messages are prefixed with internal rule slugs. **Fix:** demote rule codes to a tooltip, and unit-test `SOURCE_LABELS` coverage against the check registry.

#### M33. Raw npm package ids and "npm" jargon shown to writers in the configured-plugins list; friendly labels lost after "Turn on"

`effort: small` · `category: copy` — `PluginsSection.svelte:68`, `config-helpers.ts:63`, `plugin-manager.ts:85`

The recommended list gets labels right ("Highlight"), but after "Turn on" the plugin appears above as monospace `markdown-it-mark`, kind "npm" — the label is never mapped back despite being already fetched. The "Not installed" detail says "Install it in your project" with no how — meaningless to the target audience. **Fix:** look up `entry.ref` in `recommended` for the label; give the not-installed detail a copyable `npm install <name>` command and a link to the Chapter 6 guide.

#### M34. Plugin status stuck on "Checking…" forever when the validate call fails

`effort: small` · `category: error-handling` — `config-helpers.ts:58`, `ProjectConfigPanel.svelte:393`

`pluginStatus` returns "Checking…" both while validating AND when there is simply no result; if `api.plugin.validate` throws, the map stays empty and every row shows a permanent never-resolving "Checking…" beside the error banner. **Fix:** distinct "Check failed — click Re-check" status when `!pluginValidating && !v`.

#### M35. Styling is split across three developer-shaped sections (Appearance/Styles/Design); "Styles" lets a writer uncheck every stylesheet

`effort: medium` · `category: information-architecture` — `StylesSection.svelte:34`, `ProjectConfigPanel.svelte:23`, `SettingsDialog.svelte:50`

The taxonomy mirrors the API namespaces, not "how my book looks"; the Styles section is a monospace-path checkbox list with no minimum-one guard (`toggleStyleActive` can pass an empty array to `api.style.setActive`, yielding an unstyled preview with no explanation); and "Appearance" means print theme in one panel and app light/dark chrome in SettingsDialog. **Fix:** merge into one "Look & style" section (theme grid → tokens → stylesheet list behind Advanced), guard the last active stylesheet, rename one "Appearance."

#### M36. Design token editor misses the knobs writers actually need: no font control, named colors fall to raw text, single-line-only parsing

`effort: medium` · `category: rule-violation` — `style-tokens.ts:13,27`, `packages/cli/src/assets/themes/clean-book/theme.css:13`

`makeStyleToken` recognizes only hex/rgb/hsl/oklch as colors, so `--color-paper: white` gets a bare text input; every built-in theme exposes `--font-body`/`--font-display`/`--font-mono` yet fonts — the first thing a writer changes — land in "Other" as raw text; `parseStyleTokens` requires one declaration per line, silently hiding multi-line values; unitless `--leading: 1.55` gets a free-text box. **Fix:** font-family token kind with a curated print-safe dropdown, route named colors through the existing `toHex`, numeric kind for unitless numbers, declaration-based parsing, optional labels/descriptions from theme.json.

#### M37. Two overlapping log/activity surfaces with doc drift and raw git jargon shown to confused writers

`effort: medium` · `category: duplication` — `ProjectActivityView.svelte:37`, `OperationLogDialog.svelte:31`, `SyncStatusPill.svelte:33`

The same operation log is rendered by two independent components with separate fetch/error handling; `SyncStatusPill`'s doc comment names the wrong destination (says OperationLogDialog, actually ProjectActivityView); ProjectActivityView shows raw `e.message`, its `loadOlder` is an unguarded promise rejection, and it dumps the raw git/sync log `<pre>` as first-class content — the "no git jargon" discipline ends at the surface a confused writer is most likely to open. **Fix:** one log surface, `loadOlder` error handling, raw log behind a "Technical details" disclosure, fix the comment.

#### M38. "Recovery" names two unrelated subsystems; three similarly-named safety artifacts confuse writers and maintainers

`effort: medium` · `category: naming` — `electron/recovery.ts:2`, `electron/recovery-bridge.ts:2`, `routes/api/recovery/list/+server.ts:1`, `CrashRecoveryDialog.svelte:53`

Crash-recovery sidecar snapshots (`recovery.ts`, `/api/recovery/*`, CrashRecoveryDialog) vs git-repair recovery (`recovery-bridge.ts`, RecoveryOverlay/Confirm/Guidance) share the word "recovery" with disjoint machinery; writers face "recovery snapshot" (restorable), version "snapshot" (listed, not restorable — H2), and repair "backup" zip (file-manager only). **Fix:** rename the crash subsystem (draft-recovery / unsaved-drafts), reserve "recovery" for sync repair, and cap writer-facing vocabulary at two concepts ("unsaved changes", "backup").

#### M39. Auto-snapshot failures silently swallowed while the UI asserts the safety net is working

`effort: medium` · `category: error-handling` — `electron/auto-snapshot/scheduler.ts:146`, `SyncStatusPill.svelte:103`, `ConflictChoicesDialog.svelte:276`

`AutoSnapshotScheduler.run`'s catch logs to `console.error` and returns — a persistent failure (stale index.lock, permissions) never reaches the renderer on any channel — while the pill shows "Version history on" unconditionally for local projects and the conflict dialog asserts "A snapshot of your work was saved automatically." The safety net can be broken indefinitely with zero signal. **Fix:** `onSnapshotFailed` dep that after N consecutive failures surfaces "Version history needs attention" routing into the existing RecoveryGuidanceDialog path.

#### M40. SyncStatusPill's aria-live branch is dead in production, and `error` masquerades as "Offline"

`effort: small` · `category: a11y / copy` — `SyncStatusPill.svelte:180,111`, `StatusBar.svelte:192`

`interactive` is true whenever `onDetails` is passed — and the only real mount always passes it — so the `role="status" aria-live="polite"` branch (206-224) never renders; screen-reader users never hear the sync transitions it was built to announce. Separately, the `error` state renders "Offline — changes are saved on this computer" even for non-connectivity failures, telling a writer on a working network they're offline. **Fix:** delete the dead branch, add a persistent visually-hidden live region beside the button, give `error` honest copy ("Sync paused — changes are saved on this computer").

#### M41. Publish panel leaks raw errors and lets writers hit Publish while "Not connected"

`effort: small` · `category: error-handling` — `ProjectConfigPanel.svelte:480`, `PublishSection.svelte:181,161`

All seven publish handlers assign raw `e.message` to `publishError` and `PublishSection` renders `result.error` verbatim — butler/SWA/HTTP errors unfiltered; the Publish and Check-readiness buttons are disabled only while busy, so a card labeled "Not connected" still offers an enabled Publish (trust-by-failure); nothing tells the writer a dry run changes nothing. **Fix:** disable Publish with a "Connect first" hint when `credentialRequired && !connected`; `friendlyPublishError` mapper with raw text behind "Show log"; one sentence explaining Check readiness.

#### M42. Onboarding docs never mention `print-md new` — authors are told to hand-write manifest.yaml

`effort: small` · `category: docs-drift` — `examples/print-md-user-guide/01-getting-started.md:59`, `README.md:19`, `packages/cli/src/commands/new.ts:14`

The repo built a polished scaffolder (4 templates, starter themes, git snapshots, next-step hints) precisely so writers never face a blank manifest — yet Chapter 1 walks new authors through hand-authoring page geometry in points, and grep for `print-md new` across the onboarding docs returns zero hits. **Fix:** make `print-md new "My Book"` the first command in Chapter 1 and the README quick start; demote manual manifest authoring to reference.

#### M43. Preview default port documented as 3000; actual default is 3579

`effort: small` · `category: docs-drift` — `01-getting-started.md:35`, `04-styling-theming.md:259`, `packages/cli/src/constants.ts:10`

`NETWORK.DEFAULT_PORT` is 3579 (the CLI README has it right); both guide chapters say localhost:3000 — connection refused for anyone typing the documented URL. **Fix:** correct to 3579, or phrase as "the URL printed in the terminal" so it can't drift again.

#### M44. Chapter 2 presents the guide project's private stylesheet behavior as core behavior; `@chapter`/`@continue` are undocumented

`effort: medium` · `category: docs-drift` — `02-writing-content.md:25,89`, `markdown-it-paged.js:664`, `examples/print-md-user-guide/styles/guide.css:75`

"H1 automatically starts a new page," running headers, smart table breaking, and row shading are all the guide's own `guide.css`, not core (`PAGED_CSS` ships only break rules) — a new project won't behave as Chapter 2 promises. Meanwhile the flagship `@chapter` marker (data-chapter-label, chapter-opener injection) and `@continue` are absent from the entire guide. **Fix:** split "what markers do" (core) from "what your theme does," and add `@chapter`/`@continue` with a worked chapter-opener example.

#### M45. Chapter 7 documents a `validate.thresholds` manifest key that nothing reads

`effort: small` · `category: docs-drift` — `07-validation.md:135`, `packages/cli/src/schema/manifest.types.ts:89`

`validate: thresholds:` exists nowhere in code or schema; the real ink knob is top-level `ink.maxTac` — and because unknown manifest keys are never warned about, the ignored YAML gives zero feedback. **Fix:** correct the example; consider warning on unknown top-level manifest keys generally.

#### M46. Inconsistent input conventions across commands: validate/preflight silently drop positionals, audit hand-rolls them

`effort: small` · `category: consistency` — `validate.ts:14`, `audit.ts:15`, `lint.ts:12`

build/preview/lint/repair/publish/new take a positional project dir; validate/preflight require flags and silently ignore positionals (so `print-md validate ./my-book` validates cwd — potentially green-lighting the wrong project); audit bypasses citty entirely with `(args as { _: unknown[] })._`. **Fix:** uniform optional positional-directory convention; reject unexpected extras with `UsageError`.

#### M47. Inconsistent exit codes: lint exits 2 for findings, validate/audit exit 1, and 2 doubles as the usage-error code

`effort: small` · `category: error-handling` — `lint.ts:37`, `validate.ts:69`, `cli-args.ts:15`, `build-error.ts:13`

CI cannot distinguish "you typo'd a flag" from "your CSS has findings" from "the build pipeline failed" — `lint` exits 2 on findings, `BuildError` defaults to 2 (same as `UsageError`), and `new` invents an undocumented 3. **Fix:** document one contract (0 clean / 1 findings / 2 usage / 3+ specific), change lint's finding exit to 1, distinct `BuildError` default.

#### M48. Unknown `preset:` values silently fall back to the DTRPG vendor preset

`effort: small` · `category: error-handling` — `manifest.ts:115`, `presets.ts:86`

`PRESETS[presetName] ?? DTRPG_PRESET` — a typo'd `preset: a4` silently becomes 621×810pt DriveThruRPG geometry with TAC 240 and PDF/X x1a, zero feedback; `PRESETS` contains exactly one entry while the README implies a catalog. `parseProfile` correctly throws for the analogous input. **Fix:** error/warn on unknown presets; add a neutral `book` default so generic projects don't inherit TTRPG trim.

#### M49. Root README tells desktop users they need a Chromium browser for Save PDF — the viewer stopped needing one

`effort: small` · `category: docs-drift` — `README.md:17`, `packages/viewer/electron/pdf-export.ts:6`

The very first paragraph a non-technical user reads sends them to install Chrome; the viewer exports via Electron's own `webContents.printToPDF` (per ADR 0002 — `pdf-export.ts:6` explicitly documents replacing the external Chromium). The requirement is real only for the CLI. **Fix:** reword; confine the Chromium requirement to the CLI section and Chapter 8.

---

### Low severity

#### L1. "Electron bridge unavailable — run via the viewer app" developer-jargon toast, copy-pasted 4× and shown to end users

`effort: small` · Not verified — `+page.svelte:472,1533,1713,1835`. NewProjectWizard already has writer-appropriate phrasing for the same gate ("Creating a project needs the desktop app."). Hoist one constant with writer-facing copy.

#### L2. Disconnecting a Git server (deleting stored credentials) is one un-confirmed click

`effort: small` · Not verified — `AdvancedSetupDialog.svelte:195,425`. The dialog's own copy establishes token acquisition as the most painful flow in the product; Disconnect sits inline per row with no confirm/undo. Add an inline "Really disconnect?" confirm.

#### L3. Splash fallback comment promises "Generous (60s)" but the code fires at 15s

`effort: small` · Not verified — `electron/main.ts:1920-1924`. The comment's rationale (cover a large book's full render on the landing-disabled path) is the very thing 15s no longer satisfies. Reconcile value or rewrite the comment.

#### L4. Vestigial dual open mechanism on NewProjectWizard: write-only `bind:open` alongside `show()`

`effort: small` · Not verified — `+page.svelte:306,2962`, `NewProjectWizard.svelte:9`. Nothing reads `newProjectOpen`; flipping the binding would open the dialog without `show()`'s reset/template-load/focus work — a stale-state trap. Pick one protocol.

#### L5. Primary-button styling forks into the "third visual variant" the code explicitly warns against

`effort: small` · Not verified — `WelcomeLanding.svelte:480`, `NewProjectWizard.svelte:448`, `AdvancedSetupDialog.svelte:616`. Landing uses the gradient recipe (with a comment about avoiding a third variant); both dialogs launched from it use flat `background: var(--app-focus-ring)` — a focus-ring token as a fill. Move the recipe into theme.css.

#### L6. Inline formatting toggle is non-idempotent with an empty selection — repeated Ctrl+B piles up marker debris

`effort: small` · Not verified — `toolbar-actions.ts:42-49`. The empty-selection branch never checks whether the cursor already sits between markers; Bold twice yields `*****|***`-style debris. Check-and-delete the existing pair.

#### L7. MediaPanel detail view has no race guard — rapid tile clicks can display the wrong image's DPI/print warnings

`effort: small` · Not verified — `MediaPanel.svelte:140-151`. `select()` has no sequence token in the same file that carefully implements `loadSeq` for the sibling flow; wrong print-readiness advice is the panel's headline feature. Guard the assignment.

#### L8. LeftPanel ships three no-op exported methods, still called from `+page` after every sync, plus contradictory dead tab-label CSS

`effort: small` · Not verified (two reviewers) — `LeftPanel.svelte:89-120,498-512`, `+page.svelte:519-521`. `notifyOpened`/`notifyHistoryRefresh`/`resetHistoryState` are empty bodies dutifully invoked by callers whose comments reference the removed History tab; a full `.tab-label` typography ruleset (with judge-gate comments) is immediately followed by an unconditional `display: none`, plus a redundant container query. Delete the seams and decide labels-on/off once — wiring the sync-completion refresh to `ProjectActivityView` instead also serves H2.

#### L9. Problems panel disappears entirely below 820px with no indicator that findings exist

`effort: small` · Not verified — `StatusBar.svelte:154,364`. `showProblems` is gated on `!isCompact` and the toolbar toggle was removed, so a small-laptop writer has no access to validation problems and no hint the feature exists. Keep a count badge that opens the panel as an overlay.

#### L10. Doctor route filters lib diagnostics by matching the display string `'chrome / chromium / msedge'`

`effort: small` · Not verified — `routes/api/doctor/+server.ts:34`, `packages/cli/src/lib/diagnostics.ts:164`. Rewording the human-readable label would silently make Help → System tools tell desktop users to install Chrome. Filter on a stable machine id.

#### L11. GitHubDialog doesn't scrub the Electron IPC prefix from its errors

`effort: small` · Downgraded from the refuted "raw exception text" claim (see appendix) — `GitHubDialog.svelte:130,262`. Host-side sanitization means only the `Error invoking remote method 'remote:cloneRepository': ` prefix survives on the two IPC-bridged paths; wrap the catches in `friendlyHostError` like `ConflictChoicesDialog:201` does.

#### L12. Two independent, already-divergent binary-file lists between the conflict dialog and the host

`effort: small` · Not verified — `ConflictChoicesDialog.svelte:117`, `electron/recovery-bridge.ts:244`. The host set has .zip/.docx/.mp4 etc. which the dialog regex lacks (and vice versa for .ico/.bmp/.tiff); a conflicted .docx shows a "Compare versions" button that expands to "No preview." Make the host the single authority (carry `isBinary` per file in the payload).

#### L13. Code written to satisfy test greps and no-op transforms left in shipped components

`effort: small` · Not verified — `RecoveryOverlay.svelte:154` (a duplicate CSS rule existing only so "test 8.5" can grep for the string "pane"), `ConflictChoicesDialog.svelte:101` (`.replace(/^\d+\s*/, (m) => m)` — replacing a match with itself). Delete the no-op; change the test to assert behavior.

#### L14. `CONTRIBUTING.md` contradicts the license and describes a test layout and error classes that don't exist

`effort: small` · Not verified — `CONTRIBUTING.md:457,191,168`, `LICENSE:1`. Says contributions are CC-BY-4.0 while linking the MPL-2.0 LICENSE (a legal ambiguity, not cosmetics); describes `tests/{integration,unit}/` when the layout is colocated `src/**/*.test.ts` + `tests/{compat,integration}`; mandates a `ConfigError` class with zero grep hits; `docs/README.md` claims non-listed docs files "are redirects" while the directory holds internal review artifacts. Fix the license line first.

#### L15. Plugins empty-state copy points the wrong direction ("pick a feature above" — the list is below)

`effort: small` · Not verified — `PluginsSection.svelte:61,91`. Survives from an earlier layout. Fix the copy, or better, move the friendly "Markdown features" list above the raw configured list.

---

## 3. Recommended refactor roadmap

Ordered for maximum risk-reduction per unit effort. Each phase is independently shippable.

### Phase 0 — Stop the bleeding (all small, ~days)

1. **H1** — one-line fix: `onAutoReloaded` calls `editorRef?.updateContent(buffer.content)`. Silent data loss; do this first.
2. **H4** — validate `--phase` values; error on zero-check phases. Fix the README row in the same PR.
3. **H3** — delete the `plugins: - ttrpg` instructions from Chapter 1, Chapter 5, and the README *today*; rewriting Chapter 5 can follow.
4. **M4** — SYNC_CONFLICT branch in `friendlyPdfError`.
5. **M3** — gate the success toast to first render.
6. **M5** — `problemsError` state + dir-guarded `finally`.
7. **M7 / M25 / L2** — add confirms to theme Remove, snippet delete, and server Disconnect (one shared inline-confirm pattern).
8. **Docs sweep** — M15, M16, M18, M42, M43, M45, M49, L14: all small, all text-only, and collectively they defuse the "docs as trap" theme. Add a doc test diffing `--help` output against the CLI README to prevent recurrence.
9. **Error-copy sweep** — M22 (delete the inline `friendly()` copy, route the raw-`e.message` call sites through `friendlyHostError`), L11 (GitHubDialog), M41 (publish), L1 (Electron-bridge toast constant).

### Phase 1 — High-value small/medium features (~1–2 weeks)

10. **M2** — Cancel hides the overlay instead of tearing down the project.
11. **H2** — Restore button in `ProjectActivityView` (the host pipeline already exists; this closes the safety loop and also resolves the L8 sync-refresh wiring).
12. **M6** — dedupe the theme grid + confirm-or-copy on re-apply.
13. **M11** — hoist the table popup; **M23** — single declarative action array for toolbar + More menu (fixes the drop of Save/Snippet in the same change).
14. **M20 / M21** — false empty states + default save location: the two highest-leverage first-run fixes.
15. **M13** — conflict-dialog pending/failed states (or carry IDs in the conflict payload).
16. **M27 / M28 / M29** — export FSM hardening: savePdf guard, pre-gate `syncing` state, single `ExportProgressEvent` type with `conflict`.
17. **M30 / M32 / M34** — Problems-panel channel and copy fixes.

### Phase 2 — Structural consolidation (~weeks, slice by slice)

18. **M1** — migrate the six legacy dialogs onto `dialogBehavior`; extract `DialogShell` + shared CSS. Do **M12** (CrashRecoveryDialog) first as the pilot since it has the worst gap. M19's mid-operation dismissal guards become one explicit prop of the shared shell.
19. **H5** — decompose `+page.svelte` in the order: `ProjectLifecycleController` (single workspace-reset — retires the bug class behind M2), export handlers into `ExportController`, `StartupController`, `CrashRecoveryController`.
20. **M10** — host-side image-import route consumed by both flows.
21. **M14** — finish the config-panel controller-per-section extraction; move section CSS into components.
22. **M8** — per-file EditorState cache so undo/scroll survive chapter switches.

### Phase 3 — Product-level gaps (schedule as features)

23. **M9** — FileTree create/rename/delete/reorder + watcher subscription.
24. **M26** — marker autocompletion + "Insert layout block" picker (directly serves the repo's primary goals).
25. **M35 / M36** — config IA merge ("Look & style") and design-token editor upgrades (fonts, named colors).
26. **M38** — recovery-subsystem renaming; **M37** — single log surface.
27. **M17 follow-through** — decide whether `.full-bleed`/float utilities go into core CSS (layering rule §0 favors it) and make Chapters 3–4 true either way.

---

## 4. Per-area assessment

| Area | Verdict | Findings (post-verification) |
|---|---|---|
| First-run, onboarding & project lifecycle | Unusually careful micro-level craft (copy, aria-live, watchdogs) on structurally weak foundations: the startup/open/adopt state machine lives in the 3.8k-line page and ten dialogs hand-roll divergent modal scaffolding. Headline moved-folder misclassification claim **refuted** — the shipped path handles it correctly. | 11 (1 refuted) |
| Core writing/editing workflow | The `EditorBuffer` engine is genuinely well-engineered, but the surrounding UX has real holes: stale-screen auto-reload with silent overwrite (worst confirmed defect in the review), a read-only stale file tree, undo destroyed on file switch against the component's own docs, and a dead "Insert table…" control. | 12 |
| Preview, build/export, validation & notifications | Real craftsmanship in the pieces (friendly mappers, export FSM, plain-language Problems panel); quality falls apart at the seams — Cancel closes the project, success-toast spam, lint failure rendered as all-clear, and the host's good conflict message destroyed by the renderer's mapper. | 14 |
| Project config, settings, theming & plugins | Thoughtfully consolidated with a strong recommended-plugins flow, but theming has one-click overwrite/delete paths for the writer's customizations, npm-speak leaks into the configured list, and the 903-line panel + `:global()` CSS contract is the main cleanup target. Headline discard-on-Close claim **refuted** (dead code path); only cosmetic save-semantics drift survives. | 12 (1 refuted) |
| Sync/publish, conflicts, crash recovery | The conflict copy and sync-status discipline are genuinely writer-appropriate, but the safety story is half-built: restore is promised everywhere and reachable nowhere, the scariest dialog is the least accessible, and auto-snapshot failures are invisible. GitHubDialog raw-error claim **refuted** (host-side sanitization missed); only an IPC-prefix polish gap survives. | 13 (1 refuted) |
| CLI & author documentation | The CLI code is small and mostly clean (good preflight, actionable Chromium errors); the author-facing documentation has drifted badly enough to be an active trap — a nonexistent flagship plugin, fictional env vars/classes/ports/keys, and a documented validate invocation that silently passes everything. | 15 |

**Total: 77 findings retained (23 adversarially confirmed), 3 claims refuted.**

---

## Appendix — Claims investigated and rejected

These reviewer claims were adversarially verified against the code and did **not** hold up. They are excluded from the findings above.

1. **"Missing/moved project folder gets misleading 'not a print-md project' copy AND a doomed 'Set up this folder as a book' CTA"** (onboarding, originally high). Refuted on the claimed mechanism: the moved-folder error on this path is `Preview server failed to start: Input path not found: <path>` (from `validateInputPath`, `lifecycle.ts:124-128`), which matches `friendlyFolderError`'s *second* branch and yields the correct "folder couldn't be read" copy; the adopt CTA regex doesn't match it, so the button is gated off and the correct "Pick a book below, or open it from its new location" hint renders. The headline startup scenario is separately mitigated — the viewer-prefs route nulls a nonexistent last-project dir before the renderer sees it, and recents/favorites carry `exists` flags. What survives is low-severity hygiene: string-matching instead of structured error codes, and the vestigial `print-md\.yaml` alternative in two regexes.

2. **"Close silently discards unsaved Details and Publish drafts"** (config/theming, originally high). Refuted: the Close button never renders — `onClose` is an optional prop and the panel's only render site (`LeftPanel.svelte:388`) doesn't pass it; the config tab is toggled via CSS with the component kept mounted, so drafts survive tab switches; and `flushPublishDraft` is deliberately invoked by Save/Connect/Publish, persisting typed Publish settings at exactly the moments they matter. Only the cosmetic per-section save-semantics drift survives (Details explicit-save vs Design auto-save vs instant-apply, inconsistent toasts) — a low-severity polish item folded into the roadmap's config work rather than listed as a defect.

3. **"GitHubDialog shows raw exception/IPC text to writers"** (sync/recovery, originally high). Refuted: two host-side sanitization layers were missed — `handleRemoteErrors` (`friendly-errors.ts:80-98`) allowlists author-friendly vocabulary and replaces everything else with a fixed safe string (logging the raw error host-side with credentials redacted), and the lib itself maps transport failures to author copy (`friendlyCloneError`, `github-auth.ts`). The predicted "HTTP Error: 401 Unauthorized" cannot surface. What survives is the un-scrubbed Electron IPC prefix on two paths — retained as **L11**.
