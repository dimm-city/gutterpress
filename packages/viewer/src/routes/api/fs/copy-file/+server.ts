import { error } from '@sveltejs/kit';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { src?: string; dest?: string }) => {
  const srcPath = body.src;
  const destDir = body.dest;
  if (!srcPath) error(400, 'src is required');
  if (!destDir) error(400, 'dest is required');
  // copy-file keeps its own "src/dest must be absolute" messages (distinct from the
  // standard requireAbsolute wording), so validate inline to preserve them exactly.
  if (!path.isAbsolute(srcPath)) error(400, `fs:copyFile: src must be absolute, got: ${srcPath}`);
  if (!path.isAbsolute(destDir)) error(400, `fs:copyFile: dest must be absolute, got: ${destDir}`);
  await mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, path.basename(srcPath));
  await copyFile(srcPath, destPath);
  return destPath;
});
