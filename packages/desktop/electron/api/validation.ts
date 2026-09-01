/**
 * Path/segment validation for the IPC-based fs/dialog/shell/log/app handlers
 * (SFE-P5c1).
 *
 * This is a PORT, not a re-derivation (run rule 7 — "root/path validation is
 * REUSED, not re-derived"): the actual security-load-bearing logic —
 * `isWithinAnyRootCanonical`'s symlink-safe containment walk,
 * `FsGuardHooks.projectRoots()`/`readOnlyRoots()`, and the picked-files
 * one-time capability — all still live in `electron/server-bridge/fs-guard.ts`
 * and `electron/server-bridge/picked-files.ts` and are called here VERBATIM,
 * unchanged. What this file replaces is only the SvelteKit-specific outer
 * shim that used to live in `src/routes/api/_lib/route.ts` +
 * `src/routes/api/_lib/fs-guard.ts`: those threw `@sveltejs/kit`'s
 * `error(status, message)` (an HTTP status + JSON envelope) because the route
 * layer had a status code to report. IPC has no status-code concept — the
 * message text is what every real caller actually reads (`api.ts`'s
 * `post`/`get` helpers already discarded the status and kept only the body
 * text; see the run report for the caller-message-only audit) — so these
 * throw a PLAIN `Error(message)` with the exact same message text the routes
 * used, which is what preserves each caller's observable behavior across the
 * transport change (run rule 2).
 *
 * `_lib/route.ts`/`_lib/fs-guard.ts` themselves are NOT deleted or moved:
 * dozens of route groups outside this subrun (project, remote, vcs, publish,
 * plugin, theme, media, …) still import them, and moving a helper that not
 * every consumer migrates this subrun is exactly what the run specification
 * forbids ("move the helper to the main-process module tree IF all its
 * consumers migrate this subrun, else import it from its current home").
 */
import path from "node:path";
import { getFsGuardHooks, isWithinAnyRootCanonical } from "../server-bridge/fs-guard";
import { getPickedFilesHooks } from "../server-bridge/picked-files";

/** Assert `value` is an absolute filesystem path. Same wording as the deleted
 *  `_lib/handler.ts`'s `requireAbsolute`, minus the HTTP status. */
export function requireAbsolute(value: unknown, label: string): string {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} requires an absolute path, got: ${value ?? ""}`);
  }
  return value;
}

/**
 * Confine `absPath` to the currently-open project (ARCH review #37). Same
 * symlink-safe containment check the deleted `_lib/fs-guard.ts` used —
 * `getFsGuardHooks()`/`isWithinAnyRootCanonical` are unchanged main-process
 * primitives, called here exactly as the route layer called them.
 */
export async function requireWithinProjectRoot(
  absPath: string,
  routeName: string,
  options: { includeReadOnlyRoots?: boolean } = {},
): Promise<string> {
  const guard = getFsGuardHooks();
  const roots = guard ? guard.projectRoots() : [];
  const allowed = options.includeReadOnlyRoots && guard ? [...roots, ...guard.readOnlyRoots()] : roots;
  if (!(await isWithinAnyRootCanonical(absPath, allowed))) {
    throw new Error(`${routeName}: path is outside the open project`);
  }
  return absPath;
}

/** `requireAbsolute` + `requireWithinProjectRoot` in one call — the
 *  renderer-supplied `projectDir` check every project-scoped op uses. */
export async function requireProjectDir(value: unknown, routeName: string): Promise<string> {
  return requireWithinProjectRoot(requireAbsolute(value, routeName), routeName);
}

/**
 * Authorize an absolute path that may legitimately be EITHER inside the open
 * project OR one a native dialog just produced (the picked-files one-time
 * capability — see `electron/server-bridge/picked-files.ts`).
 */
export async function requireContainedOrPicked(
  absPath: string,
  routeName: string,
  options: { includeReadOnlyRoots?: boolean } = {},
): Promise<string> {
  try {
    return await requireWithinProjectRoot(absPath, routeName, options);
  } catch {
    const picked = getPickedFilesHooks();
    if (picked?.consume(absPath)) {
      picked.register([absPath]);
      return absPath;
    }
    throw new Error(`${routeName}: path is outside the open project and was not chosen from a file dialog`);
  }
}

/**
 * Validate a single path SEGMENT (a bare file/folder name — never a path).
 * Same rules as the deleted `src/routes/api/fs/_shared/validate-segment.ts`.
 */
export function requireSegment(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  if (trimmed === "." || trimmed === "..") throw new Error(`${label} is not a valid name`);
  if (/[\\/]/.test(trimmed)) throw new Error(`${label} must be a single name, not a path`);
  return trimmed;
}
