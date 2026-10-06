import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mimeTypeFor } from '$lib/server/editor-projection';
import { requireWithinProjectRoot } from '../../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * One file of the open book for the editor document, which renders a chapter
 * inside the app's own origin where the chapter's relative `images/art.png`
 * would otherwise 404. The URL is `<base64url(projectDir)>/<relative path>`
 * (see `$lib/editor/project-assets`); the resolved file must be inside the
 * open book, canonically, before a byte is read.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [encodedDir, ...rest] = params.path.split('/');
  if (!encodedDir || rest.length === 0) return new Response('Not Found', { status: 404 });
  let projectDir: string;
  try {
    projectDir = Buffer.from(encodedDir, 'base64url').toString('utf8');
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  if (!path.isAbsolute(projectDir)) return new Response('Not Found', { status: 404 });
  const relative = rest.map((seg) => decodeURIComponent(seg)).join('/');
  if (relative.split('/').some((seg) => seg === '..' || seg === '')) {
    return new Response('Not Found', { status: 404 });
  }
  const resolved = path.resolve(projectDir, relative);
  try {
    await requireWithinProjectRoot(resolved, 'editor/project-file');
    const data = await readFile(resolved);
    return new Response(data, { headers: { 'Content-Type': mimeTypeFor(resolved) } });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
};
