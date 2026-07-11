import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface ProjectSourceLibModule {
  detectProjectSource: (path: string) => Promise<unknown>;
  capabilitiesFor: (source: unknown) => unknown;
  repoSubPath: (repoRoot: string, folderPath: string) => string;
}

/** A book found inside the classified project's repo (C1: repo-root sessions). */
interface RepoBookEntry {
  path: string;
  title: string;
  subPath: string;
}

export const POST: RequestHandler = defineRoute<
  { projectDir: string },
  PrefsHooks<ProjectSourceLibModule>
>({
  hooks: () => getPrefsHooks<ProjectSourceLibModule>(),
  hooksUnavailableMessage: 'Prefs hooks not registered',
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'app/classify-project'),
  }),
  call: async ({ body, hooks }) => {
    const folderPath = body.projectDir;
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(folderPath);
    const capabilities = lib.capabilitiesFor(source);

    // C1 (repo-root sessions): a `local-git-folder` source's `repoRoot` may hold
    // several books (folders directly containing a manifest). Reuse the same
    // BFS scan the Projects tab's background discovery already uses, rooted at
    // just this one repo — the viewer decides which book is "active" from this
    // list (project-session-controller.svelte.ts's resolveActiveBookDir).
    const typedSource = source as { type: string; repoRoot?: string };
    let repoRoot: string | undefined;
    let books: RepoBookEntry[] | undefined;
    if (typedSource.type === 'local-git-folder' && typedSource.repoRoot) {
      repoRoot = typedSource.repoRoot;
      const discovered = (await hooks.scanForProjects([repoRoot], new Set())) as Array<{
        path: string;
        title: string;
      }>;
      books = discovered
        .map((d) => ({ ...d, subPath: lib.repoSubPath(repoRoot!, d.path) }))
        .sort((a, b) => (a.subPath < b.subPath ? -1 : a.subPath > b.subPath ? 1 : 0));
    }

    return { source, capabilities, repoRoot, books };
  },
});
