import { json, error } from '@sveltejs/kit';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

/** Image extensions surfaced in the Media panel (lowercase, no dot). */
const MEDIA_IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'tif', 'tiff',
]);
/** Directories never scanned for project images. */
const MEDIA_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'out', 'build', 'output', '.svelte-kit',
]);
const MEDIA_SCAN_MAX_DEPTH = 6;
const MEDIA_SCAN_MAX_FILES = 2000;

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const projectDir = body.projectDir;
    if (!projectDir || typeof projectDir !== 'string') return error(400, "'projectDir' string is required");
    if (!path.isAbsolute(projectDir)) return error(400, `media:listImages requires an absolute path, got: ${projectDir}`);

    const results: Array<{
      name: string;
      relPath: string;
      path: string;
      size: number;
      mtimeMs: number;
    }> = [];

    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (depth > MEDIA_SCAN_MAX_DEPTH || results.length >= MEDIA_SCAN_MAX_FILES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MEDIA_SCAN_MAX_FILES) return;
        if (entry.name.startsWith('.')) continue;
        const abs = path.join(dir, entry.name);
        const relChild = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (MEDIA_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          await walk(abs, relChild, depth + 1);
        } else if (entry.isFile()) {
          const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase();
          if (!MEDIA_IMAGE_EXTS.has(ext)) continue;
          try {
            const s = await stat(abs);
            results.push({
              name: entry.name,
              relPath: relChild,
              path: abs,
              size: s.size,
              mtimeMs: s.mtimeMs,
            });
          } catch {
            // raced deletion — skip
          }
        }
      }
    };

    await walk(projectDir, '', 0);
    results.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return json(results);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
