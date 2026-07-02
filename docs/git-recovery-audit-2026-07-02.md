# Git sync & error-recovery audit — 2026-07-02

Scope: `packages/cli/src/lib/remote-auth/` (sync, recovery subsystem, operation log),
`packages/cli/src/lib/source-provider.ts` / `project-source.ts` (change tracking),
and the viewer integration (`packages/viewer/electron/main.ts`,
`recovery-bridge.ts`, recovery dialogs, `+page.svelte`).
Branch: `fix/interrupted-op-recovery` (HEAD `24250e5`).

Method: full direct reads of the core orchestration layer (types, classify,
dispatch, policy, inspect, failsafe, manual-guidance, interrupted-rebase
handler) plus three parallel audits over the 14 `recover-*` handlers, the
sync-side flow, and the viewer integration. Every finding below that carries a
severity of *major* or higher was independently re-verified against the source
before inclusion.

---

## 1. How it works today (call-path map)

```
Runtime path (every auto-sync tick, viewer only):
  main.ts:1338  lib.syncProject()
    └─ sync.ts:605 syncProject → pullChanges/pushChanges
         └─ sync.ts's OWN private classifiers (classifyFailure, isPushRejected,
            isMergeConflictError) → structured SyncOutcome
  on THROW only:
    main.ts:1371 lib.inspectRepo()          → RepoHealth
    main.ts:1372 lib.classifyGitError(e, h) → SyncErrorKind
    main.ts:1411 lib.recover(kind, ctx, e)  → dispatch.ts → recover-<kind>.ts

Project-open preflight (separate path, viewer only):
  main.ts:2841 lib.inspectRepo()
  main.ts:2842 classifyFromHealth(health)   ← recovery-bridge.ts:304
               (a SECOND health→kind classifier, local to the viewer)
  main.ts:2877 lib.recover(kind, ctx)
```

Key structural facts:

- The recovery subsystem is **viewer-only**. `packages/cli/src/commands/` and
  `cli.ts` contain zero references to `recover`/`syncProject`/`remote-auth`,
  even though `print-md new` git-inits projects for CLI users.
- There are **three classifiers**: sync.ts's private helpers, `classify.ts`
  (documented as "kept in sync by spec" — i.e. by hand), and the viewer's
  `classifyFromHealth` (which genuinely disagrees with `classify.ts`, see C1).
- Concurrency is guarded by **two different mechanisms**: the library's
  `withRepoLock` FIFO queue (used by sync/snapshot/restore and only 2 of 14
  recovery handlers) and the viewer's per-project `inFlight` boolean.

What's genuinely good and should be preserved:

- The `policy.ts` matrix + `withBackupGate` (backup → confirm → risky →
  failsafe) is a sound, well-documented safety spine.
- Test coverage is heavy (~12k lines of tests over ~4.3k source) and earning
  its keep.
- `sync.ts` and `source-provider.ts` comply with the sync-simplicity mandate
  (no `statusMatrix`, no TREE walks on the check path).
- The viewer's status/action-key switches are exhaustive with fail-safe
  defaults; the confirmation gate handles window-close, double-confirm, and
  renderer-crash (60s timeout) correctly; the two recent fixes (`da402f6`,
  `24250e5`) are complete and regression-tested.
- Zero `$effect` usage in the touched viewer files.

---

## 2. Findings

### CRITICAL

#### C1 — Interrupted merge (`MERGE_HEAD`) has no recovery path on the runtime sync path

- `inspect.ts:176` detects it (`hasInterruptedMerge`), but `classify.ts` never
  reads that flag (verified by grep — no reference anywhere in the file). There
  is no `interrupted_merge` `SyncErrorKind`, no policy entry, no handler.
- The only consumer is the viewer-local `classifyFromHealth`
  (`recovery-bridge.ts:308`), which maps it to `merge_conflict` — and that
  classifier runs **only at project-open**, never on subsequent sync failures.

Failure scenario: isomorphic-git never writes `MERGE_HEAD` (verified), so this
state comes from the author (or another tool) running native `git merge` in a
terminal and abandoning it. If that happens **while the project is open**:

