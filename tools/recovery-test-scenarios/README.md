# Sync-recovery test scenarios

Scripts that build **print-md test repos in known-broken Git states** so you can
open them in the viewer and watch the sync-recovery UI (overlay / confirm /
guidance / conflict dialogs) respond.

These are throwaway fixtures. They use the system `git` binary by design — that's
fine, because CLAUDE.md §7's "pure isomorphic-git, no shelling to git" rule governs
the **app runtime**, not local test-setup scripts.

## Prerequisites

- `git` installed (`git --version`).
- A built viewer to open folders in — e.g.
  `packages/viewer/dist/print-md-viewer-0.5.3.AppImage` (`chmod +x` it, then run;
  add `--no-sandbox` if your environment needs it).

## Usage

```bash
cd tools/recovery-test-scenarios
./make-scenario.sh list                       # list scenarios
./make-scenario.sh detached-head-clean        # build one (→ ./recovery-scenarios/detached-head-clean)
./make-scenario.sh detached-head-clean ~/tmp/dh   # …at a custom path
./make-scenario.sh all ~/tmp/recovery         # build all under a base dir
```

Then in the viewer: **File ▸ Open Folder** and pick the scenario directory.
**Re-run the same command to reset** a scenario to its fresh broken state.

**Safety:** the script writes a `.print-md-test-scenario` marker into each dir and
will only ever delete a dir that has that marker — it can't clobber a real project.

## How recovery gets triggered

There are two trigger paths, and they decide which scenarios show something:

1. **Project-open health preflight** — when you open a folder, the host runs
   `inspectRepo` and classifies the state. This catches: **detached HEAD, stale
   lock, missing `.git`, interrupted merge, interrupted rebase**. These show the
   recovery UI *immediately on open*, with **no remote required**.
2. **Sync-time errors** — `corrupt-index` and `missing-objects` are *not* visible
   in the open-time health snapshot; they surface when a Git/sync operation runs.
   To see those you generally need a remote connected so auto-sync fires (see
   "Remote-dependent" below).

## Scenarios & what to expect

| Scenario | Trigger | What you should see |
|---|---|---|
| `healthy` | open | Control. No overlay/dialog; pill settles to "Everything is in sync" / idle. |
| `detached-head-clean` | open | **RecoveryConfirmDialog** "We can fix this — your choice". Approve → overlay "Tidying up your sync" → "All set". A local rescue branch is created; **nothing is pushed**. |
| `detached-head-changes` | open | **High-risk confirm** (amber edge + warning glyph + "Take your time…"). Approve → your uncommitted edits are preserved on a rescue branch before reattaching. **Decline → nothing changes** (verify your edit is still there). |
| `stale-lock` | open | Silent auto-repair: brief "Tidying up your sync" overlay → "All set". The `.git/index.lock` is removed. |
| `fresh-lock` | open | **Control:** a brand-new lock is *respected* — the app does **not** delete it; it backs off / retries. Proves a live operation is never stomped. |
| `interrupted-merge` | open | Treated as a content conflict → **ConflictChoicesDialog** "Changes happened in two places", yours/theirs preview, **Keep both** default. |
| `interrupted-rebase` | open | Non-fast-forward recovery path (fetch+merge when a remote is set; otherwise a brief recovery overlay). |
| `missing-git` | open | **RecoveryGuidanceDialog** / confirm. With **no remote**: "We couldn't finish syncing" guidance + a `/tmp` backup, **your files untouched**. With a remote: can re-clone history. |
| `corrupt-index` | sync | *Advanced.* Not caught at open. Connect a remote and let auto-sync fire (or edit a file) → backup→repair path. |
| `missing-objects` | sync | *Advanced.* Same — surfaces on a sync op; needs a remote to refetch, else guidance. |

## Things to verify (the safety contract)

- **Nothing is ever force-pushed** and the remote is unchanged on any
  blocked/failed/declined repair.
- **A `/tmp/print-sync-recovery/…` backup zip** is created before any risky repair.
- **Declining a confirmation is a true no-op** — your local files are exactly as
  they were (`detached-head-changes` is the easiest way to check this).
- **Your content files are never deleted**, even in `missing-git`.

## Remote-dependent scenarios

The viewer only **auto-syncs** projects with an **HTTPS remote + a stored
credential** (`canSync`). The structural scenarios above need none of that — they
fire from the open-time preflight. But to exercise the *sync-time* paths
(`corrupt-index`, `missing-objects`) and real divergence/conflict recovery, point
a scenario at a real remote you control:

```bash
cd recovery-scenarios/corrupt-index   # (a scenario with .git intact)
git remote add origin https://github.com/<you>/<throwaway-repo>.git
git push -u origin main               # seed it once while the repo is healthy
```

Then connect the same remote in the viewer (it stores the credential), reopen the
folder, and let auto-sync run.

## Cleanup

When you're done, just delete the output directory you chose, e.g.:

```bash
rm -rf recovery-scenarios        # or whatever base dir you passed to `all`
```
