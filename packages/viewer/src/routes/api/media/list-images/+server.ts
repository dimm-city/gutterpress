import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Image extensions surfaced in the Media panel (lowercase, no dot). */
const MEDIA_IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'tif', 'tiff', 'avif',
]);
/** Directories never scanned for project images. */
const MEDIA_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'out', 'build', 'output', '.svelte-kit',
]);
const MEDIA_SCAN_MAX_DEPTH = 6;
const MEDIA_SCAN_MAX_FILES = 2000;

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    // Confine to the open project (ARCH #37): this walk (depth 6, up to 2000
    // entries) must not enumerate arbitrary directory trees for renderer-origin
    // callers.
    projectDir: await requireWithinProjectRoot(
      requireAbsolute((raw as { projectDir?: string }).projectDir, 'media:listImages'),
      'media:listImages',
    ),
  }),
  call: async ({ body }) => {
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

    await walk(body.projectDir, '', 0);
    results.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return results;
  },
});