1. The next auto-sync tick's `snapshotBeforeAction` sees the conflict-marked
   files as ordinary changes and **commits the literal `<<<<<<<` markers into
   history**.
2. `git.merge()` runs fresh (isomorphic-git has no notion of the in-progress
   merge), may complete cleanly against the corrupted tree, and the result is
   **pushed to the shared remote** — silently corrupting the published content.
3. If instead an error is thrown, `classifyGitError` falls through to
   `"unknown"` → generic "Something unexpected went wrong" with no repair.

Fix: add the `hasInterruptedMerge` check to `classify.ts`'s structural block
(ordered with the other interrupted-op checks at `classify.ts:223-226`), give
it a first-class kind + policy + handler (an abort mirrors
`recover-interrupted-cherry-pick.ts` almost exactly: remove `MERGE_HEAD`/
`MERGE_MSG`, force-checkout the current branch tip; HEAD stays attached), and
delete the viewer-local duplicate (see S1). Whether the right UX is
"abort to last working state" or "route into the conflict chooser" is an open
design question (Q2 below).

#### C2 — Guidance promises a safety copy exactly when one doesn't exist

- `makeManualGuidance` hardcodes "A safety copy of your project will be saved
  before anything is changed" into `safeNextSteps` for every backup-requiring
  kind (`manual-guidance.ts:124,156,172,189,206,223,242`).
- But `failsafe.ts:81-87` returns `failed_no_changes_made` precisely when
  **backup creation itself failed** (disk full, unreadable zip). The guidance
  is keyed only on kind, not on whether a backup exists, so the one outcome
  where the promise is false is the one where it's shown. The dialog renders
  `safeNextSteps` verbatim; the only status-aware element (the "Show backup"
  row) is silently omitted with no explanation.

Failure scenario: author hits `interrupted_rebase`, backup zip fails, repair is
never attempted — dialog tells them their unfinished edits "are kept in that
safety copy so you can retrieve them." They aren't.

Fix (net-negative): delete the seven hardcoded backup lines and generate one
conditional line inside `makeManualGuidance` from the `backupZipPath` parameter
it already receives (`manual-guidance.ts:25,28`) — honest fallback copy when
absent.

#### C3 — 12 of 14 recovery handlers mutate `.git` without the per-repo lock

Verified: only `recover-interrupted-rebase.ts` and
`recover-interrupted-cherry-pick.ts` (the two newest handlers) wrap themselves
in `withRepoLock`. The other 12 — including handlers that delete
`.git/index` (`recover-corrupt-index.ts`), copy a whole `.git` into place
(`recover-missing-git-dir.ts`), and run raw `git.fetch`/`merge`/`checkout`
(`recover-missing-objects.ts`, `recover-unrelated-histories.ts`,
`recover-detached-head.ts`) — do not.

`source-provider.ts:142-168` documents the invariant these violate: isomorphic-
git has no internal locking, so *every* mutating operation on a repo must go
through the `withRepoLock` queue. The viewer's `inFlight` boolean is a
different, weaker mechanism: it serializes auto-sync/preflight against each
other but does **not** serialize a recovery against a user-triggered history
restore (`source-provider.ts:483`, which takes `withRepoLock`) or any future
non-viewer caller.

Failure scenario: user clicks "Restore" in the history panel while an approved
`missing_or_corrupt_objects` repair is mid-fetch — two writers race on
`.git/refs` and `.git/objects` with no serialization; exactly the corruption
class this subsystem exists to repair, self-inflicted.

Fix: acquire the lock once, uniformly — see S2 (dispatcher-level pipeline)
rather than backfilling 12 copies of the wrapper.

### MAJOR

#### M1 — Three hand-synchronized classifiers, already drifting

- `sync.ts:370/423/429` vs `classify.ts:22-81`: line-for-line duplicated
  error decoders, synced only by a comment ("kept in sync by spec").
