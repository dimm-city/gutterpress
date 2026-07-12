import { readdir } from 'node:fs/promises';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    // Confine to the open project (ARCH #37) — this readdir is the same
    // arbitrary-directory-enumeration primitive fs/list-dir guards.
    projectDir: requireWithinProjectRoot(
      requireAbsolute((raw as { projectDir?: string }).projectDir, 'fs:listProjectFiles'),
      'fs:listProjectFiles',
    ),
  }),
  call: async ({ body }) => {
    const entries = await readdir(body.projectDir, { withFileTypes: true });
    const md: string[] = [];
    const css: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.md')) md.push(entry.name);
      else if (lower.endsWith('.css')) css.push(entry.name);
    }
    md.sort((a, b) => a.localeCompare(b));
    css.sort((a, b) => a.localeCompare(b));
    return { md, css };
  },
});
