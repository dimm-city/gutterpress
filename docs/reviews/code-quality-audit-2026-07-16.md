# Code Quality & Architecture Audit — 2026-07-16

_Scope: `packages/cli` + `packages/viewer`, ~74k lines of non-test source across 453 files._
_Goal: identify rough spots fixable in a **patch release** — robustness, reliability, maintainability. Not an end-to-end refactor._

## Method

A three-phase multi-agent audit, followed by a manual validation pass:

1. **Review** — 10 parallel finder agents, one quality lens each (complexity ×3 territories,
   duplication, coupling/layering, brittleness, over-engineering/dead code, build/release
   fragility, test health, API-route consistency), each required to cite file:line evidence
   it actually read.
2. **Coverage critic** — one agent cross-checked the finders' self-reported coverage against
   the real tree and swept the gaps.
3. **Adversarial verification** — every deduplicated finding got a skeptic agent whose default
   stance was "refuted"; it had to reproduce the evidence, check for guards one layer up, and
   deflate severity.
4. **Manual validation** — every surviving finding was then re-checked by hand against the
   code, the PWA plan (`docs/pwa-webadapter-plan.md`), and the 2026-07-10 remediation
   disposition. Several verdicts were corrected or overturned (see "Corrections" below).

Raw pipeline numbers: 49 findings raised → 33 confirmed + 13 partially confirmed + 3 refuted
by adversarial verification → **manual pass merged 2 duplicate pairs, overturned 1, and
re-scored several**, yielding the validated list below. One of the 10 finders (CLI-package
complexity) failed on a structured-output error and was re-run standalone; its findings
(B5, E10, G8–G10) were manually validated in place of an adversarial pass.

## Executive summary

**The codebase is in substantially better shape than its size suggests, and dramatically
better than the 2026-07-03 review found.** Since that review (grade C+/B−): `electron/main.ts`
shrank from 3,014 → 1,768 lines, `+page.svelte` from 4,177 → 3,968 with 13 extracted
controllers (88–537 lines each, well-sized), the ~100 API routes now share one `defineRoute`
factory (validation/error envelope centralized), `api.ts` is deduplicated behind shared
`post()/get()` wrappers, fs routes have a real symlink-canonicalizing root guard, and the
`app://` proxy carries a bearer token. Multiple finder agents independently noted the code
"carries visible scars from prior audit rounds and is unusually well-hardened."

**No high-severity exploitable defect was confirmed.** The highest-impact validated issues are:

