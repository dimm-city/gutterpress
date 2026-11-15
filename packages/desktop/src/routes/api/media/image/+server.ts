import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The Media panel's thumbnails: the original image, streamed to an <img> that the
// renderer decodes and scales off the host's main thread (a host-side decode
// froze the whole app on large art). Confined to the open project.
const MEDIA_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
};

export const GET: RequestHandler = async ({ url }) => {
  const filePath = await requireWithinProjectRoot(
    requireAbsolute(url.searchParams.get('path') ?? undefined, 'media:image'),
    'media:image',
  );
  const mime = MEDIA_MIME[filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()];
  if (!mime) error(415, 'media:image: not an image file');
  try {
    if (!(await stat(filePath)).isFile()) error(404, 'media:image: no such image');
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    error(404, 'media:image: no such image');
  }
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' },
  });
};
