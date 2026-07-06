import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
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

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const folderPath = body.projectDir;
  if (!folderPath || typeof folderPath !== 'string') error(400, "'projectDir' string is required");
  const hooks = getPrefsHooks<ProjectSourceLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
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
});
