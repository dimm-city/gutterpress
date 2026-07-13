import { error } from '@sveltejs/kit';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute, requireWithinProjectRoot } from '../../_lib/route';
import { getFsGuardHooks, isWithinAnyRootCanonical } from '../../../../../electron/server-bridge/fs-guard';
import { getPickedFilesHooks } from '../../../../../electron/server-bridge/picked-files';
import type { RequestHandler } from './$types';

// P1 review: `src` is not confined to the open project the way `dest` is —
// the editor's "insert image" (EditorToolbar.svelte) and the media panel's
// "import" (MediaPanel.svelte) flows need to copy a file the author picked
// via a native OS file dialog (dialog:pickImageFile[s]) from ANYWHERE on
// disk INTO the project. That used to be "enforced" by nothing but a
// docstring claiming `src` came from the dialog — any same-origin script
// could POST an arbitrary `src` and this route would copy it in, then the
// scoped fs:readFile route could read it back out. `src` outside the
// project is now required to be a one-time "picked-file" capability
// (`../../../../../electron/server-bridge/picked-files.ts`), registered ONLY
// by the pick-image-file[s] routes when the native dialog itself returns a
// path, and consumed in `call` below on first use.
export const POST: RequestHandler = defineRoute<{ src: string; dest: string }>({
  // copy-file keeps its own "src/dest must be absolute" messages (distinct from the
  // standard requireAbsolute wording), so validate inline to preserve them exactly.
  validate: async (raw) => {
    const body = raw as { src?: string; dest?: string };
    const srcPath = body.src;
    const destDir = body.dest;
    if (!srcPath) error(400, 'src is required');
    if (!destDir) error(400, 'dest is required');
    if (!path.isAbsolute(srcPath)) error(400, `fs:copyFile: src must be absolute, got: ${srcPath}`);
    if (!path.isAbsolute(destDir)) error(400, `fs:copyFile: dest must be absolute, got: ${destDir}`);
    // `dest` is what actually gets written, so it's the side this module's
    // project-root allow-list confines; `src`'s authorization is the separate
    // picked-file capability checked in `call` below.
    return { src: srcPath, dest: await requireWithinProjectRoot(destDir, 'fs:copyFile') };
  },
  call: async ({ body }) => {
    const srcResolved = path.resolve(body.src);

    // A src already inside the currently-open project needs no picker
    // capability — nothing is being smuggled in from outside. Only a src
    // OUTSIDE every known project root is the escape the P1 review flagged.
    const guard = getFsGuardHooks();
    const projectRoots = guard ? guard.projectRoots() : [];
    const insideProject = await isWithinAnyRootCanonical(srcResolved, projectRoots);
    if (!insideProject && !getPickedFilesHooks()?.consume(srcResolved)) {
      error(403, 'fs:copyFile: src was not returned by a recent file picker');
    }

    await mkdir(body.dest, { recursive: true });
    const destPath = path.join(body.dest, path.basename(srcResolved));
    // `validate` only confined `body.dest` (the directory) — the FINAL write
    // path (`dest/basename`) was never re-checked. If that exact path is
    // itself a symlink (e.g. an attacker pre-planted
    // `<dest>/<basename> -> /outside/target`), `copyFile` follows destination
    // symlinks on write, so an uncontained call here would silently overwrite
    // whatever the symlink points at outside the project (maintainer review,
    // PR #98, finding #6a). Re-run the canonicalizing containment guard on
    // this call-computed path, same as `media/import-image` already does for
    // its own destDir/destPath.
    await requireWithinProjectRoot(destPath, 'fs:copyFile');
    await copyFile(srcResolved, destPath);
    return destPath;
  },
});
