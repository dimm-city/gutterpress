import { json, error } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const projectDir = body.projectDir;
    if (!projectDir) return error(400, 'projectDir is required');
    if (!path.isAbsolute(projectDir)) return error(400, `fs:listProjectFiles requires an absolute path, got: ${projectDir}`);
    const entries = await readdir(projectDir, { withFileTypes: true });
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
    return json({ md, css });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