- `recovery-bridge.ts:304` `classifyFromHealth` vs `classify.ts` structural
  block: **already disagree** on two points — interrupted merge (C1) and lock
  age (`recovery-bridge.ts:306` gates `stale_lock` on `lockAgeMs > 120s`;
  `classify.ts:226` fires on any lock; mitigated only because the stale-lock
  handler independently re-checks age and returns `retry_later`).

Fix: one classifier in the lib (S1).

#### M2 — `recover-missing-git-dir.ts` TOCTOU: `cp` merges into a `.git` that reappeared

`recover-missing-git-dir.ts:99-103` copies the temp clone's `.git` with
`cp(src, dest, { recursive: true })` without re-checking that `.git` is still
absent. Node's recursive `cp` **merges** into an existing directory. If the
author (or a tool) ran `git init` between classification and repair, the
result is a hybrid `.git` with two object stores — worse than either input
state — reported as `recovered`. The exact re-check guard just added to the
rebase/cherry-pick handlers (`24250e5`) is the fix; it becomes automatic if
TOCTOU re-verification moves into the shared pipeline (S2).

#### M3 — Machine tokens shown as button labels

`recommendedAction` is documented as the human-facing button label
(`types.ts:76-79`), but five call sites stuff machine tokens into it
(verified): `recover-merge-conflict.ts:58` and
`recover-unrelated-histories.ts:246` (`"choose_file_version"`),
`recover-missing-objects.ts:72,132` (`"clone_fresh_copy"`),
`recover-unrelated-histories.ts:82` (`"reconnect_repo"`). Root cause: the
5-value `RecoveryActionKey` union doesn't cover these actions, so the token
was put in the free-text field instead — a non-technical author sees a button
literally labeled **clone_fresh_copy**. `recover-missing-objects.test.ts`
encodes the bug as expected behavior.

Fix: extend `RecoveryActionKey`, move the tokens to `recommendedActionKey`,
restore human labels, update the tests. Note the viewer's action-key switch
must handle the new keys (its default is a safe no-op, but a no-op primary
button is still a dead CTA — same class of bug `da402f6` just fixed).

#### M4 — Recovery is unreachable from the CLI, but the CLI creates git projects

`print-md new` (commands/new.ts) git-inits projects by default; a CLI-only
user of the standalone binary who hits a stale lock or interrupted operation
has no automated path out, and `syncProject`'s `failureOutcome`
(`sync.ts:407-421`) collapses everything non-auth/offline into a generic
"try again" — the structural cause is never surfaced. Product decision needed
(Q1): either a `print-md repair`/doctor-style surface reusing the existing
dispatcher, or an explicit statement that recovery requires the viewer.

#### M5 — Snapshot commit is not atomic; a crash can make edits invisible

`source-provider.ts:534-542`: `stageChanges` (git.add/remove) then
`git.commit` are two awaited steps with no rollback. A crash between them
leaves the index matching the workdir with no commit — and because
`hasPendingChanges` deliberately compares WORKDIR↔STAGE only, it then reports
**false**: the edits are on disk but invisible to snapshot, sync, and backup
logic indefinitely. Nothing in the codebase compares index↔HEAD to detect
this. Bytes are safe; visibility (and the "snapshot-first, nothing lost"
invariant) is not.

Fix options: cheapest is a startup/preflight probe that detects
staged-but-uncommitted state and commits it as a snapshot ("recovered edits");
that is one extra check in `inspectRepo` + a trivial repair, consistent with
the existing health-probe design.

#### M6 — `recover-network.ts` folds real conflicts into `retry_later` (verified, downgraded from the initial "infinite loop" hypothesis)

`recover-network.ts:103-114`: the `default:` arm maps `conflict`/`pull-first`/
`error` outcomes of its inner `syncProject` retry to `retry_later`, discarding
the conflict payload. Verified consequence: **not** an infinite loop — the
next scheduled tick's normal sync path returns a structured `conflict` outcome
which `main.ts:1514-1527` latches and surfaces. Cost: one extra retry cycle
(~30s) during which the author is told "Sync will be retried shortly" for a
condition that retrying cannot fix. Fix: return `needs_user` with the files
payload for the `conflict` arm (mirroring `recover-merge-conflict.ts`), keep
`retry_later` for the rest.

