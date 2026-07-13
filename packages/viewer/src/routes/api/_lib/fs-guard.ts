import { error } from '@sveltejs/kit';
import { getFsGuardHooks, isWithinAnyRootCanonical } from '../../../../electron/server-bridge/fs-guard';

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
 * Call from a route's `validate` (or `call`, for a target computed after
 * validation — e.g. a join of an already-validated dir + a name segment),
 * after `requireAbsolute` — so the check runs before the path is ever handed
 * to a real fs op, on the same fail-before-the-service-call footing every
 * other `defineRoute` check uses. ASYNC (P1 review): the containment check
 * canonicalizes `absPath` and every allowed root with `realpath` first (see
 * `electron/server-bridge/fs-guard.ts`'s `isWithinAnyRootCanonical`) — plain
 * `path.resolve` normalizes lexical segments (`..`, `.`) but leaves symlinks
 * intact, so a project-local symlink aliasing an outside directory would
 * otherwise pass this check and then be followed outside the project by the
 * subsequent fs call. `defineRoute`'s `validate` accepts `Body |
 * Promise<Body>` and awaits either, so `await`ing this from `validate` is
 * the same shape as every other check.
 *
 * `includeReadOnlyRoots` additionally allows `FsGuardHooks.readOnlyRoots()`
 * (today: the crash-recovery sidecar dir). `fs/read-file` is the only route
 * that passes it — every write-capable route (write-file, list-dir,
 * stat-file, and copy-file's `dest`) omits it, since that dir is never a
 * legitimate write target through the generic fs routes (recovery writes go
 * through the dedicated `recovery/*` routes instead).
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
    error(403, `${routeName}: path is outside the open project`);
  }
  return absPath;
}
