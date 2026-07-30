import { error } from '@sveltejs/kit';
import { getFsGuardHooks, isWithinAnyRootCanonical } from '../../../../electron/server-bridge/fs-guard';
import { getPickedFilesHooks } from '../../../../electron/server-bridge/picked-files';
import { requireAbsolute } from './handler';

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

/**
 * THE check for a route's renderer-supplied `projectDir`: absolute (400 if
 * not) AND inside the open project (403 if not) in one call.
 *
 * Every route that does filesystem, git, or credentialed-network work against
 * a `projectDir` uses this — the 2026-07-29 audit found ~36 of them
 * (vcs/*, remote/sync, publish/*, theme/*, style/*, manifest/*, plugin/*,
 * snip/*, tpl/save-as-template, lint/project) validating the parameter with
 * `requireAbsolute` alone, i.e. accepting ANY absolute path on disk. Having
 * ONE named check instead of a two-call idiom is what makes the invariant
 * greppable: a `projectDir` route that doesn't call this is the exception and
 * has to say why.
 *
 * Call it from `validate`, never from `call`: `handleRemoteErrors` /
 * `handlePublishErrors` wrap `call` and swallow non-`Error` throwables (a
 * SvelteKit `HttpError` is a plain object), which would turn this 403 into a
 * generic 500 with a misleading message.
 *
 * NOT for routes that legitimately run with no project open — project
 * discovery/adoption/creation (`app/classify-project`, `app/adopt-folder`,
 * `app/create-project`, `app/discover-projects`), a clone destination
 * (`remote/clone-repository`), userData-side stores (`app/*` prefs/state,
 * `recovery/*`), or a dialog-picked source path (which is gated by the
 * one-time capability in `electron/server-bridge/picked-files.ts` instead).
 * `projectRoots()` is empty until a project opens, so this fails closed for
 * all of them by design.
 */
export async function requireProjectDir(value: unknown, routeName: string): Promise<string> {
  return requireWithinProjectRoot(requireAbsolute(value, routeName), routeName);
}

/**
 * Authorize an absolute path that may legitimately be EITHER inside the open
 * project OR one a native dialog just produced. Returns it, or throws 403.
 *
 * This is the shared shape behind `publish:run`'s upload artifact and
 * `shell:showInFolder`'s reveal target — both accept a path the author picked
 * in a Save/Open dialog (a PDF on the Desktop, an export destination) that is
 * deliberately outside the project, yet must reject an arbitrary path a
 * same-origin script invents. The security-load-bearing subtlety, spelled out
 * once here instead of twice: on the picked branch the capability is consumed
 * and IMMEDIATELY re-registered, so a two-call flow with the same path (a
 * dry-run then a publish; a toast clicked twice) still works, while the
 * property that matters — only a path THIS process's own dialog produced is
 * usable — holds. The dialog routes (`dialog/pick-pdf-file`,
 * `dialog/open-directory`) and the export controller register their results;
 * see `electron/server-bridge/picked-files.ts`.
 *
 * `includeReadOnlyRoots` widens the in-project branch to `readOnlyRoots()`
 * (the reveal target may be a crash-recovery backup under userData).
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
    error(403, `${routeName}: path is outside the open project and was not chosen from a file dialog`);
  }
}
