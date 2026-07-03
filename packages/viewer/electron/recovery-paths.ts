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
// [A-Za-z0-9_-] becomes '_', and a result with no alphanumeric char (empty or
// all-separator) falls back to the literal "repo".
export function slugifyRepo(repoSlug: string): string {
  const slug = repoSlug.replace(/[^a-zA-Z0-9_-]/g, "_");
  return /[a-zA-Z0-9]/.test(slug) ? slug : "repo";
}

// The sync/recovery operation log lives under userData/logs/. One file per
// project slug so logs from different projects don't interleave. The file is
// appended to (not truncated) so a user can see history across sessions.
export function operationLogPath(userDataDir: string, repoSlug: string): string {
  return path.join(userDataDir, "logs", `${slugifyRepo(repoSlug)}.log`);
}
