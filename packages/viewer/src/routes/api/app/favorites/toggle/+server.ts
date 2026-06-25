import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface FolderEntry { path: string; title: string }
interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
  writePrefs: (prefs: Record<string, unknown>) => Promise<void>;
  toggleFavoriteFolder: (
    favorites: FolderEntry[] | undefined,
    entry: FolderEntry
  ) => { favorites: FolderEntry[]; favorited: boolean };
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string; title?: string };
    const folderPath = body.path;
    const title = body.title ?? '';
    if (!folderPath || typeof folderPath !== 'string') return error(400, 'path is required');
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    const { favorites, favorited } = hooks.toggleFavoriteFolder(
      current.favorites as FolderEntry[] | undefined,
      { path: folderPath, title }
    );
    await hooks.writePrefs({ ...current, favorites });
    return json({ favorited });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
