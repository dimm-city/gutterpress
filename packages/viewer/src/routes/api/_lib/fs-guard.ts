import { error } from '@sveltejs/kit';
import { getFsGuardHooks, isWithinAnyRoot } from '../../../../electron/server-bridge/fs-guard';

// Route-side half of the fs-route project-scoping guard (ARCH review #37).
// The policy itself — what `projectRoots()`/`readOnlyRoots()` mean and why —
// is documented on `electron/server-bridge/fs-guard.ts`'s `FsGuardHooks`.
// This file owns the one thing that belongs in the SvelteKit host layer: the
// 403 SvelteKit routes throw when a request falls outside that policy.

/**
 * Confine `absPath` to the currently-open project. Throws 403 when no
 * project is open yet (the allow-list is empty) or `absPath` isn't under any
 * allowed root.
 *
 * Call from a route's `validate`, after `requireAbsolute` — so the check
 * runs before `call` ever touches disk, on the same
 * fail-before-the-service-call footing every other `defineRoute` check uses.
 *
 * `includeReadOnlyRoots` additionally allows `FsGuardHooks.readOnlyRoots()`
 * (today: the crash-recovery sidecar dir). `fs/read-file` is the only route
 * that passes it — every write-capable route (write-file, list-dir,
 * stat-file, and copy-file's `dest`) omits it, since that dir is never a
 * legitimate write target through the generic fs routes (recovery writes go
 * through the dedicated `recovery/*` routes instead).
 */
export function requireWithinProjectRoot(
  absPath: string,
  routeName: string,
  options: { includeReadOnlyRoots?: boolean } = {},
): string {
  const guard = getFsGuardHooks();
  const roots = guard ? guard.projectRoots() : [];
  const allowed = options.includeReadOnlyRoots && guard ? [...roots, ...guard.readOnlyRoots()] : roots;
  if (!isWithinAnyRoot(absPath, allowed)) {
    error(403, `${routeName}: path is outside the open project`);
  }
  return absPath;
}
