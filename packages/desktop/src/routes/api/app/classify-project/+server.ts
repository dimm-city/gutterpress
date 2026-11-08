import { defineRoute, getHostServices, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** A book found inside the classified project's repo (repo-root sessions). */
interface RepoBookEntry {
  path: string;
  title: string;
  subPath: string;
}

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'app/classify-project'),
  }),
  call: async ({ body }) => {
    const folderPath = body.projectDir;
    const lib = await loadLib();
    // Opening a book is the first thing that touches it: a switch the app died
    // in the middle of is put right BEFORE the editor reads a file or a build
    // starts. Best-effort for the open itself; the notice is shown once.
    let repairNotice: string | null = null;
    try {
      await lib.repairInterruptedSwitch(folderPath);
      repairNotice = await lib.takeSwitchRepairNotice(folderPath);
    } catch {
      repairNotice =
        "An earlier revision switch was interrupted and the book could not be put back automatically. " +
        "Saving is paused until it is; your files have not been changed by this check.";
    }
    // Still unresolved after the repair above: saving is paused (the status bar says so).
    const unfinishedSwitch = await lib.unfinishedSwitchState(folderPath).catch(() => null);
    const source = await lib.detectProjectSource(folderPath);
    const capabilities = lib.capabilitiesFor(source);
    const hasManifest = lib.hasProjectManifest(folderPath);

    // Repo-root sessions: a `local-git-folder` source's `repoRoot` may hold
    // several books (folders directly containing a manifest). Reuse the same
    // BFS scan the Books tab's background discovery already uses, rooted at
    // just this one repo — the desktop decides which book is "active" from this
    // list (project-session-controller.svelte.ts's resolveActiveBookDir).
    const typedSource = source as { type: string; repoRoot?: string };
    let repoRoot: string | undefined;
    let books: RepoBookEntry[] | undefined;
    let lastActiveBook: string | undefined;
    if (typedSource.type === 'local-git-folder' && typedSource.repoRoot) {
      repoRoot = typedSource.repoRoot;
      const discovered = (await getHostServices().prefs.scanForProjects([repoRoot], new Set())) as Array<{
        path: string;
        title: string;
      }>;
      books = discovered
        .map((d) => ({ ...d, subPath: lib.repoSubPath(repoRoot!, d.path) }))
        .sort((a, b) => (a.subPath < b.subPath ? -1 : a.subPath > b.subPath ? 1 : 0));
      // The book last open in this repo (the recents entry the preview open
      // stamps), so opening the repo root itself (a favorite, the folder
      // picker) lands on that book rather than the first one.
      const prefs = await getHostServices().prefs.readPrefs();
      const recents = (prefs.recentFolders ?? []) as Array<{ path: string; lastActiveBook?: string }>;
      lastActiveBook = recents.find((r) => r.path === repoRoot)?.lastActiveBook;
    }

    return { source, capabilities, hasManifest, repoRoot, books, lastActiveBook, ...(repairNotice ? { repairNotice } : {}), ...(unfinishedSwitch ? { unfinishedSwitch: true } : {}) };
  },
});
