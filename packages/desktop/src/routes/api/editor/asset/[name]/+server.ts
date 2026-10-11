import { readFile } from 'node:fs/promises';
import { editorAssetPath, mimeTypeFor } from '$lib/server/editor-projection';
import type { RequestHandler } from './$types';

/**
 * One file a book stylesheet references, by the hashed name `inlineStyles`
 * gave its copy. The registry is the authorization: only a name a listed
 * stylesheet produced resolves, and it resolves to exactly the file it came
 * from — nothing here takes a path.
 */
export const GET: RequestHandler = async ({ params }) => {
  const file = editorAssetPath(params.name);
  if (!file) return new Response('Not Found', { status: 404 });
  try {
    const data = await readFile(file);
    return new Response(data, { headers: { 'Content-Type': mimeTypeFor(file) } });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
};