### MINOR

1. **`recover-stale-lock.ts:182-204`** hand-rolls the confirm gate that
   `withBackupGate` already implements (~25 duplicated lines; the gate works
   fine with `createBackup:false`). Delete in favor of the wrapper.
2. **Duplicate lock scanners**: `inspect.ts:42-70` (sync) and
   `recover-stale-lock.ts:76-112` (async) are near-identical, synced by a
   "MUST stay in lockstep" comment. Extract one shared module (~60 lines
   removed).
3. **Dead/aspirational code**: `FaultPoint "write_recovery_log"`
   (`types.ts:209`) is never called; `recover-network.ts`'s `retryAfterMs`
   `multiplier` param (and its "exponential" doc comment) has no caller —
   backoff is a flat 30s. Delete both or wire them up.
4. **Preflight drops `retryAfterMs`** (`main.ts:2921`): the project-open path
   emits `offline` and waits for the generic ~2-min timer instead of
   scheduling `setTimeout(retryAfterMs)` the way the mid-sync path does
   (`main.ts:1445-1448`). ~3-line fix.
5. **No TOCTOU re-check** in `recover-detached-head.ts` /
   `recover-corrupt-index.ts` / `recover-missing-objects.ts` (unlike the
   rebase/cherry-pick handlers). Outcomes are benign-ish (an unnecessary
   rescue branch, an unnecessary rebuild), but the rigor is inconsistent —
   S2 makes it uniform.
6. **`RecoveryConfirmDialog.svelte:66`**: unguarded `await` on the IPC
   response; UI can't hang (state is set before the await) but a throw is an
   unhandled rejection. 2-line try/catch.
7. **Step logging** exists only in `dispatch.ts` and
   `recover-unrelated-histories.ts` despite `RecoveryContext.logFile` being
   documented as a per-step debugging facility — a supportability gap for
   diagnosing field failures. S2 gives every handler entry/exit logging for
   free.
8. **`gitDirFor`** (`source-provider.ts:581`) assumes `.git` is a directory;
   in a worktree/submodule (`.git` is a file) every marker/lock probe silently
   returns false. Out of scope for the product's use case — worth a one-line
   comment, not a fix.
9. **Type triple-mirror** (lib `types.ts` ↔ `recovery-bridge.ts` ↔
   `contract.ts`): field-for-field in sync today, but `da402f6` itself shows
   one union edit requires five-file lockstep. Acceptable per §8 (contract
   types are deliberately local); revisit only if drift actually bites.
10. **`backup.ts:94,107`** excludes `node_modules` only at the repo root, not
    nested. Low relevance for markdown projects.

---

## 3. Recommended simplification plan

The subsystem's bones are right (policy matrix, backup gate, health probe,
plain-language guidance). The complexity that hurts is **triplication of
classification** and **per-handler re-implementation of cross-cutting
concerns** (lock, TOCTOU re-check, logging, confirm gate). Both are fixable by
subtraction — consolidating onto primitives that already exist.

### S1 — One classifier (removes M1, fixes half of C1)

1. Move sync.ts's private `classifyFailure`/`isPushRejected`/
   `isMergeConflictError` into `classify.ts` (or export them from one place)
   and import from sync.ts — delete the duplicated copies and the
   "kept in sync by spec" comment.
2. Add `hasInterruptedMerge` (and the lock-age gate, if kept — Q3) to
   `classify.ts`'s structural block.
3. Delete `classifyFromHealth` from `recovery-bridge.ts` and call
   `lib.classifyGitError(undefined, health)` at project-open.

Net effect: one source of truth; the viewer loses ~40 lines; every future kind
lands in one file.

### S2 — Policy-driven pipeline in the dispatcher (removes C3, M2, minors 1/5/7)

Today each handler independently decides whether to take the repo lock, create
the backup, ask for confirmation, re-verify preconditions, and log. Policy.ts
already declares most of this per kind — enforce it in one place. In
`dispatch.ts` (or a widened `withBackupGate`):

