import { json, error } from '@sveltejs/kit';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { src?: string; dest?: string };
    const srcPath = body.src;
    const destDir = body.dest;
    if (!srcPath) return error(400, 'src is required');
    if (!destDir) return error(400, 'dest is required');
    if (!path.isAbsolute(srcPath)) return error(400, `fs:copyFile: src must be absolute, got: ${srcPath}`);
    if (!path.isAbsolute(destDir)) return error(400, `fs:copyFile: dest must be absolute, got: ${destDir}`);
    await mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(srcPath));
    await copyFile(srcPath, destPath);
    return json(destPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
