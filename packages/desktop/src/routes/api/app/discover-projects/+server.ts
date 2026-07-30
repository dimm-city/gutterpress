import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ hooks }) => {
    const prefs = await hooks.readPrefs();
    const searchRoots = prefs.projectSearchRoots as string[] | undefined;
    const roots =
      searchRoots && searchRoots.length > 0 ? searchRoots : hooks.defaultProjectSearchRoots();
    const recentFolders = prefs.recentFolders as
      | Array<{ path: string; lastActiveBook?: string }>
      | undefined;
    const favorites = prefs.favorites as Array<{ path: string }> | undefined;
    // For a repo-backed entry, `path` is the REPO ROOT while discovery returns
    // BOOK folders (any dir holding a manifest) — so excluding by `path` alone
    // never matched, and a book already sitting in Recents was suggested again
    // under "Discovered" (2026-07-29 audit). `lastActiveBook` is the book that
    // entry actually reopens, so it belongs in the same exclusion.
    const exclude = new Set<string>([
      ...(recentFolders ?? []).flatMap((r) => (r.lastActiveBook ? [r.path, r.lastActiveBook] : [r.path])),
      ...(favorites ?? []).map((f) => f.path),
    ]);
    // M20: a scan failure must NOT resolve as `[]` — that's indistinguishable
    // from "no projects found" for every caller. Let it propagate; `defineRoute`
    // (via `jsonRoute`) already maps an uncaught throw to a non-200 error
    // response, which `api.app.discoverProjects()` (api.ts's `post()`) already
    // turns back into a rejected promise. That existing error/empty
    // discriminant is enough — no bespoke envelope needed.
    return await hooks.scanForProjects(roots, exclude);
  },
});
