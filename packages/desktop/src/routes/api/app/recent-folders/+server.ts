import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ hooks }) => {
    const prefs = await hooks.readPrefs();
    const recents =
      (prefs.recentFolders as
        | Array<{ path: string; lastActiveBook?: string; [k: string]: unknown }>
        | undefined) ?? [];
    return Promise.all(
      recents.map(async (r) => {
        // `exists` drives whether the row is clickable, so it has to describe
        // the folder the row actually OPENS. For a repo-backed entry that is
        // `lastActiveBook`, while `path` is the repo root — so checking `path`
        // alone left a row live and clickable after the recorded book was
        // deleted or renamed, and the click just failed (2026-07-29 audit).
        const repoExists = (await hooks.existingDirectory(r.path)) !== null;
        if (!r.lastActiveBook) return { ...r, exists: repoExists };
        const bookExists = (await hooks.existingDirectory(r.lastActiveBook)) !== null;
        // Book gone but the repo still there: keep the row usable and let it
        // open the repo, which re-resolves an active book on open.
        if (!bookExists) {
          const { lastActiveBook: _dropped, ...rest } = r;
          return { ...rest, exists: repoExists };
        }
        return { ...r, exists: repoExists && bookExists };
      }),
    );
  },
});
