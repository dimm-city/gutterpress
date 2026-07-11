import { error } from '@sveltejs/kit';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ src: string; dest: string }>({
  // copy-file keeps its own "src/dest must be absolute" messages (distinct from the
  // standard requireAbsolute wording), so validate inline to preserve them exactly.
  validate: (raw) => {
    const body = raw as { src?: string; dest?: string };
    const srcPath = body.src;
    const destDir = body.dest;
    if (!srcPath) error(400, 'src is required');
    if (!destDir) error(400, 'dest is required');
    if (!path.isAbsolute(srcPath)) error(400, `fs:copyFile: src must be absolute, got: ${srcPath}`);
    if (!path.isAbsolute(destDir)) error(400, `fs:copyFile: dest must be absolute, got: ${destDir}`);
    // `src` is DELIBERATELY NOT confined to the open project (ARCH review
    // #37): the editor's "insert image" (EditorToolbar.svelte) and the media
    // panel's "import" (MediaPanel.svelte) flows pick it via a native OS file
    // dialog (dialog:pickImageFile[s]) — the whole point of this route is
    // copying a file the author chose from ANYWHERE on disk INTO the
    // project. `dest` is what actually gets written, so it's the side this
    // confines.
    return { src: srcPath, dest: requireWithinProjectRoot(destDir, 'fs:copyFile') };
  },
  call: async ({ body }) => {
    await mkdir(body.dest, { recursive: true });
    const destPath = path.join(body.dest, path.basename(body.src));
    await copyFile(body.src, destPath);
    return destPath;
  },
});
