# ADR 0010 — Convergent sync and single-path repair

**Status:** Partially superseded (product owner directive, 2026-08-21)
**Supersedes:** the interactive conflict-resolution half of ADR 0006 D5.
The snapshot-first invariant of D5 is unchanged and remains binding.

> **Decision 2 (repair) was withdrawn on 2026-08-21 and the repair subsystem
> deleted.** Damage to `.git` never threatens the book: working files come
> through byte-intact, and a project with a wrecked history still opens,
> edits, and builds. The pipeline was ~1,600 source lines whose only
> irreplaceable case was a local-only project losing its version history —
> the owner's ruling was that this does not earn the weight. A repo whose
> history cannot be read now reports that plainly and points at the online
> copy; `gutterpress repair` is gone. **Decision 1 (convergent sync) stands
> and remains binding.**

## Context

Gutterpress sync was built as interactive, transactional git tooling: a
conflict blocked sync, latched the auto-sync orchestrator, and opened a
per-file chooser (Keep mine / Use online / Keep both), backed by a custom
merge driver, "(online copy)" side files, and a 16-handler recovery subsystem
with risk policies, backup zips, and confirmation dialogs (~19k lines with
tests across both packages).

The first real two-writer field session dead-ended in exactly this machinery
(2026-08-13 incident): the dialog's stale ids could never resolve against a
remote that had moved, and every retry failed. The product owner's ruling:
this is a single-user / small-team writing tool — rip out the choices and
dialogs and reduce sync and repair to the minimum that serves non-technical
writers, using what git already does instead of re-implementing it.

## Decision

### 1. Sync always converges — there is no conflict outcome

`syncProject` merges with a fixed policy (`converge-merge.ts`) and always
lands:

- **Text edited on both sides** → BOTH versions stay in the one file, inside
  standard git conflict markers (`<<<<<<< your version` / `=======` /
  `>>>>>>> online version`) — the exact output `git merge` produces, minus
  the stopping. The writer blends the passage in the editor; the outcome's
  `combinedFiles` drives a review toast. Never a second file: the
  "(online copy)" mechanism is deleted (it duplicated the safety net git
  history already provides, and could leak into built books via manifest
  globs).
- **Deleted on one side, edited on the other** → the EDIT survives (a
  deletion is trivially re-doable; a lost edit is not).
- **Binary changed on both sides** (NUL sniff, plus `.svg` — text, but
  markers would corrupt its XML) → BOTH versions are kept, byte-exact, as
  two files: ours stays at `path`, theirs lands beside it at
  `name.online.ext`. The pair is reported (`keptBothFiles`) so the host can
  name it in a toast. **Amended 2026-08-21** (owner: "we are fine with
  keeping both changes on a merge and calling them out for manual fixing"):
  this replaces the newer-tip-wins policy and the non-blocking image picker
  it fed. The "never a second file" rule above still holds for TEXT, where
  markers keep both versions inside the one file; a binary cannot carry
  markers, so two files is the only way to keep both.
- **Unrelated histories** (a wrong online address) → a plain setup error.
  Never silently spliced.

Implementation note: isomorphic-git's `abortOnConflict: false` mode is NOT
used — its conflict path rewrites the whole worktree through a UTF-8
TextDecoder (corrupting binaries). The converge merge keeps
`abortOnConflict: true` (tree untouched on throw) and resolves the
driver-unreachable cases (deletes, binaries, both-adds) by equalizing with an
ordinary commit and re-merging.

Deleted: `resolveConflicts`, the resolution plan, the conflict dialog, the
conflict pill state, the orchestrator conflict latch, the pre-export
"resolve first" block, and every route/IPC surface serving them.

### 2. Repair is one automatic pipeline — WITHDRAWN 2026-08-21 (see the status note)

`repairRepo()` replaces the classifier→16-handler→policy→backup-zip→
confirm-gate subsystem. Invariants, in priority order:

1. **Working files are never touched.** Uncommitted work is snapshotted,
   never overwritten or discarded.
2. **Every commit that is still readable stays reachable.** In-place fixes
   (lock sweep, interrupted-operation cleanup, index rebuild, detached-HEAD
   reattach with a rescue branch — isomorphic-git has no reflog) run first
   and cannot lose history. The last-resort re-clone keeps the old `.git` on
   disk (`.git-damaged-<timestamp>`), copies its object store in additively,
   and converge-merges every old tip that resolves — branch refs when
   readable, otherwise a lost-found scan of the LOOSE object store (local
   commits are always loose, so unpushed work is exactly what the scan
   finds).
3. **Fully automatic.** No risk taxonomy, no confirmation dialogs, no
   guidance dialogs — the desktop shows only the recovering/recovered pill
   states; the CLI (`gutterpress repair`) adds one terminal y/N.

`classifyFromHealth` collapses to three verdicts: healthy / `stale_lock` /
`needs_repair`.

## Consequences

- ~19k lines deleted across both packages (implementation + tests); the
  entire class of "stale conflict state" UI bugs is unrepresentable.
- Committed marker text is now a NORMAL intermediate state, not damage. The
  old classifier treated markers-in-tracked-files as `interrupted_merge`
  corruption; only leftover git state files (`MERGE_HEAD`, `rebase-merge/`)
  signal an interrupted external operation now.
- A genuinely simultaneous edit to the same passage produces a file the
  writers reconcile by reading it — the correct workflow for prose, ruled so
  by the owner over both the two-file and the pick-one alternatives.
- Technical collaborators using native git see ordinary merge commits and
  standard markers — full interop, nothing Gutterpress-specific in the repo.
