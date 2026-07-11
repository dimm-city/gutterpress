import { error } from '@sveltejs/kit';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getMediaHooks } from '../../../../../electron/server-bridge/media-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

const THUMB_MAX_PX = 192;
const THUMB_CACHE_MAX = 300;
const THUMB_FALLBACK_MAX_BYTES = 512 * 1024;
const thumbCache = new Map<string, { mtimeMs: number; dataUrl: string | null }>();

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

export const POST: RequestHandler = defineRoute<{ imagePath: string }>({
  validate: (raw) => {
    const body = raw as { imagePath?: string; width?: number; height?: number };
    if (!body.imagePath || typeof body.imagePath !== 'string') {
      error(400, "'imagePath' string is required");
    }
    return { imagePath: requireAbsolute(body.imagePath, 'media:thumbnail') };
  },
  call: async ({ body }) => {
    const filePath = body.imagePath;

    let s;
    try {
      s = await stat(filePath);
    } catch {
      return null;
    }

    const cached = thumbCache.get(filePath);
    if (cached && cached.mtimeMs === s.mtimeMs) {
      thumbCache.delete(filePath);
      thumbCache.set(filePath, cached);
      return cached.dataUrl;
    }

    const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
    let dataUrl: string | null = null;
    try {
      if (ext === 'svg') {
        if (s.size <= THUMB_FALLBACK_MAX_BYTES) {
          const buf = await readFile(filePath);
          dataUrl = `data:image/svg+xml;base64,${buf.toString('base64')}`;
        }
      } else {
        const hooks = getMediaHooks();
        if (!hooks) error(503, 'Media hooks not registered');
        dataUrl = await hooks.createThumbnail(filePath, THUMB_MAX_PX);
        if (!dataUrl && s.size <= THUMB_FALLBACK_MAX_BYTES && MEDIA_MIME[ext]) {
          const buf = await readFile(filePath);
          dataUrl = `data:${MEDIA_MIME[ext]};base64,${buf.toString('base64')}`;
        }
      }
    } catch {
      dataUrl = null;
    }

    thumbCache.set(filePath, { mtimeMs: s.mtimeMs, dataUrl });
    while (thumbCache.size > THUMB_CACHE_MAX) {
      const oldest = thumbCache.keys().next().value;
      if (oldest === undefined) break;
      thumbCache.delete(oldest);
    }
    return dataUrl;
  },
});