1. **Missing network timeouts** on every isomorphic-git transport call and on the publish
   command-runner/butler download — a stalled connection hangs sync/clone/push/publish
   forever (the same subsystem's REST calls all carefully use `AbortSignal.timeout`).
2. **Two settings-persistence races/bugs**: the `/api/app/settings` POST does an unserialized
   read-modify-write (lost updates), and the *live* desktop settings-merge is a third,
   divergent copy that lacks the `Array.isArray` guard the reconciled SPA copy's docstring
   claims is now universal.
3. **A cluster of dead-or-drifted seam surface** (dead HTTP flush path, orphaned routes,
   an `ElectronBridge` type promising five removed IPC methods, a preload comment describing
   a version check that doesn't exist) — cheap deletions/reconciliations that remove real
   confusion for the next reader.
4. **CI gaps**: the Electron main/preload TypeScript is never type-checked in CI (the script
   exists, nothing calls it), release binaries are smoke-tested with `--version` only, and
   the two 33k-line vendored `paged.polyfill.js` copies have no drift check.

Everything in categories A–F below is patch-release-sized. Category G is the deferred
structural list for a future minor.

## Corrections made during manual validation

Transparency about where the agent report was wrong or needed adjustment:

| Agent finding | Correction |
|---|---|
| "`Platform.openFolder()`/`saveSnapshot()` are dead seam methods" (confirmed by its verifier) | **Overturned.** `docs/pwa-webadapter-plan.md` documents both as deliberate staging (Phase 1 FSA / version-history-#13 scope), and the 2026-07-10 disposition records the maintainer decision to keep dormant PWA surface. A near-identical finding was correctly refuted on exactly these grounds. No action beyond an optional cross-reference comment. |
| Git-timeout fix as "`Promise.race` per call site" | **Corrected.** A bare `Promise.race` abandons the hung operation while it still holds the per-repo FIFO lock (`withRepoLock`), wedging every subsequent git op for that project. The right patch-scoped fix is an idle timeout inside the shared isomorphic-git HTTP client (one choke point); true cancellation is a bigger job. |
| Settings-merge array bug severity | **Downgraded high→medium.** `AppSettings` has no array-typed fields today, so normal UI flows can't trigger it; it needs a malformed POST body. Still worth fixing — the deeper defect is a third divergent merge implementation on the live path. |
| `listProjectFiles` route/wrapper "delete as dead code" | **Reframed.** The PWA plan lists `listProjectFiles` in its Phase 1 implement-list and `WebAdapter.listProjectFiles` is a live FSA implementation. Annotate as staged rather than delete blindly. Same reframe for `enable-version-history` and the unused `ProjectCapabilities` flags (staged for #13). |
| Duplicate findings | Merged: the two paged.polyfill.js findings (duplication + build lenses) and the two `listProjectFiles` findings (over-engineering + routes lenses). |
| Verifier severity downgrades | Accepted for: EditorToolbar popup triplication (→low), dual flush paths (→low), `watchFolder` arm-ordering (→design note: an `activePreview`-equality guard plus a regression test already enforce it), `ElectronBridge` ghost methods (→low), error-classification inconsistency (→low, dormant). |

The three findings refuted by adversarial verification (manual-annotation "symptom" claim in
`+page.svelte`, "unused `ProjectCapabilities` mirror", "dead adapter seam" variant) were
checked and the refutations are sound; they are excluded.

---

## A. Correctness & races — fix in this patch

**A1. Live desktop settings-merge is a third, divergent copy missing the array guard.**
`packages/viewer/electron/settings-store.ts:34` — `mergeSettingsSection` checks
`value && typeof value === "object"` with **no** `!Array.isArray(value)`, so an array-valued
section patch spreads into `{0:…,1:…}` and corrupts `app-settings.json`. The SPA's
`src/lib/settings-merge.ts:26` has the guard and its docstring claims it is "the single
reconciled implementation" — false on the path that actually runs on desktop
(`main.ts:1098` wires this copy into `prefsHooksImpl` → `/api/app/settings`).
*Fix:* delete `mergeSettings`/`mergeSettingsSection` from `settings-store.ts` and import
`deepMergeSettings` from `src/lib/settings-merge.ts` (pure, Node-safe — same import pattern
`bridge-types.ts` already uses for `shared-types.ts`). One merge implementation everywhere.

**A2. `/api/app/settings` POST loses concurrent updates.**
`packages/viewer/src/routes/api/app/settings/+server.ts:14-18` reads, merges, and writes as
two unserialized steps; `settings-store.ts`'s chain serializes only the *write*. Two quick
changes (two checkbox toggles; `settings.svelte.ts.set()` fires one fire-and-forget POST per
field change) read the same snapshot and the second write silently reverts the first patch on
next reload. `prefs-store.ts:157-169` already solved this exact race with `updatePrefs(mutate)`
inside one queue slot, with a comment warning against precisely this pattern.
*Fix:* add `updateSettings(mutate)` to `settings-store.ts` mirroring `updatePrefs`, and have
the POST route call it.

**A3. Background `webContents.send()` sites skip the `isDestroyed()` guard.**
Eight call sites (`main.ts` 397, 469, 579, 754, 875, 881, 1189, 1571) use `mainWindow?.` alone,
while line 1584 in the same file uses the full `mainWindow && !mainWindow.isDestroyed()` guard.
Electron throws "Object has been destroyed" in the window between `destroy()` and the `closed`
listener nulling `mainWindow`.
*Fix:* one `safeSend(channel, ...args)` helper; route all background senders through it.

**A4. Two independent renderer-flush implementations share one `flushResolve` slot.**
`main.ts:773-801` (close gate) and `main.ts:1577-1595` (`updater:applyNow`) each set the same
module-level `flushResolve`, send `app:flushBeforeClose`, and race their own 5s watchdog, with
no coordination. Practical worst case is a skipped final auto-snapshot on a rare double-trigger
(low), but the duplication invites worse drift.
*Fix:* extract `requestRendererFlush(timeoutMs = 5000): Promise<void>` that owns the slot;
both call sites await it.

**A5. `fs/rename` docstring promises what its TOCTOU check can't.**
`rename/+server.ts:30-32` stat-checks then renames (POSIX rename silently replaces), while the
comment at lines 10-14 unconditionally promises "Fails (409) rather than silently overwriting."
Window is tiny and inputs are project-root-constrained — low.
*Fix (minimal):* soften the docstring to document the race; optionally use `link()`+`unlink()`
for the file case (atomic EEXIST), keeping plain rename for directories.

## B. Reliability — timeouts & unbounded growth

**B1. No timeout on any isomorphic-git network operation.** *(High.)*
`transport.ts:218` (`git.fetch`), `clone.ts:223`, `sync.ts:397` (`git.push`),
`conflict-resolution.ts:337`, and the recovery modules' fetches all run with no
timeout/AbortSignal — a stalled remote hangs sync/clone/push forever, in both the CLI and the
viewer's auto-sync. The same subsystem's REST calls (`github-repos.ts:54` etc.) all use
`signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)`; the discipline exists, it just never reached
the git transport.
*Patch-scoped fix:* add an **idle timeout inside the shared HTTP client** passed to
isomorphic-git (one choke point — abort the socket if no data flows for N seconds, classified
as the existing friendly "offline" error). Do **not** `Promise.race` per call site: the
abandoned op would still hold the `withRepoLock` FIFO for that project and wedge every later
git op. Full user-facing cancellation is deferred (G-list).

**B2. Publish pipeline can hang forever.** *(Medium-high.)*
`publish/command-runner.ts:45-88` has no timer and no `kill()`; the `CommandRunner` type
(`types.ts:110-119`) has no `timeoutMs` field at all; `butler.ts:90`'s one-time butler
download `fetch` has no signal. `lib/exec.ts`'s `execCapture` already implements the exact
cleared/unref'd SIGKILL-timer pattern to copy.
*Fix:* optional `timeoutMs` on `CommandRunner` (default off, generous defaults at call sites),
`AbortSignal.timeout` on the butler download.

**B3. PDF.js document cache never evicts across paths.** *(Medium.)*
`pdf-inspect.ts:50` — module-level `docCache` invalidates only when the *same* path's
mtime/size changes; entries for paths no longer being validated (full parsed documents) live
for the life of the process. Benign in the one-shot CLI; unbounded in the long-lived viewer
host across many projects/builds. The sibling `plugins.ts` path-cache documents its
boundedness reasoning — this one can't.
*Fix:* clear + `destroy()` the cache at the end of each validation run (matches the module's
own "a single validation run parses once" contract), or a small LRU (N≈8).

**B4. Per-repo lock map grows forever.** *(Low.)*
`source-provider.ts:150,175-187` — `repoQueues` gains one permanent entry per distinct project
dir ever opened; nothing deletes. Tiny per-entry cost, but unbounded and trivially fixable.
*Fix:* identity-guarded delete when the chain tail settles (`browser-pool.ts` already models
this exact pattern).

**B5. Check registry is populated only by side-effect imports, with no explicit bootstrap.**
*(Low — latent, not live.)* `checks/registry.ts:3` is a module-level `Map` filled only by the
four bare `import "../checks/pdf/index"` … statements in `lib/validation-exec.ts:23-27`.
`runChecks`/`getChecks` never verify it's populated. This is **not currently broken**: the
package entry `src/index.ts:19` re-exports from `validation-exec.ts`, so importing anything
from `@dimm-city/print-md` evaluates that module and registers the checks. But the invariant
is implicit — a future deep-import of `checks/runner` directly, or a reordering of index
re-exports, could yield a silently empty registry. `tool-check.ts:28` already needed a comment
to explain the coupling.
*Fix (defensive, additive):* an idempotent `registerBuiltinChecks()` (boolean-guarded) called
at the top of `runChecks`/`getChecks`. No behavior change for any current caller.

## C. Hardening

**C1. `shell/open-external` accepts any URL scheme.** *(Low.)*
`open-external/+server.ts:9-11` validates only presence; `navigation-policy.ts:98,117` gates
the other two `shell.openExternal` paths on `/^https?:/i`. All current callers pass https URLs.
*Fix:* the same one-line scheme check in the route's `validate`, 400 otherwise.

## D. Dead code, doc drift, type drift

**D1. Dead HTTP flush path.** `routes/api/app/flush-done/+server.ts` + `AppHooks.resolveFlush`
(`app-hooks.ts:17`, `main.ts:873`) — `api.ts:316-320` documents the wrapper was deleted because
the real path is IPC (`app:flushDone`, `main.ts:988`). Zero live callers (verified; only ~9
test fakes mention it). *Fix:* delete route + hook member; update the test fakes.

**D2. Orphaned `fs/copy-file`.** Route + `api.fs.copyFile` (`api.ts:239-240`) superseded by
`api.media.importImage` (EditorToolbar.svelte:256, MediaPanel.svelte:196); zero call sites.
*Fix:* delete wrapper, route, and its dedicated test; update the stale pointer in the PWA plan.

**D3. `ElectronBridge` promises five removed IPC methods.** `contract.ts:634+` still declares
`openDirectory/readFile/writeFile/listDir/statFile` that `preload.ts` explicitly migrated to
server routes (its own comments say so); `electron/types.d.ts` was pruned, `contract.ts` wasn't.
Zero callers. *Fix:* delete the five members.

**D4. `apiVersion` safety check doesn't exist.** `preload.ts:141-143` claims "the renderer
checks this to refuse running against a stale shell"; nothing reads it outside adapter
plumbing tests. *Fix:* implement the minimal check (compare `getPlatform().apiVersion` once at
startup, surface an error) — or correct the comment. Either ends the false promise.

**D5. `ProjectCapabilities` doc overclaims.** `project-source.ts:91-99`'s comment says the
7 flags "drive which user-facing buttons are shown"; only `canSnapshot` is read anywhere
(~15 sites). The rest are staged for version-history #13 / the PWA plan — keep the fields,
**fix the comment** to say which are live vs staged.

**D6. `listProjectFiles` (route + `api.ts:246` wrapper) has zero desktop callers.** But the
PWA plan Phase-1 lists it and `WebAdapter.listProjectFiles` is a live FSA implementation.
*Fix:* annotate the route/wrapper as PWA-plan staging (don't delete without editing the plan).

**D7. `vcs/enable-version-history` route has no caller.** The "enable version history later"
flow (CLAUDE.md §7's escape hatch) was never wired to UI. *Fix:* annotate as staged for #13,
or wire a small StatusBar/Settings affordance when that feature lands. Not a deletion.

**D8. `shared-types.ts` dual-sourcing.** For `ProjectSource`/`ProjectCapabilities`,
`contract.ts:30-39` type-imports the lib directly while `bridge-types.ts` re-exports the
hand-mirror in `shared-types.ts:41-79` as "canonical" — two independently maintained copies of
the same shape, and the docstring's "single source of truth" claim is inaccurate.
*Fix:* add a mutual-assignability type-test (the `api.contract-dto.type-test.ts` pattern
already in the repo) covering `ProjectSource`/`ProjectCapabilities`/`ProjectRemoteDiagnosis`/
`RemoteAccessResult`, and correct the docstring. (Type-only lib imports are PWA-clean, so
re-exporting `import type` from the lib is also acceptable — the type-test is the least
invasive.)

**D9. Server-bridge `LibModule` types erase lib returns to `Promise<unknown>`.**
`remote-hooks.ts:28-37`, `classify-project/+server.ts` — the DTO the renderer hand-mirrors is
never compile-time-linked to what the lib actually returns.
*Fix:* type those `loadLib()` seams against `typeof import("@dimm-city/print-md")` (host-side
code; allowed), and add `AssertDto` entries for diagnose/test-access/sync/classify.

## E. Duplication — patch-safe consolidations

**E1. Vendored `paged.polyfill.js` ×2 with no drift check.** Byte-identical today
(sha256 verified), single commit each, but `PAGEDJS-PATCHES.md`'s update instructions mention
only the CLI copy — the next pagedjs bump will silently desynchronize the viewer.
*Fix:* a tiny drift test/CI step hashing both files, + one line in PAGEDJS-PATCHES.md.

**E2. 8-line auto-snapshot/auto-sync block copy-pasted into all 5 mutating fs routes**
(`write-file`, `create-file`, `create-folder`, `rename`, `delete` — the `writeHooks` vs `hooks`
naming drift in delete.ts proves the hand-paste). *Fix:* `scheduleAutoWriteEffects(targetPath)`
in `server-bridge/write-hooks.ts`; five call sites become one line each.

**E3. "Open the editor pane" sequence duplicated at 5 sites in `+page.svelte`**
(1383, 2002, 2013, 2064, 2704), with focus-behavior drift between them.
*Fix:* one `openEditorPane({ focus = true })` helper.

**E4. `insertionPointAfterCurrentLine` boilerplate ×8** in `editor/toolbar-actions.ts`
(applyHr/PageBreak/Table/Image/Chapter/Section/TwoColumn/Spread). *Fix:* extract the 3-line
helper.

**E5. EditorToolbar popup-disclosure state machine ×3** (heading/layout/more —
lines 116/158/307). *(Low, optional.)* *Fix:* `createDisclosure()` helper instantiated thrice.

**E6. `finding()` builder exists but 23 of ~35 check modules hand-construct the literal.**
`checks/policy.ts:34` vs e.g. `color-spaces.ts:22-54`. *Fix:* mechanical find-replace to
`finding(check.id, {...})`.

**E7. `mock.module("electron", ...)` superset copy-pasted across 5 test files**, each with the
same comment warning the copies must stay in sync under `bun test --isolate`.
*Fix:* shared `tests/support/electron-mock.ts` with per-test overrides.

**E8. Git pkt-line push parsing reimplemented in 4–5 recovery test files**, with a real
behavioral difference between copies (first-command-only vs all-commands).
*Fix:* one canonical `parsePushCommands()` in `remote-auth/test-support/`.

**E9. `RecoveryContext` builder + `currentBranch` helper hand-copied into ~15
`recover-*.test.ts` files** — `testkit.ts`'s own header says it exists to kill exactly this.
*Fix:* add `makeRecoveryContext()`/`gitCurrentBranch()` to testkit; migrate imports.

**E10. Check-selection filtering duplicated between `runner.ts` and `tool-check.ts`.**
`checkToolAvailability` (`tool-check.ts:34-47`) re-implements `runChecks`'
(`runner.ts:55-78`) exact only/skip/`isCheckEnabled` selection sequence, kept in sync only by
a comment ("the SAME enable logic the runner uses"). A future change to one filter dimension
silently desyncs which checks are tool-probed from which actually run.
*Fix:* extract `selectChecks(opts, config)` into `registry.ts`; both call it. Mechanical, no
behavior change.

## F. CI & release pipeline

**F1. Electron main/preload TS is never type-checked in CI.** `ci.yml:118` runs the viewer's
`check` (svelte-check, SPA only); the `typecheck` script (`tsc -p electron/tsconfig.json`)
exists and nothing calls it — a type error in `main.ts` merges green (empirically verified
during the audit). *Fix:* one CI step: `bun --cwd packages/viewer run typecheck`.

**F2. Release binaries are smoke-tested with `--version` only** (release.yml:249, :470),
which never exercises the embedded-assets extraction CLAUDE.md itself flags as the fragile
part of `bun build --compile`. *Fix:* extend the smoke to `print-md new /tmp/smoke --template
book` + assert scaffolded files exist (linux + windows verify jobs).

**F3. Node pinned only for the Windows viewer build** (`build-viewer-windows-zip` pins 20;
linux/mac electron-builder jobs run the runner's ambient Node). *Fix:* add the same
`setup-node` step (or a shared composite) to both.

**F4. Docker publish is dispatch-and-forget** (release.yml:579-582, last step) and the
Dockerfile is built by no PR check. *Fix:* path-filtered `docker build` (no push) in ci.yml;
optionally `gh run watch` the dispatched run.

**F5. `install.sh`/`install.ps1` are never exercised in CI** despite `PRINTMD_LOCAL_BINARY`
existing precisely for that ("Used by CI to verify the binary produced by the current
branch" — install.ps1:14). *Fix:* run both installers against the fresh binaries in the
release workflow (and/or a PR-time lint of the scripts).

## G. Structural — defer to a minor release

These are real, verified, and deliberately **out of scope** for the patch:

- **G1.** `+page.svelte` (3,968 lines; 56 `$state`, 82 functions) — the controller extraction
  is done and working; what remains is **view** extraction: the 375-line inline toolbar header
  (2310–2684) → `WorkspaceToolbar.svelte`. The one inline modal (Save-as-template, 3076–3105,
  the only dialog in the app not a component and not using the shared `dialogBehavior`
  focus-trap) is small enough to extract in the patch if desired.
- **G2.** `main.ts` (1,768 lines, ~15 concerns) — next candidates: `remoteHooksImpl`'s
  ~100-line clone/conflict bodies → a controller mirroring Export/PreviewOpen; the
  self-contained CSP/frame-ancestors detector (551–588) is a patch-safe move if wanted.
- **G3.** `updater.ts`'s 10 module-level mutable `let`s → one state object (mechanical but
  wide; every sibling subsystem is class-encapsulated).
- **G4.** `AutoSyncOrchestrator`'s five independently mutated per-dir fields → explicit state
  value (the file's own TOCTOU-fix comment shows why); requires test rework.
- **G5.** Watch-then-arm-interval ordering owned by the host rather than renderer call order
  (today an `activePreview` guard + a regression test enforce it — acceptable).
- **G6.** `fs:watchFolder` scoping is regression-tested by regex over `main.ts` source text
  (`watch-folder-scoping.test.ts:64-181`) — extract the handler into an injectable function
  and test it for real.
- **G7.** Unify friendly-error → HTTP-status classification (vcs/* uses `onError` + 422;
  remote/*/publish/* throw plain 500s; dormant today since only message text is consumed).
- **G8.** `build-runner.ts`'s `PdfOutput.finish` (454–577) threads ~10 live locals through
  seven sequential concerns (stage → render → stamp → ICC → strip → CMYK → validate) under one
  try/finally; extract the pdfx-only tail if revisited.
- **G9.** `pagination.ts`'s `paginateAndCapture` (199–310) has two independent
  `clearInterval` sites (correct only because clearing twice is a no-op); one `stop()`
  teardown would make it authoritative.
- **G10.** `markdown-it-paged.js`'s `layout_transform` (248–598) is a hand-rolled scope-stack
  state machine where adding a marker kind touches ≥5 coordinated spots with ordering
  invariants enforced only by prose comments. Budget extra review for any new marker (CLAUDE.md
  §6 keeps this module the canonical owner — leave as-is otherwise).

## Refuted / no-action (for the record)

- Manual type annotations on `pageNav`/`landingVisible` in `+page.svelte` — deliberate,
  documented workaround, not a live symptom.
- "Unused `ProjectCapabilities` mirror" in shared-types — it *is* consumed via
  `bridge-types.ts`/`types.d.ts`.
- "Dead platform seam" (`openFolder`/`listDir`/`saveSnapshot`) — deliberate PWA staging per
  plan + maintainer disposition (see Corrections).
- `$effect` ban workarounds, route boilerplate, `api.ts` fetch-wrapper duplication,
  fs path-traversal, `app://` auth, browser-pool lifecycle — all specifically hunted and found
  **already handled** (eslint rule + settings-change channel; `defineRoute` factory; shared
  `post()/get()`; symlink-canonicalizing `fs-guard` + scoping tests; bearer token; pool
  identity-reset pattern).
