// ──────────────────────────────────────────────────────────────────────────
// recovery-paths.ts — pure userData path builders + repo-slug sanitizer (#44).
//
// Side-effect-free (no electron, no fs): the caller passes in the resolved
// userData directory (from `app.getPath("userData")`) and these builders join
// the fixed sub-paths. Extracted from electron/main.ts so the path/slug logic
// is unit-testable in isolation (mirrors recovery-bridge/project-state style).
// ──────────────────────────────────────────────────────────────────────────

import path from "node:path";

// The recovery sidecar store lives under userData/recovery/.
export function recoveryDir(userDataDir: string): string {
  return path.join(userDataDir, "recovery");
}

// Sanitize a repo slug for use as a log filename: every char outside
// [A-Za-z0-9_-] becomes '_', and an EMPTY result falls back to the literal
// "repo". Because the replace only substitutes (never removes) characters, the
// only input that yields "" is the empty string — so "repo" fires solely for an
// empty slug, matching the original `... || "repo"` in main.ts exactly. A
// non-empty all-separator slug (e.g. "///" → "___", "-" → "-") is preserved.
export function slugifyRepo(repoSlug: string): string {
  return repoSlug.replace(/[^a-zA-Z0-9_-]/g, "_") || "repo";
}

// The sync/recovery operation logs live under userData/logs/. One file per
// project slug so logs from different projects don't interleave.
export function logsDir(userDataDir: string): string {
  return path.join(userDataDir, "logs");
}

// The sync/recovery operation log lives under userData/logs/. One file per
// project slug so logs from different projects don't interleave. The file is
// appended to (not truncated) so a user can see history across sessions.
export function operationLogPath(userDataDir: string, repoSlug: string): string {
  return path.join(logsDir(userDataDir), `${slugifyRepo(repoSlug)}.log`);
}

// The app's OWN fault log (updater failures) — see electron/app-log.ts. It
// lives in the same userData/logs/ dir as the per-project operation logs, so
// the start screen's Logs tab lists and reads it with no extra route.
// The SPACE in the name is what keeps it distinguishable from a project's log
// at a glance: slugifyRepo maps every char outside [A-Za-z0-9_-] to "_", so no
// project log's name can ever contain one.
export function appLogPath(userDataDir: string): string {
  return path.join(logsDir(userDataDir), "Gutterpress app.log");
}

/**
 * The operation-log slug for a project: the REPOSITORY's name.
 *
 * Every operation the log records — snapshot, sync, pull, push, restore — acts
 * on the whole repository (R9: "a project is its git repo"), so the log is the
 * repository's log. Callers used to pass `path.basename(openedDir)`, i.e. the
 * opened BOOK, which split one repo's history across a file per book and made
 * two same-named books in different repos share one file — breaking this
 * module's own "one file per project" guarantee and diverging from the lib's
 * `buildRecoveryContext`, which slugs `path.basename(repoDir)` (2026-07-29
 * audit).
 *
 * Pass the repo root when the project has one; for a plain (non-git) folder
 * there is no repo and the folder itself is the unit.
 */
export function operationLogSlug(repoRootOrDir: string): string {
  return path.basename(repoRootOrDir);
}
