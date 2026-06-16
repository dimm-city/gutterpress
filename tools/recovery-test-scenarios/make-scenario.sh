#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# make-scenario.sh — build print-md test repos in known-broken Git states so you
# can open them in the viewer and watch the sync-recovery UI do its thing.
#
# These are THROWAWAY TEST FIXTURES you run by hand. They use the system `git`
# binary on purpose (ergonomics) — that's fine: CLAUDE.md §7's "pure
# isomorphic-git, no shelling to git" rule governs the APP runtime, not local
# test-setup scripts.
#
# Usage:
#   ./make-scenario.sh list
#   ./make-scenario.sh <scenario> [target-dir]
#   ./make-scenario.sh all [base-dir]          # build every scenario under base-dir
#
# Defaults: target-dir = ./recovery-scenarios/<scenario>
#           base-dir   = ./recovery-scenarios
#
# Then in the viewer: File ▸ Open Folder ▸ pick the scenario dir. The project-open
# health preflight classifies the state and runs recovery (see README.md for the
# exact UI each one should produce).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Deterministic identity so commits work even with no global git config.
git_c() { git -C "$DIR" -c user.name="Test Author" -c user.email="test@print-md.local" "$@"; }

# Sentinel written into every scenario dir. We ONLY ever rm a dir that contains
# it, so this script can never delete data it didn't create.
SENTINEL=".print-md-test-scenario"

SCENARIOS=(
  healthy
  detached-head-clean
  detached-head-changes
  stale-lock
  fresh-lock
  interrupted-merge
  interrupted-rebase
  missing-git
  corrupt-index
  missing-objects
)

usage() {
  cat <<EOF
make-scenario.sh — print-md sync-recovery test fixtures

  ./make-scenario.sh list
  ./make-scenario.sh <scenario> [target-dir]
  ./make-scenario.sh all [base-dir]

Scenarios:
  healthy                Control: opens normally, NO recovery.
  detached-head-clean    HEAD on an earlier (reachable) commit, clean tree.
  detached-head-changes  Detached HEAD + uncommitted edits (HIGH-risk confirm).
  stale-lock             A 5-min-old .git/index.lock (>30s threshold → repaired).
  fresh-lock             A brand-new .git/index.lock (control: NOT repaired, retried).
  interrupted-merge      Left mid-merge (MERGE_HEAD) → "changes in two places".
  interrupted-rebase     Left mid-rebase (.git/rebase-merge) → non-fast-forward.
  missing-git            .git removed, content kept → missing-history recovery.
  corrupt-index          .git/index corrupted  (ADVANCED — fires on a sync op, not on open).
  missing-objects        A loose object damaged (ADVANCED — fires on a sync op, not on open).

See README.md for what each one should show in the app.
EOF
}

# Refuse to clobber a dir we didn't create; otherwise recreate it fresh.
prepare_dir() {
  if [[ -e "$DIR" ]]; then
    if [[ -f "$DIR/$SENTINEL" ]]; then
      rm -rf "$DIR"
    else
      echo "Refusing to overwrite '$DIR' — it has no $SENTINEL marker (not created by this script)." >&2
      echo "Pick a different target dir, or remove it yourself first." >&2
      exit 1
    fi
  fi
  mkdir -p "$DIR"
  : > "$DIR/$SENTINEL"
}

# Scaffold a minimal-but-valid print-md project + initialise a 2-commit repo.
scaffold_and_init() {
  prepare_dir
  mkdir -p "$DIR/chapters" "$DIR/assets"

  cat > "$DIR/manifest.yaml" <<'YAML'
title: "Recovery Test Book"
authors:
  - "Test Author"
source:
  files:
    - chapters/01-intro.md
    - chapters/02-arrival.md
output:
  filename: "recovery-test.pdf"
YAML

  cat > "$DIR/chapters/01-intro.md" <<'MD'
# Introduction

This is a throwaway project used to test print-md's sync-recovery UI.
Open the folder in the viewer and watch what happens.
MD

  cat > "$DIR/chapters/02-arrival.md" <<'MD'
# Chapter Two — Arrival

The rain had not stopped for three days when Mara reached the gate.
She pulled her coat tighter and knocked twice — her own signal.
MD

  cat > "$DIR/styles.css" <<'CSS'
@page { size: 6in 9in; margin: 0.75in; }
h1 { break-before: page; }
CSS

  cat > "$DIR/.gitignore" <<'GI'
*.pdf
.print-sync/
GI

  git_c init -q -b main
  git_c add -A
  git_c commit -q -m "Initial book"
  # Second commit so detached-HEAD has an earlier commit to land on.
  printf '\nA later edit lands in chapter two.\n' >> "$DIR/chapters/02-arrival.md"
  git_c add -A
  git_c commit -q -m "Expand chapter two"
}

# ── Scenario builders ────────────────────────────────────────────────────────

build_healthy() { scaffold_and_init; }

build_detached-head-clean() {
  scaffold_and_init
  local first; first=$(git_c rev-list --max-parents=0 HEAD)
  git_c -c advice.detachedHead=false checkout -q "$first"
}

build_detached-head-changes() {
  scaffold_and_init
  local first; first=$(git_c rev-list --max-parents=0 HEAD)
  git_c -c advice.detachedHead=false checkout -q "$first"
  # Uncommitted local work on the detached commit → HIGH-risk repair path.
  printf '\nUnsynced local work the author has not committed yet.\n' >> "$DIR/chapters/01-intro.md"
}

build_stale-lock() {
  scaffold_and_init
  : > "$DIR/.git/index.lock"
  # Age it past the 30s stale threshold so recovery removes it.
  touch -d '5 minutes ago' "$DIR/.git/index.lock"
}

