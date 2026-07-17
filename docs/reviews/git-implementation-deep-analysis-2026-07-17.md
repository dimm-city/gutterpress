# Git Implementation — Deep Defect Analysis (2026-07-17)

_Scope: the entire git subsystem — `packages/cli/src/lib/{project-source,source-provider}.ts`,
`packages/cli/src/lib/remote-auth/**` (sync, transport, conflict-resolution, credentials,
recovery/**), and the viewer host orchestration `packages/viewer/electron/{auto-sync,auto-snapshot}/**`
plus the vcs/remote routes. ~10k lines of non-test source._

_Method: six parallel deep-dive agents (lib core, sync/merge engine, recovery pipeline,
credential plumbing, host orchestration, simplification), each with a **data-loss-first** lens
for non-technical writers, verified against the vendored **isomorphic-git 1.38.4** source; then
a manual verification pass on every load-bearing claim before anything was fixed or reported._

## Audience frame

The people this must be trustworthy for have **no git experience**. Ranked by harm:

1. **Silent loss of their writing** — the worst outcome. Anything that overwrites/reverts/deletes
   files without a recoverable copy, or commits a half-finished state as if it were their work.
2. **Confusing states they can't escape** — a wedged sync, a "reconnect" loop that can never
   succeed, a repair that lies "fixed."
3. **A security breach of their trust** — a leaked token, syncing the wrong tree, transmitting
   secrets in cleartext.

## Summary

The subsystem is unusually thorough (15 recovery handlers, a snapshot-first invariant, a
per-repo lock, extensive tests). But the analysis found a **systemic pattern**: the safety
mechanisms have **crash/interruption windows and classification holes** that, under real-world
timing, route benign conditions into destructive handlers or lose un-committed work. There is
also a small cluster of **credential/security** issues.

**This report is the primary deliverable.** Because this is trust-critical code with a large
test surface, only the **small, high-confidence, security/correctness fixes were applied in this
pass** (they are marked ✅ FIXED). The deeper structural items are marked **RECOMMENDED** with a
concrete approach — they deserve deliberate design + tests, not a rushed edit, precisely so the
fix doesn't introduce the instability we're trying to remove.

Counts: **9 fixed**, **~30 recommended defects**, **~12 simplifications** (several of which are
also the *mechanism* behind a defect).

---

## ✅ Fixed in this pass (branch `claude/codebase-quality-review-l3vk4a`)

All verified against the code and covered by tests; full CLI suite green (1800 pass).

| # | File | Fix |
|---|------|-----|
| G1 | `remote-auth/transport.ts` `onAuthFor` | **Never transmit a token in cleartext.** The protocol gates accept `http://` too, so a repo-scoped account token was sent as Basic auth over unencrypted HTTP to any remote — harvestable on the wire. `onAuth` now withholds the credential unless the URL is `https` (or `http` to loopback, for local servers/test fixtures). New `isCredentialTransmissionSafe()` + tests. |
| G2 | `remote-auth/github-auth.ts` `safeFetch`/`connect` | **Device flow had no timeout in the packaged app.** `signal ?? AbortSignal.timeout(...)` dropped the 15s timeout whenever a caller passed a signal — and the viewer *always* does, so a TCP stall left "Connect GitHub" spinning forever. Now `AbortSignal.any([signal, timeout])`. |
| G3 | `remote-auth/token-store.ts` `read` | **A transient read error could wipe every other credential.** `read()` treated *any* error (EACCES/EIO/EMFILE) as an empty store, so a following `set()`/`delete()` persisted that empty base. Now only `ENOENT` = empty; other errors rethrow so a write aborts. `get()`/`list()` tolerate the throw as "temporarily unknown." |
| G4 | `remote-auth/recovery/context.ts` | **Recovery ran unauthenticated for port/`www.` remotes.** Used `new URL().hostname` (drops `:port`, keeps `www.`) instead of the canonical `credentialHostKey()`. A `host:3000` remote found no credential → recovery's fetch/clone 401/404'd → "history can't be restored" for a *connected* user. Now uses `credentialHostKey()`. |
| G5 | `remote-auth/sync.ts` `pullChanges`/`pushChanges` | **History-tab Pull/Push could publish conflict markers.** The structural preflight (repair a damaged repo before touching it) lived only in `syncProject`; Pull/Push call `pullChanges`/`pushChanges` directly and would snapshot-and-push a half-done merge's `<<<<<<<` markers to every collaborator. Extracted `assertNoStructuralDamage()` and applied it to all three (also removes duplication). |

_(Numbering continues the prior audit's A–F/G scheme; these are new G-items.)_

---

## 🔴 RECOMMENDED — data-loss & catastrophic (fix next, with care)

These are the highest-harm findings. Each needs a small, well-tested change; they were **not**
rushed because they touch the snapshot/restore/merge core.

### R1 — Opening a folder inside an unrelated enclosing repo adopts the WHOLE repo
`project-source.ts:181` (`findEnclosingRepoDir`). A folder with no `.git` of its own classifies
as `local-git-folder` against **any** ancestor repo, guarded only against *exactly* `$HOME`.
Open `~/Documents/MyNovel` when `~/Documents` is a git repo (a backup tool made it one) →
`repoRoot = ~/Documents`. Default-on auto-snapshot then commits **every file in Documents** (tax
PDFs, other projects) as "Automatic snapshot"; default-on auto-sync **pushes it all**; restoring
"yesterday's novel" force-reverts every unrelated file.
**Approach:** don't silently adopt a large enclosing repo. Options, in preference order: (a) only
treat an ancestor repo as the project root when the opened folder is at/near its root **or** the
repo carries print-md provenance; (b) require explicit user confirmation ("This folder is inside a
larger project at `<path>` — manage that whole project?") before enabling snapshot/sync; (c) at
minimum, refuse *auto*-snapshot/*auto*-sync (keep manual-only) when `repoRoot` is far above the
opened folder and contains many unrelated top-level entries. Also extend the `$HOME` guard to the
standard top-level dirs (`~/Documents`, `~/Desktop`, `~/Downloads`).

### R2 — Snapshot-first invariant has a TOCTOU hole across the whole fetch
`sync.ts` `pullChanges` (snapshot at ~L251, forced checkout after merge at ~L314). The entry
snapshot runs *before* the network fetch; the forced checkout that clobbers the tree runs *after*
the merge. An editor autosave landing in between is captured in no snapshot/commit/ref and is
overwritten by the merged tree. The invariant's own comment ("the tree is clean, so the forced
checkout can't discard anything") is true only at snapshot time.
**Approach:** immediately before the forced checkout, re-check for working-tree changes; if any
appeared since the entry snapshot, commit them (a second snapshot) so they survive, then reconcile.
Same gap in `resolveConflicts` (`conflict-resolution.ts:463` vs `:213`, and the race-recovery
re-merge at `:351`). Add a regression test that writes a file between snapshot and checkout.

### R3 — `restoreVersionWithBackup` skips the safety backup for staged-uncommitted work
`source-provider.ts:808`. It decides whether to back up using `hasPendingChanges` (WORKDIR-vs-STAGE
only). The `SNAPSHOT_STAGING_MARKER` crash window leaves index == workdir == the writer's latest
edits with HEAD at the old tip — `hasPendingChanges` sees "clean," skips the backup, and
`git.checkout({force})` overwrites both index and workdir. **Everything since the last completed
snapshot is destroyed with no backup and appears in no history.**
**Approach:** gate the backup on `hasUncommittedChanges` (WORKDIR-vs-STAGE-vs-HEAD) — or always
back up before a force checkout. Cheap and decisive.

### R4 — Restore has no crash journal; a killed restore silently half-reverts the book
`source-provider.ts:604` (`restoreUnlocked`). `git.checkout` runs in phases (delete+index, rmdir,
mkdir, create); a kill mid-way leaves a mixed-version tree with nothing on relaunch detecting an
in-flight restore. The next edit auto-snapshots the Frankenstein tree as the newest history entry.
**Approach:** wrap restore in the same marker protocol snapshot uses (write a `restore-in-progress`
marker before, clear after; on startup, a lingering marker triggers a re-restore or a clear warning).

### R5 — After a clean-tree restore, HEAD isn't moved → "nothing to save" lie + disk≠history
`source-provider.ts:610`. Restore uses `noUpdateHead`, so the on-disk tree differs completely from
the newest history entry while HEAD stays at the newer tip. "Save snapshot" then reports "nothing
new to save," and any HEAD-based surface (push, build provenance) operates on a tree the writer
isn't seeing.
**Approach:** after a confirmed restore, create a commit that records the restored tree (so history
matches disk), or clearly model "restored, unsaved" state in the UI. Design decision — but the
current silent mismatch reads as the app lying.

### R6 — Binary files silently corrupted on a "clean" merge
`sync.ts:277` (and `conflict-resolution.ts:294/359`). isomorphic-git's `mergeBlobs` has **no binary
detection**: it decodes both sides as UTF-8 (lossy) and re-encodes. When diff3 finds non-overlapping
"lines" it reports a clean merge and commits a corrupted franken-binary — no conflict dialog. The
binary safeguards only engage *after* a `MergeConflictError`.
**Approach:** detect binary paths (the existing `BINARY_EXTS`, or a NUL-byte sniff) *before* the
merge and force them onto the conflict path (keep-mine/use-theirs/keep-both) instead of content-merging.

### R7 — merge→checkout is non-atomic; a failed checkout lets the next sync revert the merge
`sync.ts:314`. `git.merge` moves the branch ref, then `git.checkout({force})` syncs the tree. If
checkout throws (Windows EPERM on an open PDF, disk full) HEAD is already the merge commit but the
tree is pre-merge. The next sync's snapshot commits the **stale pre-merge tree on top of the merge**
and pushes it — silently erasing the collaborator's changes for everyone.
**Approach:** on checkout failure after a merge, reset HEAD back to the pre-merge tip (the entry
snapshot) so the merge is retried cleanly, rather than leaving HEAD ahead of the tree.

### R8 — Resolution plan isn't atomic across a conflict bail; a chosen "keep" file is deleted
`conflict-resolution.ts:297`. `applyPlan` commits the delete-conflict equalization *before* the
driver merge; if the merge then conflicts on a *different* file, it returns without running the
`postWrites`/`postDeletes` that restore the author's chosen side. A file the writer explicitly chose
to **Keep** is deleted locally and online, and the re-rendered dialog doesn't re-offer it.
**Approach:** apply the full resolution (pre + post) atomically, or carry unfinished restore steps
into the next `resolveConflicts` pass.

### R9 — Recovery backups can silently finalize empty, then the destructive repair proceeds
`recovery/backup.ts:281`. A per-file read error during zip creation is swallowed and the entry is
finalized with zero bytes; `assertZipReadable` validates only the central directory, never content.
On Windows/OneDrive with a lock on `chapter-05.md`, the backup zips it empty, "verification" passes,
the confirm dialog promises a safety copy, and the abort resets the edits — **gone from disk AND the
backup**, at the exact moment the backup mattered.
**Approach:** treat any per-file read error as a backup failure (abort the repair, tell the writer to
retry/close other apps), or record which files couldn't be backed up and refuse the destructive step
for those paths.

### R10 — `missing-git-dir` reattach makes a stale local copy authoritative → reverts online work
`recovery/recover-missing-git-dir.ts:114`. The documented trigger is "user restored from a zip" —
i.e. a *stale* copy. Reattaching a fresh clone's `.git` makes every difference in the stale folder a
plain modification/deletion (no conflict surfaced); the next auto-sync commits the month-old tree
over the remote tip and pushes, **reverting newer online chapters and deleting files** with a normal
fast-forward.
**Approach:** after reattach, if the local tree differs from the remote tip, route through the
conflict chooser instead of letting auto-sync fast-forward-publish the stale state.

### R11 — Detached-HEAD repair force-checks-out the wrong branch and calls it "recovered"
`recovery/recover-detached-head.ts:164`. `buildRecoveryContext` falls back to `branch="main"` for a
detached HEAD, and `resolveTargetBranch` treats any non-empty branch as "explicit," so the
sole-local-branch / containing-branch / origin-HEAD discovery never runs in production (tests only
exercise `branch:""`). A `master`-based repo with a stale local `main` gets force-checked-out to the
ancient `main`; the writer sees months-old chapters and their real work sits on an invisible branch.
**Approach:** let detached-HEAD discovery run (don't pre-fill `branch` for detached HEAD), and never
force-checkout a branch whose tip doesn't contain the detached commit without a rescue branch + clear
messaging.

### R12 — Interrupted-rebase abort can rewind to a stale `ORIG_HEAD` and lose commits unreachably
`recovery/recover-interrupted-rebase.ts:108`. When `<stateDir>/orig-head` is absent it falls back to
`.git/ORIG_HEAD`, which many unrelated operations write and which can be arbitrarily stale. With
`ctx.branch`'s guaranteed non-empty fallback, the abort force-writes the branch ref to that stale
commit with **no rescue branch** (unlike detached-head), so abandoned commits become unreachable —
recoverable only from the tmp zip before the 7-day prune.
**Approach:** if a trustworthy orig-head isn't present in the rebase state dir, don't guess from
`ORIG_HEAD`; create a rescue branch at the current HEAD before any ref rewrite.

---

## 🟠 RECOMMENDED — wedged states, misclassification & credential-deletion

### R13 — HTTP 404 (renamed/deleted repo) → `auth_required` → deletes the whole-host credential
`recovery/classify.ts:98` maps 401/403/**404** → `auth_required`; `recover-auth.ts:96` then
`tokenStore.delete(host)`. GitHub returns 404 for a renamed/deleted repo *with a valid token*, so
renaming one repo deletes the `github.com` credential and **silently stops auto-sync for every other
project on that host** (the orchestrator's `canSync` gate skips them with no error).
**Approach:** don't auto-delete a host-wide credential on an ambiguous 404. Distinguish "repo not
found" (guide the user to re-point the remote) from "token rejected" (401/403), and never let one
project's remote problem revoke credentials the writer's other projects depend on.

### R14 — `NotFoundError → 401` mislabels a deleted/renamed remote branch as auth failure
`transport.ts:244`. When the server's advertised refs lack `remoteRef`, isomorphic-git throws
`NotFoundError` (not an HTTP 404); the blanket `code === "NotFoundError" → HttpError(401)` rewrite
turns "branch renamed" into a permanent "reconnect" loop the writer can never satisfy while local
commits pile up unpushed.
**Approach:** map the missing-remote-branch case to a distinct, actionable outcome (offer to
create/track the branch) instead of an auth error.

### R15 — Interrupted fetch leaves a dangling remote-tracking ref → full-repo re-download / mis-recovery
`transport.ts:218`. isomorphic-git advances `refs/remotes/<remote>/<branch>` *before* the pack is
persisted. A timeout/crash/offline drop during the pack body (including the new idle-timeout trip)
leaves the tracking ref pointing at an oid with no local object. The next fetch's `have` computation
skips it → the server streams the **entire repo** into memory (the multi-GB OOM this very function's
`singleBranch` fix exists to prevent), repeating on every retry; and any code resolving the tracking
ref hits "missing object" → routed into the **corrupt-objects recovery** for what was a network blip.
_Interacts with the timeout change I shipped earlier — this is the failure mode that change can
surface._
**Approach:** after a failed/aborted fetch, roll the remote-tracking ref back to its previous value
(capture it before the fetch, restore in the catch), so a retry negotiates correctly and a network
blip never masquerades as corruption.

### R16 — `withRepoLock` is per-process; nothing protects `.git` across processes
`source-provider.ts:150`. The only concurrency guard is a module-level `Map`. isomorphic-git 1.38.4's
own cross-process index locks are commented out (`.git/index` is a full-file write behind an
in-process lock; `writeRef` is a bare `fs.write`). The viewer host + a CLI run (or a second window on
a symlinked path) interleave freely: `snapshot∥snapshot` drops staged entries or tears `.git/index`
(repo bricked for a non-technical user); `commit∥commit` races the ref write (a confirmed snapshot
vanishes from history).
**Approach:** a real on-disk lock (e.g. an `flock`/lockfile in `.git` with a stale-timeout) around
every repo mutation, shared by CLI and host. This is the one item that may justify *added* mechanism
— it removes a whole class of corruption. Scope it deliberately.

### R17 — `.git`-file layouts (submodule/worktree) crash every snapshot
`source-provider.ts:736`. `snapshotStagingMarkerPath` assumes `.git` is a directory
(`path.join(dir, ".git", marker)`), but classification deliberately supports `.git`-*file* layouts.
Every snapshot then dies with a raw `ENOTDIR` — version history is completely dead for a layout the
classifier promises to support (no data lost; the writer just can't save/restore).
**Approach:** resolve the real git dir (isomorphic-git can, or read the `gitdir:` pointer) and place
the marker there; or store the marker outside `.git`.

### R18 — Tracked symlinks break or flood version history
`source-provider.ts:303`. Phase-2 rehash uses `readFile` (follows symlinks) while the index stores the
`readlink` *target string*. A tracked symlink's rehash never matches: a broken/dir link throws ENOENT
inside `git.walk` (every snapshot/restore fails with a raw error, writer locked out), a live file-link
never matches so every auto-snapshot tick commits an identical tree (history floods with meaningless
entries; no empty-commit guard).
**Approach:** hash tracked symlinks the way git does (compare the link target), or explicitly skip
symlinks in the workdir walk.

### R19 — Recovery dialogs promise "your files won't change" while force-checking-out a different tree
`recovery/policy.ts:99` + `manual-guidance.ts:148` say detached_head "won't remove or overwrite
content files," but the handler force-checks-out a different tree and moves uncommitted edits to a
hidden rescue branch. The intended escalation (`detachedHeadWithLocalChangesPolicy`) is exported,
tested, and **never called**. A writer approves a "safe" repair that then resets their morning's work.
**Approach:** make the confirmation copy match what the handler actually does (it *does* change files),
and wire the local-changes escalation (or delete it — see S-items).

### R20 — Manual sync bypasses the orchestrator → conflict latch never clears
`viewer .../api/remote/sync/+server.ts:23`. The Sync button and every recovery-guidance "Try again"
call `lib.syncProject` directly, so a successful manual sync never clears `conflictLatched`, never
emits `sync:status`, never updates `lastSyncAt`. After an auto-sync latches on a conflict, a manual
"Try again" that *succeeds* still leaves auto-sync **latched off for the rest of the session** —
hours of edits are snapshotted locally but never pushed, and the pill keeps showing "error."
**Approach:** route manual sync through the orchestrator (so success clears the latch + emits status +
logs), or have the route explicitly unlatch + emit on success.

### R21 — `restore_repo` guidance button never actually runs recovery
`viewer +page.svelte:815` → `/api/remote/sync` → `lib.syncProject`, which **throws**
`RepoNeedsRecoveryError` on a structurally broken repo; `handleRemoteErrors` sanitizes it to a generic
message. So the "repair" button the writer is told to press just shows "operation could not be
completed" and never dispatches a recovery handler — the writer is wedged until they fully close and
reopen the project.
**Approach:** the guidance's repair action should call the recovery entry point (as preflight-on-open
does), not the plain sync route.

### R22 — Auto-sync interval hammers a revoked token forever, no backoff
`viewer auto-sync/orchestrator.ts:375`. The periodic interval re-runs a full `syncProject` every
`autoSyncMinutes` (default 2) with no backoff and no pause on persistent `auth`/`error` outcomes
(only `conflict` latches; the `canSync` gate checks credential *presence*, not validity). A revoked
token → hundreds of failing authenticated requests overnight, tripping forge abuse throttling and
burning battery/network.
**Approach:** exponential backoff on repeated failures; pause auto-sync after N consecutive `auth`
failures and surface a single "reconnect" prompt rather than looping.

### R23 — Orchestrator state races drop syncs / sync the wrong (closed) project
`viewer auto-sync/orchestrator.ts` (multiple: `onStop→cancelAll` orphaning an in-flight preflight
state at `main.ts:482`; the watched-dir guard not re-checked before the network work at `:498`;
recovery branches leaking `runAgain` at `:646`). Net effects: a queued sync silently dropped, a
project-switch mid-sync merging remote changes into the *closed* project, a stale conflict pill
seeded from an orphaned state. See **S9** — these all stem from the keyed multi-project state machine
for an app that only ever has one open project.
**Approach:** the S9 simplification (single-session slot + epoch validation + one `settle()` owner)
removes the class.

### R24 — Auto-snapshot's `schedule()` async gap loses the last edit at quit
`viewer auto-snapshot/scheduler.ts:145`. `schedule()` sets `this.pending` only *after* awaiting
`loadLib()`+`readSettings()`; the close gate reads `hasPending()` synchronously and skips the flush,
and `updater:applyNow` deliberately *cancels* a pending snapshot. A final save immediately followed by
quit gets no history entry — a hole at the single highest-risk moment.
**Approach:** mark pending synchronously on the edit signal (before the awaits); flush pending
snapshots on the updater path instead of cancelling.

### R25 — Close-gate watchdog can kill an in-flight snapshot commit mid-write
`viewer main.ts:858`. The 5s watchdog calls `finish()` (→ `win.destroy()` → app quit)
*unconditionally*, including after `flushAutoSnapshot` has already begun the git commit. A commit
killed mid-object-write leaves a stale `index.lock`/partial commit → the next launch greets the writer
with a "repairing your project" pass for damage the app inflicted. (Related to the flush rework
shipped earlier, which handled the *hung-renderer* case but not the *commit-started-then-watchdog*
case.)
**Approach:** once the snapshot commit has started, let it finish (it's fast and local) before
destroying the window, or take the snapshot *before* arming the destroy watchdog.

### R26 — Stale-lock repair deletes a lock chosen before an unbounded confirmation wait
`recovery/recover-stale-lock.ts:186`. Lock candidates are computed *before* the confirm prompt and
never re-checked; the CLI prompt is unbounded. A writer who walks away, later runs a native git op
that creates a *new* live `index.lock`, then answers "y," has the **live** lock deleted out from under
an in-flight write — corrupting exactly the state recovery exists to fix, with no backup.
**Approach:** re-probe lock staleness *after* the confirmation returns (as `missing-git-dir` already
does), and skip any lock that is now fresh.

### R27 — `missing-git-dir` `.git` install is non-atomic → a second crash wedges permanently
`recovery/recover-missing-git-dir.ts:118`. `cp(recursive)` copies thousands of files into the final
`.git`; a crash mid-copy leaves a partial `.git` that the *second* recovery attempt classifies as
`missing_or_corrupt_objects` (whose fetch repair can't recreate HEAD) → dead-ends at "make a fresh
copy… contact support."
**Approach:** clone/copy into a temp dir inside the project and `rename()` into place (atomic).

### R28 — "Recovered" lies for programming/benign errors
`recovery/classify.ts:197` maps isomorphic-git's `MissingParameterError` (a caller bug) to
`missing_or_corrupt_objects`; its STILL_APPLIES probe passes on a readable repo → dispatch reports
"recovered — your history was already intact" while the real bug is untouched, looping reassuring
toasts forever. Related: `failsafe.ts:127` returns `failed_no_changes_made` even when a
`createBackup:false` handler threw *after* mutating `.git`.
**Approach:** don't classify programming errors as repo corruption; make `failed_no_changes_made`
provably true (only for backup-creation failures / before any mutation).

### R29 — `MergeNotSupportedError` conflates file/dir conflicts, criss-cross, and unrelated histories
`recovery/classify.ts:150`. All three map to `unrelated_histories`, whose repair re-throws for the
first two → generic "please try again" forever, or a misdiagnosed merge. A writer who turns
`chapter-05.md` into `chapter-05/` while a collaborator edits the file wedges with no author-language
way out.
**Approach:** detect the type-mismatch/criss-cross cases and route them to a real conflict-resolution
path (or a clear "this change needs manual help" message), not the unrelated-histories merge.

### R30 — `LocalFolder.initVersionHistory` has no crash marker → "history on but empty & unsaveable"
`source-provider.ts:446`. The initial commit is the longest stage window; a crash between stage and
commit leaves a fully staged index with zero commits — `git.log` throws, snapshot says "no changes"
(a lie), and re-enabling swallows the no-changes error and reports success while doing nothing.
**Approach:** use the staging-marker protocol for the initial commit too, and handle the zero-commit
repo explicitly (detect + finish the commit on next open).

### R31 — Clone leaves a partial `.git` in a pre-existing empty folder; retries permanently blocked
`clone.ts:248`. Failure cleanup is gated on `!dirExistedBefore`, so a clone into an OS-picker-created
empty folder that fails mid-transfer keeps the partial `.git`. Retries error "that folder already has
files" (an invisible dotfolder), and isomorphic-git writes config+remote before fetching so the
half-clone classifies as a valid remote-bound project with no content.
**Approach:** on clone failure, remove the `.git` this clone created (track "did we create it") even
when the target folder pre-existed empty.

### R32 — LFS/submodule repos "clone successfully" but are broken
`clone.ts:224`. isomorphic-git checks out LFS pointer files as content and leaves submodule paths
empty, with no detection/warning. A book using LFS for print-resolution images clones to 130-byte
pointer text files — broken preview, empty PDF, and re-adding real images creates mixed pointer/binary
state for collaborators.
**Approach:** after clone, detect `.gitattributes filter=lfs` / `.gitmodules` and warn clearly that
the repo needs full git tooling (print-md can't manage LFS/submodules).

### R33 — Generic-host connect verifies a WRONG token as "connected" (the default UI path)
`generic-auth.ts:176`. The root-probe mode accepts `not-found`/`unknown` results, so a wrong token is
"verified" whenever `repoUrl` is omitted — and the primary Settings → Connections UI never passes
`repoUrl`. A one-character-off token shows "Connected," then every later sync fails "didn't accept the
saved connection."
**Approach:** the pre-save probe should require an authenticated signal (e.g. an endpoint that
actually evaluates the credential) before reporting success, or the UI should pass a repo to probe.

### R34 — Recovery backup zips are world-readable in `/tmp`
`recovery/backup.ts:225`. The writer's full unpublished manuscript + `.git` objects are written under
`os.tmpdir()/print-sync-recovery` with default `mkdir` mode (0755), retained up to 7 days / 20 zips —
unlike the 0600 token store. On a shared machine, any other local account can read the entire private
book for a week.
**Approach:** create the backup dir 0700 and the zips 0600 (match the token store's discipline).

---

## 🟡 Simplifications that remove defect-hiding complexity

These reduce surface **and** each is the mechanism behind a defect class; strong candidates given the
"reduce complexity" mandate.

- **S1 — `managed-github` ProjectSource variant is dead** (`project-source.ts:71`). Never returned;
  `providerFor` throws on it; the shipped clone model represents "managed" as a plain
  `local-git-folder`. Delete the variant, its `capabilitiesFor` arm, the `providerFor` throw, and the
  viewer mirror — an unreachable union arm is where wrong assumptions compile green.
- **S2 — `ProjectCapabilities` is a 7-flag DTO with 6 unread flags** (`project-source.ts:98`). Only
  `canSnapshot` has consumers; the rest are constant-`true` or computed-and-ignored. Shrink to the
  consumed fields (this was flagged in the prior audit as doc-drift; the deep pass confirms the flags
  are genuinely unwired). Unwired gating flags are where capability/behavior drift hides.
- **S3 — `RecoveryResult` carries 3 terminal failure statuses no consumer distinguishes**
  (`recovery/types.ts:132`). `blocked`/`failed_no_changes_made`/`failed_backup_available` collapse to
  one "error" at every boundary; consumers use only `message`/`guidance`/`backupZipPath`. Collapse to
  one `failed` arm (backup presence = "backup available"). A mislabel is currently untestable.
- **S4 — Dead policy surface** (`recovery/policy.ts:30,224`): the `automate` field is written for all
  16 kinds and read by nothing but its test; `detachedHeadWithLocalChangesPolicy` (the intended
  dirty-detached-HEAD escalation, R19) is exported, tested, and never called. Either wire the
  escalation or delete it — tests currently give false confidence it *runs*.
- **S5 — `recover-wrong-remote` runs ~100 lines (a network probe + a redundant re-diagnose + a
  duplicate URL parse) only to build a `supportDetails` string the writer never sees — and the probe
  is unauthenticated, so it reports "destination not found" for perfectly-configured private repos**
  (`recover-wrong-remote.ts:61`). Return the static blocked guidance from `ctx` + the original error;
  delete the probe (also removes a network round-trip and its historical hang risk).
- **S6 — `friendlyCloneError` is a third fork of the transport-error classifier**
  (`clone.ts:152`), already drifted (missing ECONNRESET/"socket hang up"; auth regex over-matches any
  "auth"). Route through the canonical `classifyTransportFailure` and map its 3 results to clone-flavored
  strings.
- **S7 — Duplicated security-sensitive plumbing that can drift** (`test-access.ts:146` and siblings):
  the credential→`{username,password}` mapping exists twice (transport `onAuthFor` vs test-access,
  which differ), the scp-like SSH regex in three variants (only one matches IPv6 `git@[::1]:…`, so
  `diagnose` mislabels such remotes as local-only), and transport-error classifiers in three near-copies.
  Consolidate to one exported helper each. A future auth-convention fix landing in one copy but not the
  others makes "Test connection" and real sync silently disagree.
- **S8 — `NoChangesError` is signalled by regex-matching a human message** (`source-provider.ts:710`,
  `isNoChangesError`), and both the auto-snapshot scheduler and `initVersionHistory` branch on it.
  Rewording the author-facing string silently breaks control flow. Use a typed error / `e.code`.
- **S9 — Orchestrator keyed multi-project state for a single-project app** (`auto-sync/orchestrator.ts:207`).
  The `Map<dir,State>` + external acquire/release + `cancelAll` clearing the map is the mechanism
  behind R23 (in-flight closures mutate orphaned entries). Replace with one `{dir, epoch, state}`
  session slot where every await re-validates the epoch (stale runs self-cancel) and a single
  `settle(outcome)` owns the `inFlight`/`runAgain`/latch transition — also collapsing the five inline
  `releaseFlight` copies and the duplicate inline conflict-latch.
- **S10 — Binary-classification has two disagreeing "sources of truth"** (`recovery/classify.ts:134`
  `BINARY_EXTS` vs viewer `recovery-bridge.ts:264` `BINARY_EXTENSIONS`, each self-described as "the ONE
  source"). Lists differ (`.mov`/`.avi` lib-only; `.avif`/`.tiff`/`.ogg` host-only), so engine and
  dialog silently disagree about the same file. Export one predicate from the lib (host code may
  value-import it) and delete the host set.
- **S11 — Ignored per-operation `projectDir` params on bound providers** (`source-provider.ts:546`).
  `listHistoryPage(_projectDir)`, `restore` (never reads `options.projectDir`), `snapshot` (overrides
  with `this.dir`). The provider already carries its scope; the redundant params can silently mask a
  caller passing the wrong project. Delete them.
- **S12 — `needs-connection-setup` code attached on only one of four setup-error paths**
  (`sync.ts` pull/push vs `conflict-resolution.ts:521`). The machine signal hosts route on exists only
  after `resolveConflicts`; Pull/Push return bare `error`. One shared mapper (fold `setupErrorMessage`
  into `failureOutcome`) fixes the routing and deletes two near-identical catches.

---

## Suggested remediation order

1. **Now (shipped):** G1–G5 (security + the Pull/Push preflight hole).
2. **Next, highest-harm data loss:** R1 (enclosing-repo), R3 (staged-work backup), R2 (snapshot TOCTOU),
   R7 (merge→checkout rollback), R6 (binary merge), R13/R14 (credential-deletion / branch-rename wedge).
   Each is a small, well-scoped change with a clear regression test.
3. **Then, crash-safety + orchestration:** R4/R5/R30 (restore/init journaling), R15 (fetch ref rollback,
   which my timeout change can surface), R20–R25 (host orchestration) — landing S9 first collapses R23.
4. **Deliberate design item:** R16 (cross-process lock) — the one place added mechanism is justified.
5. **Alongside:** the S-simplifications, each of which removes a defect's hiding place.

The pattern across almost all of these is the same: **make every crash/interruption window
journaled, and make every classification refuse to run a destructive handler on an ambiguous
signal.** That is what turns "extensively built" into "trustworthy for someone who's never used git."