```
recover(kind, ctx):
  withRepoLock(ctx.repoDir):          # uniform — delete the 2 handler-local locks
    if handler.stillApplies?(ctx) === false:   # TOCTOU re-check, per handler,
        return benign "already recovered"      # currently hand-rolled in 2 of 14
    withBackupGate(ctx, kind):        # unchanged — already policy-driven
        log step; run handler body; log outcome
```

Handlers shrink to their genuinely unique part: the repair itself plus an
optional `stillApplies` precondition probe. `recover-stale-lock.ts`'s
hand-rolled gate and both handler-local `withRepoLock` wrappers get deleted.
Estimated net: **-150 to -250 lines** with strictly stronger invariants
(every risky repair locked, re-verified, logged).

Care point: handler bodies must keep calling only raw `git.*`/`fs` inside the
lock (the FIFO queue is non-reentrant) — this constraint already exists and is
documented in the rebase handler; the pipeline just makes it apply everywhere.

### S3 — Honest, single-sourced guidance (removes C2, M3)

- Generate the backup reassurance line from `backupZipPath` presence; delete
  the 7 hardcoded copies.
- Extend `RecoveryActionKey` with the missing actions; restore human button
  labels; make the viewer route the new keys (its exhaustive-switch tests make
  this cheap).

### S4 — Close the state-coverage gaps (removes C1's other half, M5, M6)

- `interrupted_merge`: new kind + policy + small handler (mirror of
  cherry-pick abort) — or route to the conflict chooser, per Q2.
- Staged-but-uncommitted probe in `inspectRepo` + auto-snapshot repair (M5).
- `recover-network.ts`: route the `conflict` arm to `needs_user` (M6).
- Consider calling `inspectRepo` at the top of `syncProject` (it is cheap,
  local-fs-only) so structural damage is caught *before*
  `snapshotBeforeAction` can commit conflict markers — this converts the whole
  recovery system from "react to a throw" to "check before touching the tree",
  which is what makes it seamless for non-technical authors (Q3).

### Sequencing (smallest proven increments)

| # | Change | Risk | Est. diff |
|---|--------|------|-----------|
| 1 | S3 guidance honesty + action keys | none (copy + types) | net-negative |
| 2 | M6 network-conflict routing + minor 4 (retryAfterMs) | low | ~15 lines |
| 3 | S1 classifier consolidation | low (pure functions, existing tests) | net-negative |
| 4 | S2 dispatcher pipeline | medium (touches all handlers; big test suite protects) | net -150..-250 |
| 5 | S4 interrupted_merge + M5 probe + preflight-in-sync | medium | net-positive but small |
| 6 | M4 CLI exposure | product decision first | — |

Each step is independently shippable and verifiable against the existing test
suite (all changes must keep `bun test` green, 0 warnings, per repo rules).

---

## 4. Open design questions

1. **CLI recovery (M4)** — is the recovery subsystem intended to reach CLI
   users of the standalone binary (e.g. a `print-md repair` command reusing
   the dispatcher, with a terminal confirm gate), or is git-backed recovery
   deliberately a viewer feature? This decides whether C3's locking gap is
   "latent" or "live" outside the viewer.
2. **Interrupted merge UX (C1)** — the viewer's project-open classifier routes
   it to the conflict chooser (`merge_conflict`); the rebase/cherry-pick
   pattern instead aborts to last-working-state. Which is intended? An abort
   is simpler and matches "undo the unfinished update"; the chooser preserves
   the author's in-progress merge decisions.
3. **Preflight placement** — should `inspectRepo` run inside `syncProject`
   before any tree mutation (library-level, protects every caller), or remain
   the host's job? Library-level is the only way to prevent the
   conflict-marker-snapshot scenario in C1.
4. **Stale-lock age policy** — viewer preflight uses a 120s age gate before
   even classifying a stale lock; the lib classifier fires immediately and
   relies on the handler's own age check to `retry_later`. Which is canonical?
   (Handler-side check suggests the classifier gate is redundant and can be
   deleted along with `classifyFromHealth`.)
