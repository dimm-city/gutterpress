import { json, error } from '@sveltejs/kit';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
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

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { imagePath?: string; width?: number; height?: number };
    const filePath = body.imagePath;
    if (!filePath || typeof filePath !== 'string') return error(400, "'imagePath' string is required");
    if (!path.isAbsolute(filePath)) return error(400, `media:thumbnail requires an absolute path, got: ${filePath}`);

    let s;
    try {
      s = await stat(filePath);
    } catch {
      return json(null);
    }

    const cached = thumbCache.get(filePath);
    if (cached && cached.mtimeMs === s.mtimeMs) {
      thumbCache.delete(filePath);
      thumbCache.set(filePath, cached);
      return json(cached.dataUrl);
    }

    const { nativeImage } = await import('electron');
    const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
    let dataUrl: string | null = null;
    try {
      if (ext === 'svg') {
        if (s.size <= THUMB_FALLBACK_MAX_BYTES) {
          const buf = await readFile(filePath);
          dataUrl = `data:image/svg+xml;base64,${buf.toString('base64')}`;
        }
      } else {
        let img = nativeImage.createFromPath(filePath);
        if (img.isEmpty()) {
          // Some formats (notably WebP/GIF from disk paths) can decode from
          // bytes even when createFromPath() returns empty.
          try {
            const buf = await readFile(filePath);
            img = nativeImage.createFromBuffer(buf);
          } catch {
            // keep `img` empty and fall through to raw-byte fallback
          }
        }
        if (!img.isEmpty()) {
          const { width, height } = img.getSize();
          const scaled =
            width > THUMB_MAX_PX || height > THUMB_MAX_PX
              ? width >= height
                ? img.resize({ width: THUMB_MAX_PX })
                : img.resize({ height: THUMB_MAX_PX })
              : img;
          dataUrl = scaled.toDataURL();
        } else if (s.size <= THUMB_FALLBACK_MAX_BYTES && MEDIA_MIME[ext]) {
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
    return json(dataUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
