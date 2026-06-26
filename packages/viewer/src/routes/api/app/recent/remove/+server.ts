import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface RecentFolder { path: string; [k: string]: unknown }
interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
  writePrefs: (prefs: Record<string, unknown>) => Promise<void>;
  removeRecentFolder: (
    recents: RecentFolder[] | undefined,
    targetPath: string
  ) => RecentFolder[];
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const folderPath = body.path;
    if (!folderPath || typeof folderPath !== 'string') return error(400, 'path is required');
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    await hooks.writePrefs({
      ...current,
      recentFolders: hooks.removeRecentFolder(current.recentFolders as RecentFolder[] | undefined, folderPath),
    });
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
