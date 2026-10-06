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
    if (typedSource.type === 'local-git-folder' && typedSource.repoRoot) {
      repoRoot = typedSource.repoRoot;
      const discovered = (await getHostServices().prefs.scanForProjects([repoRoot], new Set())) as Array<{
        path: string;
        title: string;
      }>;
      books = discovered
        .map((d) => ({ ...d, subPath: lib.repoSubPath(repoRoot!, d.path) }))
        .sort((a, b) => (a.subPath < b.subPath ? -1 : a.subPath > b.subPath ? 1 : 0));
    }

    return { source, capabilities, hasManifest, repoRoot, books };
  },
});