build_fresh-lock() {
  scaffold_and_init
  # Brand-new lock (mtime = now): recovery should NOT delete it, just retry.
  : > "$DIR/.git/index.lock"
}

build_interrupted-merge() {
  scaffold_and_init
  # Create a real conflicting merge and leave it unfinished (MERGE_HEAD present).
  git_c checkout -q -b sidebranch HEAD~1
  printf '# Introduction\n\nA DIFFERENT opening, edited by a teammate.\n' > "$DIR/chapters/01-intro.md"
  git_c add -A
  git_c commit -q -m "Teammate rewrites the intro"
  git_c checkout -q main
  printf '# Introduction\n\nMY opening, edited here on this computer.\n' > "$DIR/chapters/01-intro.md"
  git_c add -A
  git_c commit -q -m "I rewrite the intro"
  # This merge conflicts; leave it mid-flight (do not resolve).
  git_c merge sidebranch -m "merge" || true
}

build_interrupted-rebase() {
  scaffold_and_init
  # Leave the marker dir the health check looks for (real rebases are hard to
  # stop non-interactively; the preflight only checks for .git/rebase-merge).
  mkdir -p "$DIR/.git/rebase-merge"
  git_c rev-parse HEAD > "$DIR/.git/rebase-merge/onto"
  git_c rev-parse HEAD > "$DIR/.git/rebase-merge/orig-head"
  echo "main" > "$DIR/.git/rebase-merge/head-name"
}

build_missing-git() {
  scaffold_and_init
  # Content stays; the whole .git history is gone.
  rm -rf "$DIR/.git"
  # Re-drop the sentinel that lived alongside .git (it's outside .git, so it's fine).
  : > "$DIR/$SENTINEL"
}

build_corrupt-index() {
  scaffold_and_init
  printf 'CORRUPTED_GARBAGE_NOT_A_REAL_INDEX' > "$DIR/.git/index"
}

build_missing-objects() {
  scaffold_and_init
  # Damage the first loose object we find (simulates pack/object corruption).
  local objroot="$DIR/.git/objects"
  local sub file
  for sub in "$objroot"/??; do
    [[ -d "$sub" ]] || continue
    for file in "$sub"/*; do
      [[ -f "$file" ]] || continue
      # Loose objects are written read-only (mode 444) — make writable first.
      chmod u+w "$file" 2>/dev/null || true
      printf 'CORRUPT' > "$file"
      return 0
    done
  done
  echo "  (note: no loose object found to damage — repo may be fully packed)" >&2
}

expect_note() {
  case "$1" in
    healthy)               echo "Opens normally. No overlay, no dialog. Pill settles to 'Everything is in sync' / idle." ;;
    detached-head-clean)   echo "Project-open preflight detects detached HEAD → RecoveryConfirmDialog ('We can fix this — your choice'). Approve → overlay 'Tidying up your sync' → 'All set'. A local rescue branch is created; nothing is pushed." ;;
    detached-head-changes) echo "Detached HEAD + local changes → HIGH-risk confirm (amber edge, warning glyph, 'Take your time…'). Approve → your edits are preserved on a rescue branch before reattaching. Decline → nothing changes." ;;
    stale-lock)            echo "Stale lock (>30s) → silent automatic repair: brief 'Tidying up your sync' overlay, then 'All set'. The lock file is removed." ;;
    fresh-lock)            echo "Fresh lock → NOT removed; the app backs off and retries (pill may show offline/retry). Control case proving a live lock is respected." ;;
    interrupted-merge)     echo "Interrupted merge → classified as a content conflict: the ConflictChoicesDialog ('Changes happened in two places') with yours/theirs preview, Keep both default." ;;
    interrupted-rebase)    echo "Interrupted rebase → non-fast-forward recovery path (fetch+merge if a remote is set; otherwise a brief recovery overlay)." ;;
    missing-git)           echo "Missing .git → RecoveryConfirmDialog / RecoveryGuidanceDialog. With a remote connected it can re-clone history; with NO remote it shows guidance + a /tmp backup ('We couldn't finish syncing'). Your files are never deleted." ;;
    corrupt-index)         echo "ADVANCED: the preflight health snapshot does NOT catch this — it surfaces when a sync/git operation runs. Connect a remote + let auto-sync fire, or perform an edit, to see the backup→repair path." ;;
    missing-objects)       echo "ADVANCED: same as corrupt-index — surfaces on a sync operation, not at open. Needs a remote to refetch; otherwise shows guidance." ;;
    *)                     echo "" ;;
  esac
}

# ── Dispatch ─────────────────────────────────────────────────────────────────

is_scenario() { local s; for s in "${SCENARIOS[@]}"; do [[ "$s" == "$1" ]] && return 0; done; return 1; }

cmd="${1:-}"
case "$cmd" in
  ""|-h|--help|help) usage; exit 0 ;;
  list) printf '%s\n' "${SCENARIOS[@]}"; exit 0 ;;
  all)
    base="${2:-./recovery-scenarios}"
    for s in "${SCENARIOS[@]}"; do
      DIR="$base/$s"
      "build_${s}"
      printf '✓ %-22s → %s\n' "$s" "$DIR"
      printf '    %s\n' "$(expect_note "$s")"
    done
    echo
    echo "Open any of these folders in the viewer to test. Re-run to reset."
    exit 0
    ;;
  *)
    if is_scenario "$cmd"; then
      DIR="${2:-./recovery-scenarios/$cmd}"
      "build_${cmd}"
      echo "✓ Built '$cmd' at: $DIR"
      echo
      echo "Expect in the app:"
      echo "  $(expect_note "$cmd")"
      echo
      echo "Open this folder in the viewer (File ▸ Open Folder). Re-run this command to reset it."
      exit 0
    fi
    echo "Unknown scenario: $cmd" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
